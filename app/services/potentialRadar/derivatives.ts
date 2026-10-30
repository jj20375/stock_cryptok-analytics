/** @file Gate USDT 永續籌碼確認；只讀公開統計，不使用 API key、不建立持倉或下單。 */
import type { DerivativeSignal, DerivativeStatus } from './types';

export const DERIVATIVE_LABELS: Record<DerivativeStatus, string> = {
  HEALTHY_TREND: '健康趨勢',
  SHORT_SQUEEZE: '軋空上漲',
  CROWDED_LONG: '多頭擁擠',
  NEW_SHORTS: '新增空單',
  DELEVERAGING: '去槓桿',
  NEUTRAL: '籌碼中性',
  UNAVAILABLE: '永續資料不足',
};

export interface GateContractStatRow {
  time: number;
  lsr_taker?: number | string;
  lsr_account?: number | string;
  long_liq_usd?: number | string;
  long_liq_usd_new?: number | string;
  short_liq_usd?: number | string;
  short_liq_usd_new?: number | string;
  open_interest_usd?: number | string;
  top_lsr_account?: number | string;
  top_lsr_size?: number | string;
}

export interface GateFundingRow { t: number; r: number | string }

interface NormalizedStat {
  time: number;
  openInterestUsd: number;
  takerLongShortRatio: number | null;
  accountLongShortRatio: number | null;
  topLongShortRatio: number | null;
  longLiquidationUsd: number;
  shortLiquidationUsd: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 這些是第一版分類假設，必須以保存的 24h／72h／7d 樣本重新校準，不能當成固定勝率。 */
const PRICE_MOVE_PCT = 0.4;
const OI_MOVE_PCT = 0.75;
const FUNDING_CROWDED_PERCENTILE = 90;
const LONG_SHORT_CROWDED_RATIO = 1.35;

const finite = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const pctChange = (current: number, previous: number) => previous > 0 ? (current / previous - 1) * 100 : 0;

function unavailable(checkedAt: number, reason: string): DerivativeSignal {
  return {
    version: 'gate-perp-crowding-v1', source: 'GATE_USDT_PERP', status: 'UNAVAILABLE', checkedAt,
    openInterestUsd: null, openInterestChange1hPct: null, fundingRate: null, fundingPercentile: null,
    takerLongShortRatio: null, accountLongShortRatio: null, topLongShortRatio: null,
    longLiquidationUsd1h: null, shortLiquidationUsd1h: null, reasons: [reason], risks: [],
  };
}

function normalizeStats(rows: GateContractStatRow[]): NormalizedStat[] {
  return rows.map(row => {
    const openInterestUsd = finite(row.open_interest_usd);
    const longLiquidationUsd = finite(row.long_liq_usd_new) ?? finite(row.long_liq_usd) ?? 0;
    const shortLiquidationUsd = finite(row.short_liq_usd_new) ?? finite(row.short_liq_usd) ?? 0;
    if (!Number.isFinite(row.time) || openInterestUsd == null || openInterestUsd <= 0 ||
      longLiquidationUsd < 0 || shortLiquidationUsd < 0) return null;
    return {
      time: row.time * 1000,
      openInterestUsd,
      takerLongShortRatio: finite(row.lsr_taker),
      accountLongShortRatio: finite(row.lsr_account),
      topLongShortRatio: finite(row.top_lsr_account) ?? finite(row.top_lsr_size),
      longLiquidationUsd,
      shortLiquidationUsd,
    };
  }).filter((row): row is NormalizedStat => row !== null).sort((left, right) => left.time - right.time);
}

function fundingSummary(rows: GateFundingRow[]) {
  const valid = rows.map(row => ({ time: Number(row.t) * 1000, rate: finite(row.r) }))
    .filter((row): row is { time: number; rate: number } => Number.isFinite(row.time) && row.rate != null)
    .sort((left, right) => left.time - right.time);
  if (!valid.length) return { rate: null, percentile: null };
  const rate = valid.at(-1)!.rate;
  /** 同值採小於等於排名；只用自身歷史，避免小幣和 BTC 的絕對資金費率硬套同門檻。 */
  const percentile = valid.filter(row => row.rate <= rate).length / valid.length * 100;
  return { rate, percentile };
}

/** 純分類函式供離線測試；價格變化沿用同輪現貨 1h 收盤報酬，OI 與清算則固定取 Gate 永續。 */
export function analyzeGateDerivatives(
  statsRows: GateContractStatRow[],
  fundingRows: GateFundingRow[],
  priceChange1hPct: number,
  checkedAt: number,
): DerivativeSignal {
  const stats = normalizeStats(statsRows);
  if (stats.length < 2) return unavailable(checkedAt, 'Gate 永續統計筆數不足，未參與籌碼分類');
  const latest = stats.at(-1)!;
  const targetTime = latest.time - HOUR_MS;
  const baseline = [...stats].reverse().find(row => row.time <= targetTime) ?? stats[0];
  if (latest.time - baseline.time < 45 * 60 * 1000) {
    return unavailable(checkedAt, 'Gate 永續 OI 未涵蓋至少 45 分鐘，未硬算一小時變化');
  }
  const openInterestChange1hPct = pctChange(latest.openInterestUsd, baseline.openInterestUsd);
  const recent = stats.filter(row => row.time > latest.time - HOUR_MS);
  const longLiquidationUsd1h = recent.reduce((sum, row) => sum + row.longLiquidationUsd, 0);
  const shortLiquidationUsd1h = recent.reduce((sum, row) => sum + row.shortLiquidationUsd, 0);
  const funding = fundingSummary(fundingRows);
  const longShortRatio = latest.topLongShortRatio ?? latest.accountLongShortRatio;
  const fundingCrowded = funding.rate != null && funding.rate > 0 &&
    funding.percentile != null && funding.percentile >= FUNDING_CROWDED_PERCENTILE;
  const longSideCrowded = longShortRatio != null && longShortRatio >= LONG_SHORT_CROWDED_RATIO;
  let status: DerivativeStatus = 'NEUTRAL';

  if (priceChange1hPct >= PRICE_MOVE_PCT && openInterestChange1hPct >= OI_MOVE_PCT && fundingCrowded && longSideCrowded) {
    status = 'CROWDED_LONG';
  } else if (priceChange1hPct >= PRICE_MOVE_PCT && openInterestChange1hPct <= -OI_MOVE_PCT) {
    status = 'SHORT_SQUEEZE';
  } else if (priceChange1hPct >= PRICE_MOVE_PCT && openInterestChange1hPct >= OI_MOVE_PCT) {
    status = 'HEALTHY_TREND';
  } else if (priceChange1hPct <= -PRICE_MOVE_PCT && openInterestChange1hPct >= OI_MOVE_PCT) {
    status = 'NEW_SHORTS';
  } else if (priceChange1hPct <= -PRICE_MOVE_PCT && openInterestChange1hPct <= -OI_MOVE_PCT) {
    status = 'DELEVERAGING';
  }

  const reasons = [
    `現貨近 1h ${priceChange1hPct >= 0 ? '+' : ''}${priceChange1hPct.toFixed(2)}%，永續 OI ${openInterestChange1hPct >= 0 ? '+' : ''}${openInterestChange1hPct.toFixed(2)}%`,
    funding.rate == null ? '資金費率歷史暫時無法取得' : `資金費率 ${(funding.rate * 100).toFixed(4)}%，位於自身近期第 ${funding.percentile!.toFixed(0)} 百分位`,
  ];
  const risks: string[] = [];
  if (status === 'CROWDED_LONG') risks.push('多頭槓桿與資金費率同步偏高，回撤時可能連鎖去槓桿');
  if (status === 'SHORT_SQUEEZE') risks.push('上漲伴隨 OI 下降，可能主要來自空單回補，追價延續性待確認');
  if (status === 'NEW_SHORTS') risks.push('價格下跌且 OI 增加，空方正在新增曝險');
  if (status === 'DELEVERAGING') risks.push('價格與 OI 同跌，市場正去槓桿');
  return {
    version: 'gate-perp-crowding-v1', source: 'GATE_USDT_PERP', status, checkedAt,
    openInterestUsd: latest.openInterestUsd, openInterestChange1hPct, fundingRate: funding.rate,
    fundingPercentile: funding.percentile, takerLongShortRatio: latest.takerLongShortRatio,
    accountLongShortRatio: latest.accountLongShortRatio, topLongShortRatio: latest.topLongShortRatio,
    longLiquidationUsd1h, shortLiquidationUsd1h, reasons, risks,
  };
}

async function getGateFutures<T>(path: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`https://api.gateio.ws/api/v4/futures/usdt/${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Gate 永續籌碼暫時無法取得（${response.status}）`);
  return response.json() as Promise<T>;
}

