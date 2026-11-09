/**
 * @file 即時戰略 Dashboard 多空反轉候選評估模組（做空 SHORT 反轉壓力區 ＆ 跌深支撐反轉做多 LONG）
 *
 * 【詳細繁體中文註解】：
 * 1. 為什麼需要此模組？
 *    原有雷達（台股、美股、潛力幣）僅篩選「日線多頭＋順勢突破／回踩」的做多標的；
 *    當台美股或加密貨幣處於跌勢、空頭排列或箱型震盪上緣受阻時，原本面板會因為沒有順勢多頭股而呈現空白，
 *    也無法協助使用者抓出「反彈到哪個壓力區間可以開空」或「跌到哪個前低支撐區間止跌可以抄底做多」。
 * 2. 本模組完全重用雷達快照已計算好的結構欄位（`breakout` 前高壓力、`invalidation` 前低支撐、`ema20`、`atr14`、`rsi14`、`bigFish` 紅綠線），
 *    不發起額外外部 API 請求、不寫入資料庫，並清楚標示 `direction: 'SHORT'` 或 `'LONG'` 以及反轉進場區間、停損價與目標價。
 */
import type { RadarSnapshot } from '../potentialRadar/types';
import { QUARTER_MS } from '../potentialRadar/types';
import type { UsStockSnapshot } from '../usStockRadar/types';
import type { PickContext } from './picks';
import type { DashboardPick, PickValidation } from './types';

/** 多空反轉研究預設驗證說明（提醒使用者反轉與做空訊號需嚴守結構停損） */
const REVERSAL_VALIDATION: PickValidation = {
  status: 'UNVERIFIED',
  label: '多空反轉區間研究（請嚴守結構停損）',
  detail: '依前高壓力／前低支撐與 RSI 轉折計算之反轉區間，尚未累積 20 筆以上樣本外追蹤。',
};

/**
 * 【詳細繁體中文註解】
 * 檢查股票快照（US 美股 / TW 台股）是否符合「做空反轉壓力區受阻 (`SHORT`)」或「跌深前低支撐止跌反轉做多 (`LONG`)」。
 */
