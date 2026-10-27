/**
 * @file 為每檔訊號標示「回測／入選追蹤／未經驗證」；只讀取既有回測結果與雷達入選追蹤，不重新回測、不寫入資料庫。
 * 雷達本身沒有正式回測流程，因此只有使用者自己對「同策略、同週期、同標的」跑過回測時才會顯示回測績效。
 */
import { summarizePotentialPerformance, type PerformanceGroupKey } from '../potentialRadar/performance';
import type { RadarObservation, RadarSignal } from '../potentialRadar/types';
import { summarizeUsStockPerformance } from '../usStockRadar/performance';
import type { UsStockObservation, UsStockSignal } from '../usStockRadar/types';
import { DASHBOARD_RULES, type DashboardMarket, type PickValidation } from './types';

/** 從 backtests.result_json 取出的績效摘要；百分比欄位單位皆為 %。 */
export interface BacktestSummary {
  backtestId: number;
  strategyId: string;
  symbol: string;
  interval: string;
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  profitFactor: number | null;
}

/** 雷達的吃大魚訊號固定使用 4 小時線，對應回測註冊表的 big_fish 策略。 */
export const BIG_FISH_BACKTEST = { strategyId: 'big_fish', interval: '4h' } as const;

/** 回測表的代號格式不一（2330、2330.TW、ETHUSDT）；統一去掉交易所尾碼與大小寫後比對。 */
export const backtestSymbolKey = (symbol: string) => symbol.toUpperCase().replace(/\.(TW|TWO)$/, '');
export const backtestLookupKey = (strategyId: string, interval: string, symbol: string) =>
  `${strategyId}|${interval}|${backtestSymbolKey(symbol)}`;

/** 解析 backtests.result_json；格式不符時回傳 null，絕不以 0 冒充有效績效。 */
export function parseBacktestSummary(row: { id: number; strategyId: string; symbol: string; interval: string;
  resultJson: string | null }): BacktestSummary | null {
  if (!row.resultJson) return null;
  try {
    const result = JSON.parse(row.resultJson) as Record<string, unknown>;
    const totalTrades = Number(result.totalTrades);
    const winRatePct = Number(result.winRatePct);
    const totalReturnPct = Number(result.totalReturnPct);
    if (![totalTrades, winRatePct, totalReturnPct].every(Number.isFinite)) return null;
    const profitFactor = Number(result.profitFactor);
    return { backtestId: row.id, strategyId: row.strategyId, symbol: row.symbol, interval: row.interval,
      totalTrades, winRatePct, totalReturnPct, profitFactor: Number.isFinite(profitFactor) ? profitFactor : null };
  } catch { return null; }
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/** 入選追蹤彙整：每個分組的完成樣本數、追蹤視窗平均報酬與上漲比例。 */
export interface TrackRecord {
  groupLabel: string;
  windowLabel: string;
  completed: number;
  average: number | null;
  positiveRate: number | null;
}

/** 台美股入選追蹤以 5 個交易日報酬為主視窗，與雷達頁「入選後追蹤」一致。 */
export function stockTrackRecords(observations: UsStockObservation[], benchmarkLabel: string) {
  const groups = summarizeUsStockPerformance(observations, benchmarkLabel);
  return (signal: UsStockSignal): TrackRecord | null => {
    const key = signal.bigFish.entry ? 'BIG_FISH' : signal.phase === 'BREAKOUT' || signal.phase === 'RETEST' ? signal.phase : null;
    const group = key ? groups.find(item => item.key === key) : null;
    if (!group) return null;
    return { groupLabel: group.label, windowLabel: '5 日', completed: group.d5.count,
      average: group.d5.average, positiveRate: group.d5.positiveRate };
  };
}

/** 虛擬幣入選追蹤以 72 小時報酬為主視窗；分組優先序與雷達排序一致：吃大魚 > 趨勢共振 > 量價結構。 */
export function cryptoTrackRecords(observations: RadarObservation[]) {
  const groups = summarizePotentialPerformance(observations);
  return (signal: RadarSignal): TrackRecord | null => {
    const key: PerformanceGroupKey | null = signal.bigFish?.entry ? 'BIG_FISH'
      : signal.trendConfirmation?.confirmed ? 'TREND_CONFIRMED'
        : signal.phase === 'BREAKOUT' || signal.phase === 'RETEST' ? 'STRUCTURE' : null;
    const group = key ? groups.find(item => item.key === key) : null;
    if (!group) return null;
    return { groupLabel: group.label, windowLabel: '72 小時', completed: group.h72.count,
      average: group.h72.average, positiveRate: group.h72.positiveRate };
  };
}

/**
 * 決定驗證標示：回測（樣本足夠）＞入選追蹤（樣本足夠）＞未經驗證。
 * 樣本不足 20 筆時一律標示未經驗證，但仍把已知的少量數據寫在 detail，讓使用者自行判斷。
 */
export function resolveValidation(market: DashboardMarket, backtest: BacktestSummary | null,
  track: TrackRecord | null): PickValidation {
  const minimum = DASHBOARD_RULES.minValidationSamples;
  const notes: string[] = [];
  if (backtest && backtest.totalTrades >= minimum) {
    return { status: 'BACKTEST',
      label: `回測 ${backtest.totalTrades} 筆：勝率 ${backtest.winRatePct.toFixed(0)}%、報酬 ${signed(backtest.totalReturnPct)}`,
      detail: `你的回測 #${backtest.backtestId}（${backtest.strategyId}／${backtest.interval}，已扣手續費與滑價）；過去績效不代表未來。` };
  }
  if (backtest) notes.push(`回測 #${backtest.backtestId} 僅 ${backtest.totalTrades} 筆交易，樣本不足`);
  if (track && track.completed >= minimum && track.average != null) {
    return { status: 'TRACKED',
      label: `入選追蹤 ${track.completed} 筆：${track.windowLabel}平均 ${signed(track.average)}、上漲比例 ${(track.positiveRate ?? 0).toFixed(0)}%`,
      detail: `「${track.groupLabel}」分組的雷達入選後追蹤；非正式回測，未扣手續費與滑價${market === 'CRYPTO' ? '' : '、未計跳空'}。` };
  }
  if (track) notes.push(`「${track.groupLabel}」入選追蹤已完成 ${track.completed} 筆（需 ${minimum} 筆）`);
  else notes.push('此訊號類型沒有對應的入選追蹤分組');
  return { status: 'UNVERIFIED', label: '未經回測驗證', detail: `${notes.join('；')}。只代表條件符合，請自行評估。` };
}

/** 排序用：已驗證且期望為正 → 1；未驗證 → 0；已驗證但期望為負 → -1。 */
export function validationEdge(validation: PickValidation, backtest: BacktestSummary | null, track: TrackRecord | null) {
  if (validation.status === 'BACKTEST' && backtest) return backtest.totalReturnPct > 0 ? 1 : -1;
  if (validation.status === 'TRACKED' && track?.average != null) return track.average > 0 ? 1 : -1;
  return 0;
}