export async function fetchGateDerivativeSignal(symbol: string, priceChange1hPct: number, checkedAt = Date.now()): Promise<DerivativeSignal> {
  try {
    const contract = `${symbol.replace(/USDT$/, '')}_USDT`;
    const [stats, funding] = await Promise.allSettled([
      /** 取 75 分鐘、5 分間隔以容忍資料點延遲；分類仍要求基準至少相隔 45 分鐘。 */
      getGateFutures<GateContractStatRow[]>('contract_stats', {
        contract, from: String(Math.floor((checkedAt - 75 * 60 * 1000) / 1000)), interval: '5m', limit: '20',
      }),
      /** 100 筆八小時費率約涵蓋 33 天；實際間隔依各合約設定，故畫面只標示近 31 天可得紀錄。 */
      getGateFutures<GateFundingRow[]>('funding_rate', {
        contract, from: String(Math.floor((checkedAt - 31 * DAY_MS) / 1000)), to: String(Math.floor(checkedAt / 1000)), limit: '100',
      }),
    ]);
    if (stats.status === 'rejected') return unavailable(checkedAt, 'Gate 未提供此幣永續統計，或服務暫時無法使用');
    return analyzeGateDerivatives(stats.value, funding.status === 'fulfilled' ? funding.value : [], priceChange1hPct, checkedAt);
  } catch {
    /** 衍生品確認是附加資訊，任何格式或服務錯誤都不能抹除已完成的現貨候選。 */
    return unavailable(checkedAt, 'Gate 永續資料格式異常，已保留原現貨候選');
  }
}