export function evaluateStockReversalPick(
  snapshot: UsStockSnapshot,
  context: PickContext
): { pick: DashboardPick; edge: number; priority: number } | null {
  if (snapshot.error || !snapshot.signal) return null;
  const s = snapshot.signal;
  if (s.phase === 'EXCLUDED' || !(s.price > 0) || !(s.atr14 > 0)) return null;

  // ============================================================================
  // 情境 A：🔴 做空反轉確認（前高壓力受阻 / 漲幅過熱轉弱 / 日線空頭反彈遇壓）
  // ============================================================================
  const nearResistance = s.breakout > 0 && s.price >= s.breakout * 0.965;
  const isOverboughtTurningDown =
    (s.rsi14 >= 64 || s.phase === 'EXTENDED' || s.distanceEma20Atr >= 2.2) &&
    s.change4h < 0;
  const isBearTrendRallyReject =
    !s.dailyTrendUp &&
    s.bigFish.direction === 1 &&
    (nearResistance || (s.ema20 > 0 && Math.abs(s.price - s.ema20) <= s.atr14 * 0.8)) &&
    s.change4h <= 0;

  if (isOverboughtTurningDown || isBearTrendRallyReject) {
    const entryLow = s.price;
    const resistanceTop = Math.max(s.price, s.breakout > s.price ? s.breakout : s.price + s.atr14 * 0.4);
    const entryHigh = Math.min(resistanceTop, s.price + s.atr14 * 0.6);
    const stopLoss = entryHigh + Math.max(s.atr14 * 0.8, s.price * 0.015);
    const riskPct = ((stopLoss - s.price) / s.price) * 100;
    const targetPrice = Math.max(
      s.invalidation > 0 ? s.invalidation : s.price * 0.9,
      Math.min(s.ema20 > 0 && s.ema20 < s.price ? s.ema20 : s.price - s.atr14 * 1.8, s.price - s.atr14 * 1.5)
    );

    const strategies = [
      isOverboughtTurningDown ? '🔴 高檔過熱／前高受阻做空' : '🔴 跌勢反彈壓力區做空',
      s.bigFish.direction === 1 ? '4h Supertrend 紅線壓制' : 'RSI 高檔轉折',
    ];
    const reasons = [
      isOverboughtTurningDown
        ? `4h RSI(${s.rsi14.toFixed(1)}) 處高檔或漲幅過熱後收跌 (${s.change4h.toFixed(2)}%)，上檔前高壓力明顯`
        : `日線空頭趨勢下反彈受制於 4h 壓力區，Supertrend 維持紅線空方防守`,
      `建議做空反轉區間 ${entryLow.toFixed(2)} ～ ${entryHigh.toFixed(2)}，突破 ${stopLoss.toFixed(2)} 停損，回落目標看 ${targetPrice.toFixed(2)}`,
    ];

    const score = Math.min(
      92,
      Math.max(66, Math.round(70 + (isOverboughtTurningDown ? 10 : 8) + Math.min(10, Math.abs(s.change4h) * 2)))
    );

    return {
      pick: {
        market: context.market,
        symbol: snapshot.symbol,
        name: snapshot.name,
        direction: 'SHORT',
        price: s.price,
        changePct: s.changeDay,
        changeLabel: '當日',
        strategies,
        score,
        reasons,
        risks: ['做空操作須嚴防軋空跳空，突破停損參考價請立即回補出場', ...s.risks.slice(0, 1)],
        levels: {
          entryLow,
          entryHigh,
          stopLoss,
          riskPct,
          entryBasis: '前高／均線反轉壓力帶',
          targetPrice,
        },
        signalClosedAt: s.closedAt,
        signalTimeframe: '4 小時（多空反轉區間）',
        checkedAt: snapshot.checkedAt,
        fresh: context.latestBarTime != null && s.barTime === context.latestBarTime,
        validation: REVERSAL_VALIDATION,
        stockSnapshot: snapshot,
      },
      edge: 0,
      priority: 1,
    };
  }

  // ============================================================================
  // 情境 B：🟢 跌深支撐反轉做多（回測前低結構支撐 + RSI 偏低止跌翻紅）
  // ============================================================================
  const distToSupportAtr =
    s.invalidation > 0 && s.price > s.invalidation ? (s.price - s.invalidation) / s.atr14 : 99;
  const isSupportReboundLong =
    distToSupportAtr <= 1.25 && s.rsi14 <= 44 && s.change4h > 0;

  if (isSupportReboundLong) {
    const entryLow = Math.max(s.invalidation, s.price - s.atr14 * 0.35);
    const entryHigh = s.price;
    const stopLoss = Math.max(s.invalidation * 0.5, s.invalidation - s.atr14 * 0.5);
    const riskPct = ((s.price - stopLoss) / s.price) * 100;
    const targetPrice = Math.max(s.ema20, s.price + (s.price - stopLoss) * 1.8);

    const score = Math.min(88, Math.max(65, Math.round(74 + (44 - s.rsi14) * 0.5)));

    return {
      pick: {
        market: context.market,
        symbol: snapshot.symbol,
        name: snapshot.name,
        direction: 'LONG',
        price: s.price,
        changePct: s.changeDay,
        changeLabel: '當日',
        strategies: ['🟢 支撐區破底翻／止跌做多', `4h RSI(${s.rsi14.toFixed(0)}) 低檔翻紅`],
        score,
        reasons: [
          `回測前低支撐區 (${s.invalidation.toFixed(2)}) 未破且 4h 收紅止穩 (+${s.change4h.toFixed(2)}%)`,
          `建議做多反轉區間 ${entryLow.toFixed(2)} ～ ${entryHigh.toFixed(2)}，跌破 ${stopLoss.toFixed(2)} 停損，反彈目標 ${targetPrice.toFixed(2)}`,
        ],
        risks: ['逆勢或震盪下緣搶反彈，若跌破結構停損價代表破底延續，應嚴格停損'],
        levels: {
          entryLow,
          entryHigh,
          stopLoss,
          riskPct,
          entryBasis: '前低反轉支撐帶',
          targetPrice,
        },
        signalClosedAt: s.closedAt,
        signalTimeframe: '4 小時（多空反轉區間）',
        checkedAt: snapshot.checkedAt,
        fresh: context.latestBarTime != null && s.barTime === context.latestBarTime,
        validation: REVERSAL_VALIDATION,
        stockSnapshot: snapshot,
      },
      edge: 0,
      priority: 1,
    };
  }

  return null;
}

/**
 * 【詳細繁體中文註解】
 * 檢查虛擬幣快照（CRYPTO）是否符合「做空反轉壓力區受阻 (`SHORT`)」或「跌深支撐反轉做多 (`LONG`)」。
 */
