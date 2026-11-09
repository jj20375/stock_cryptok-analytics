/**
 * @file 台股、美股的油價補充觀察；以 WTI／布蘭特期貨日線搭配股指期貨與 VIX。
 * 僅說明成本與通膨風險，不改動既有回測權重、訊號計數、下單或全域風控。
 */
import { buildUnavailablePillar, formatSignedPct } from './pillars';
import type { MacroPillarAnalysis, MacroQuote, MacroRawInput } from './types';

/** 單日漲跌 3% 視為急變；這是觀察用門檻，未經回測，不代表已確認供需衝擊。 */
const OIL_SHOCK_PCT = 3;
/** 兩種原油均高於各自 10 日均線 5%，才提示持續成本壓力，避免貼線雜訊。 */
const OIL_MA_GAP_PCT = 5;
/** 兩種原油均單日回落至少 0.5%，且低於 10MA，才觀察成本壓力緩和。 */
const OIL_EASING_PCT = -0.5;

/** 油價方向無法單獨確認供需成因；股指與 VIX 僅提供交叉觀察，不作因果推論。 */
function describeOilImpact(wti: MacroQuote, brent: MacroQuote, params: MacroRawInput) {
  const quotes = [wti, brent];
  /** VIX 升溫或股指下跌時，不將油價回落直接列為成本面利多。 */
  const riskRising = params.vix.value >= 20 || params.vix.trend === 'UP'
    || params.vix.changePct >= 5 || (params.nq?.changePct ?? 0) < 0 || (params.es?.changePct ?? 0) < 0;
  if (quotes.some((q) => q.changePct >= OIL_SHOCK_PCT)
    || quotes.every((q) => (q.value / q.ma10 - 1) * 100 >= OIL_MA_GAP_PCT)) {
    return {
      signal: 'BEARISH' as const,
      label: '通膨與成本逆風',
      explanation: '原油單日急漲或雙雙明顯高於 10MA，可能推升燃料、運輸成本與通膨預期，使降息空間及成長股估值承壓；若源於需求擴張，股市也可能同步走強，仍須確認供需原因。',
    };
  }
  if (quotes.some((q) => q.changePct <= -OIL_SHOCK_PCT)
    || (quotes.every((q) => q.changePct < 0) && riskRising)) {
    return {
      signal: 'NEUTRAL' as const,
      label: '需求風險待確認',
      explanation: '原油急跌，或油價回落同時股指／VIX 轉弱，除了成本下降，也可能反映需求降溫或去槓桿，不能直接視為股市利多；需搭配景氣與供給消息確認。',
    };
  }
  if (quotes.every((q) => q.changePct <= OIL_EASING_PCT && q.value < q.ma10)
    && params.nq && params.es && !riskRising) {
    return {
      signal: 'BULLISH' as const,
      label: '成本壓力緩和',
      explanation: '兩種原油溫和回落且低於 10MA，股指期貨未跌且 VIX 未升溫，有助觀察燃料成本與通膨壓力緩和；仍不能僅憑油價判定大盤上漲。',
    };
  }
  return {
    signal: 'NEUTRAL' as const,
    label: '油價影響觀察中',
    explanation: '油價變化尚未形成明確的成本壓力或緩和訊號；上漲可能源於需求增強或供給縮減，下跌也可能源於供給改善或需求轉弱，對大盤影響需交叉確認。',
  };
}

/** 報價單位為美元／桶；缺漏不補假值，Yahoo 連續近月期貨換月亦可能影響漲跌幅。 */
function formatOilQuote(label: string, quote: MacroQuote | null): string {
  return quote ? `${label} $${quote.value.toFixed(2)} (${formatSignedPct(quote.changePct)})` : `${label} —（資料暫缺）`;
}

export function buildOilObservation(params: MacroRawInput, market: 'US' | 'TW'): MacroPillarAnalysis {
  const title = '油價觀點 (WTI／布蘭特 · 不計分)';
  /** 舊呼叫端未傳原油時視為缺資料，不影響原四項判讀。 */
  const { wti = null, brent = null } = params.oil ?? {};
  if (!wti && !brent) return buildUnavailablePillar('oil', title, 'WTI／布蘭特原油期貨');
  const impact = wti && brent ? describeOilImpact(wti, brent, params) : {
    signal: 'NEUTRAL' as const,
    label: '原油資料不完整',
    explanation: '僅取得一種原油報價，無法交叉確認油價趨勢，暫不判讀成本面的方向。',
  };
  const sectorImpact = market === 'TW'
    ? '台股：油價上行可能增加進口能源與航空成本，塑化須看產品利差及庫存效應；電子業亦受電價調整與匯率影響，傳導不一定立即發生。'
    : '美股：油價上行可能有利上游能源商營收，但增加航空、運輸與消費支出壓力；油價回落對各產業的影響則可能相反。';
  return {
    key: 'oil', title,
    signal: impact.signal,
    signalLabel: impact.label,
    primaryMetric: `${formatOilQuote('WTI', wti)} ｜ ${formatOilQuote('布蘭特', brent)}`,
    secondaryMetric: `美元／桶 · 10MA：WTI ${wti?.ma10.toFixed(2) ?? '—'} ／ 布蘭特 ${brent?.ma10.toFixed(2) ?? '—'} · Yahoo 近月期貨，換月可能影響漲跌幅`,
    explanation: `${impact.explanation}${sectorImpact}本項為補充觀察，未納入總分與看漲／中性／看跌計數。`,
  };
}