/**
 * 【詳細繁體中文註解】：衍生品籌碼交易把關結果
 * - allowTrade: 是否允許順勢進場或推播一般候選（若多頭擁擠或空方大舉建倉則否決做多）
 * - scoreAdjustment: 對潛力幣綜合評分的加減分調整（-20 ~ +15）
 * - reason: 繁體中文籌碼判定理由
 */
export interface DerivativeTradeFilterResult {
  allowTrade: boolean;
  scoreAdjustment: number;
  reason: string;
}

/**
 * 【詳細繁體中文註解】：根據 Gate USDT 永續籌碼狀態（OI 變化、資金費率百分位、大戶多空比）評估多空進場可行性。
 * 若永續資料未取得（UNAVAILABLE），採取預設放行（Fail-Open），避免外部統計 API 暫時異常時阻斷整個系統。
 */
export function evaluateDerivativeTradeFilter(
  signal: DerivativeSignal | null | undefined,
  side: 'LONG' | 'SHORT' = 'LONG',
): DerivativeTradeFilterResult {
  if (!signal || signal.status === 'UNAVAILABLE') {
    return { allowTrade: true, scoreAdjustment: 0, reason: '永續籌碼未取得，維持原量價判斷' };
  }
  if (side === 'LONG') {
    if (signal.status === 'CROWDED_LONG') {
      return {
        allowTrade: false,
        scoreAdjustment: -20,
        reason: '永續籌碼多頭擁擠（資金費率與大戶多空比同步過熱），阻擋追高做多',
      };
    }
    if (signal.status === 'NEW_SHORTS') {
      return {
        allowTrade: false,
        scoreAdjustment: -15,
        reason: '永續籌碼出現新增空單（價格下跌且 OI 增加），阻擋逆勢做多',
      };
    }
    if (signal.status === 'HEALTHY_TREND') {
      return {
        allowTrade: true,
        scoreAdjustment: 15,
        reason: '永續籌碼健康趨勢（價漲且 OI 同步放大、費率未過熱）',
      };
    }
    if (signal.status === 'SHORT_SQUEEZE') {
      return {
        allowTrade: true,
        scoreAdjustment: 5,
        reason: '永續籌碼軋空上漲（空單停損回補推升）',
      };
    }
    if (signal.status === 'DELEVERAGING') {
      return {
        allowTrade: true,
        scoreAdjustment: -5,
        reason: '市場正在去槓桿（價跌且 OI 下降），動能偏弱',
      };
    }
    return { allowTrade: true, scoreAdjustment: 0, reason: '永續籌碼中性' };
  }

  // 做空 (SHORT) 方向籌碼把關
  if (signal.status === 'HEALTHY_TREND' || signal.status === 'SHORT_SQUEEZE') {
    return {
      allowTrade: false,
      scoreAdjustment: -15,
      reason: '永續籌碼處於健康多頭或軋空階段，阻擋逆勢摸頭做空',
    };
  }
  if (signal.status === 'NEW_SHORTS') {
    return {
      allowTrade: true,
      scoreAdjustment: 15,
      reason: '永續籌碼空方主動增倉（價跌且 OI 增加），順勢做空確認',
    };
  }
  if (signal.status === 'CROWDED_LONG') {
    return {
      allowTrade: true,
      scoreAdjustment: 10,
      reason: '永續多頭槓桿過度擁擠，具備多殺多去槓桿回調潛力',
    };
  }
  return { allowTrade: true, scoreAdjustment: 0, reason: '永續籌碼中性' };
}