export function evaluateCryptoReversalPick(
  snapshot: RadarSnapshot,
  context: PickContext
): { pick: DashboardPick; edge: number; priority: number } | null {
  if (snapshot.error || !snapshot.signal) return null;
  const s = snapshot.signal;
  if (s.phase === 'EXCLUDED' || !(s.price > 0)) return null;

  // 情境 A：🔴 虛擬幣做空反轉確認（漲幅過熱轉跌 / 4h 空頭反彈受阻於前高突破位）
  const isOverextendedReject =
    (s.phase === 'EXTENDED' || s.change24h >= 12) && s.change15m < 0;
  const isBearBounceReject =
    !s.fourHourlyUp &&
    (s.bigFish?.direction === 1 || !s.hourlyUp) &&
    s.breakout > 0 &&
    s.price >= s.breakout * 0.97 &&
    s.change15m < 0;

  if (isOverextendedReject || isBearBounceReject) {
    const entryLow = s.price;
    const entryHigh = Math.max(s.price, s.breakout > s.price ? s.breakout : s.price * 1.012);
    const stopLoss = entryHigh * 1.018;
    const riskPct = ((stopLoss - s.price) / s.price) * 100;
    const targetPrice =
      s.trendConfirmation?.fourHourMa20 && s.trendConfirmation.fourHourMa20 < s.price
        ? s.trendConfirmation.fourHourMa20
        : s.invalidation > 0 && s.invalidation < s.price
        ? (s.price + s.invalidation) / 2
        : s.price * 0.95;

    const score = Math.min(90, Math.max(66, Math.round(72 + Math.abs(s.change15m) * 4)));

    return {
      pick: {
        market: 'CRYPTO',
        symbol: snapshot.symbol,
        name: snapshot.symbol.replace(/USDT$/, '') + ' / USDT',
        direction: 'SHORT',
        price: s.price,
        changePct: s.change24h,
        changeLabel: '24 小時',
        strategies: [
          isOverextendedReject ? '🔴 衝高過熱受阻做空' : '🔴 4h 空頭反彈壓力做空',
          '15m 上檔賣壓確認',
        ],
        score,
        reasons: [
          isOverextendedReject
            ? `24h 急漲 (+${s.change24h.toFixed(1)}%) 進入過熱壓力帶後 15m 轉跌 (${s.change15m.toFixed(2)}%)`
            : `4h 趨勢偏空且反彈受制於前高壓力 (${s.breakout.toPrecision(5)})，15m 收黑轉弱`,
          `建議做空反轉區間 ${entryLow.toPrecision(5)} ～ ${entryHigh.toPrecision(5)}，突破 ${stopLoss.toPrecision(5)} 停損，目標 ${targetPrice.toPrecision(5)}`,
        ],
        risks: ['加密貨幣合約波動劇烈，做空請務必設好止損單並控制槓桿倍數'],
        levels: {
          entryLow,
          entryHigh,
          stopLoss,
          riskPct,
          entryBasis: '前高反轉壓力帶',
          targetPrice,
        },
        signalClosedAt: s.barTime + QUARTER_MS,
        signalTimeframe: '15 分轉折＋4 小時壓力',
        checkedAt: snapshot.checkedAt,
        fresh: context.latestBarTime != null && s.barTime === context.latestBarTime,
        validation: REVERSAL_VALIDATION,
        cryptoSnapshot: snapshot,
      },
      edge: 0,
      priority: 1,
    };
  }

  // 情境 B：🟢 虛擬幣跌深支撐反轉做多（回測前低支撐未破且 15m 翻紅轉強）
  const nearSupport =
    s.invalidation > 0 &&
    s.price > s.invalidation &&
    (s.price - s.invalidation) / s.price <= 0.025;
  if (nearSupport && s.change15m > 0.25 && s.change24h <= -2) {
    const entryLow = s.invalidation;
    const entryHigh = s.price;
    const stopLoss = s.invalidation * 0.985;
    const riskPct = ((s.price - stopLoss) / s.price) * 100;
    const targetPrice = Math.max(
      s.trendConfirmation?.fourHourMa20 ?? 0,
      s.price + (s.price - stopLoss) * 2
    );

    return {
      pick: {
        market: 'CRYPTO',
        symbol: snapshot.symbol,
        name: snapshot.symbol.replace(/USDT$/, '') + ' / USDT',
        direction: 'LONG',
        price: s.price,
        changePct: s.change24h,
        changeLabel: '24 小時',
        strategies: ['🟢 急跌回測前低支撐反轉做多', '15m 破底翻止跌'],
        score: 74,
        reasons: [
          `24h 回調 (${s.change24h.toFixed(1)}%) 測試前低支撐 (${s.invalidation.toPrecision(5)}) 守穩，15m 翻紅反彈 (+${s.change15m.toFixed(2)}%)`,
          `建議做多反轉區間 ${entryLow.toPrecision(5)} ～ ${entryHigh.toPrecision(5)}，跌破 ${stopLoss.toPrecision(5)} 停損，反彈目標 ${targetPrice.toPrecision(5)}`,
        ],
        risks: ['屬於跌勢支撐區搶反彈，若有效跌破結構失效價請立即停損'],
        levels: {
          entryLow,
          entryHigh,
          stopLoss,
          riskPct,
          entryBasis: '前低反轉支撐帶',
          targetPrice,
        },
        signalClosedAt: s.barTime + QUARTER_MS,
        signalTimeframe: '15 分支撐止跌＋反轉區間',
        checkedAt: snapshot.checkedAt,
        fresh: context.latestBarTime != null && s.barTime === context.latestBarTime,
        validation: REVERSAL_VALIDATION,
        cryptoSnapshot: snapshot,
      },
      edge: 0,
      priority: 1,
    };
  }

  return null;
}
