/**
 * @file 把台美股與潛力幣雷達快照轉成 Dashboard 清單項目；純函式、不抓行情、不寫入資料庫。
 * 入選資格沿用各雷達既有的候選判斷（流動性與過熱為硬風控），這裡不另創選股條件。
 */
import { bigFishLabel } from '../strategy/bigFish';
import { isRadarCandidate, PHASE_LABELS, QUARTER_MS, type RadarSnapshot } from '../potentialRadar/types';
import { isUsStockCandidate, US_STOCK_PHASE_LABELS, type UsStockSnapshot } from '../usStockRadar/types';
import { DASHBOARD_RULES, type DashboardMarket, type DashboardPick, type DashboardWatchItem,
  type PickLevels } from './types';
import { BIG_FISH_BACKTEST, backtestLookupKey, resolveValidation, validationEdge,
  type BacktestSummary, type TrackRecord } from './validation';
import type { RadarSignal } from '../potentialRadar/types';
import type { UsStockSignal } from '../usStockRadar/types';

/** 只有 WATCH／BREAKOUT／RETEST 是可列入的量價階段；WAIT、EXTENDED、EXCLUDED 只作說明。 */
const ACTIVE_PHASES = new Set(['WATCH', 'BREAKOUT', 'RETEST']);

/**
 * 進場區間：上緣是訊號 K 收盤參考價；下緣優先採突破位（突破／回踩型），否則採 4 小時 EMA20，
 * 兩者都必須介於停損與收盤之間才採用，否則退回收盤價（區間退化成單一價位）。
 * 停損參考固定採雷達的「結構失效價」；失效價不低於收盤時代表結構已破，不提供區間。
 */
export function buildLevels(price: number, invalidation: number,
  supports: Array<{ value: number | null | undefined; basis: string }>): PickLevels | null {
  if (!(price > 0) || !Number.isFinite(invalidation) || !(invalidation > 0) || invalidation >= price) return null;
  const support = supports.find(item => item.value != null && Number.isFinite(item.value) &&
    item.value > invalidation && item.value < price);
  return { entryLow: support?.value ?? price, entryHigh: price, stopLoss: invalidation,
    riskPct: (price - invalidation) / price * 100, entryBasis: support?.basis ?? '收盤參考價' };
}

export interface PickContext {
  market: DashboardMarket;
  /** 該市場最新一根已收盤 K 線的開盤時間；未知時為 null（無法判斷新鮮度時一律視為過時）。 */
  latestBarTime: number | null;
  backtests: Map<string, BacktestSummary>;
}

function stockStrategies(signal: UsStockSignal) {
  const labels: string[] = [];
  if (signal.bigFish.entry) labels.push(`經典${bigFishLabel(signal.bigFish)}（4h）`);
  if (ACTIVE_PHASES.has(signal.phase)) labels.push(US_STOCK_PHASE_LABELS[signal.phase]);
  if (signal.dailyTrendUp) labels.push('日線 EMA20／50 多頭');
  return labels;
}

export function stockSnapshotToPick(snapshot: UsStockSnapshot, context: PickContext,
  trackFor: (signal: UsStockSignal) => TrackRecord | null) {
  const signal = snapshot.signal!;
  const backtest = signal.bigFish.entry ? context.backtests.get(
    backtestLookupKey(BIG_FISH_BACKTEST.strategyId, BIG_FISH_BACKTEST.interval, snapshot.symbol)) ?? null : null;
  const track = trackFor(signal);
  const validation = resolveValidation(context.market, backtest, track);
  const breakoutType = signal.phase === 'BREAKOUT' || signal.phase === 'RETEST';
  const pick: DashboardPick = {
    market: context.market, symbol: snapshot.symbol, name: snapshot.name, price: signal.price,
    changePct: signal.changeDay, changeLabel: '當日', strategies: stockStrategies(signal), score: signal.score,
    reasons: signal.reasons, risks: signal.risks,
    levels: buildLevels(signal.price, signal.invalidation, [
      ...(breakoutType ? [{ value: signal.breakout, basis: '突破位' }] : []),
      { value: signal.ema20, basis: '4 小時 EMA20' },
    ]),
    signalClosedAt: signal.closedAt, signalTimeframe: '4 小時（日線確認）', checkedAt: snapshot.checkedAt,
    fresh: context.latestBarTime != null && signal.barTime === context.latestBarTime,
    validation, stockSnapshot: snapshot,
  };
  return { pick, edge: validationEdge(validation, backtest, track), priority: Number(signal.bigFish.entry) };
}

function cryptoStrategies(signal: RadarSignal) {
  const labels: string[] = [];
  if (signal.bigFish?.entry) labels.push(`${bigFishLabel(signal.bigFish)}（4h）`);
  if (signal.trendConfirmation?.confirmed) labels.push('趨勢共振（4h MA20＋日線 MA7）');
  if (ACTIVE_PHASES.has(signal.phase)) labels.push(`15 分量價：${PHASE_LABELS[signal.phase]}`);
  return labels;
}

export function cryptoSnapshotToPick(snapshot: RadarSnapshot, context: PickContext,
  trackFor: (signal: RadarSignal) => TrackRecord | null) {
  const signal = snapshot.signal!;
  const backtest = signal.bigFish?.entry ? context.backtests.get(
    backtestLookupKey(BIG_FISH_BACKTEST.strategyId, BIG_FISH_BACKTEST.interval, snapshot.symbol)) ?? null : null;
  const track = trackFor(signal);
  const validation = resolveValidation(context.market, backtest, track);
  const pick: DashboardPick = {
    market: context.market, symbol: snapshot.symbol, name: snapshot.symbol.replace(/USDT$/, '') + ' / USDT',
    price: signal.price, changePct: signal.change24h, changeLabel: '24 小時', strategies: cryptoStrategies(signal),
    score: signal.score, reasons: signal.reasons, risks: signal.risks,
    levels: buildLevels(signal.price, signal.invalidation, [{ value: signal.breakout, basis: '15 分突破位' }]),
    signalClosedAt: signal.barTime + QUARTER_MS, signalTimeframe: '15 分量價＋4 小時趨勢',
    checkedAt: snapshot.checkedAt,
    fresh: context.latestBarTime != null && signal.barTime === context.latestBarTime,
    validation, cryptoSnapshot: snapshot,
  };
  /** 沿用潛力幣雷達頁的排序：趨勢共振優先，再看吃大魚。 */
  const priority = Number(signal.trendConfirmation?.confirmed) * 2 + Number(signal.bigFish?.entry);
  return { pick, edge: validationEdge(validation, backtest, track), priority };
}

type Ranked = { pick: DashboardPick; edge: number; priority: number };

/**
 * 排序：既有雷達優先序（吃大魚／趨勢共振）→ 驗證績效（正期望優先、負期望墊後）→ 雷達品質分數 → 代號。
 * 不用 localeCompare，避免 SSR 與瀏覽器排序結果不同。
 */
export function rankPicks(items: Ranked[]): DashboardPick[] {
  return [...items].sort((left, right) => right.priority - left.priority || right.edge - left.edge ||
    right.pick.score - left.pick.score || (left.pick.symbol < right.pick.symbol ? -1 : left.pick.symbol > right.pick.symbol ? 1 : 0))
    .slice(0, DASHBOARD_RULES.maxPicks).map(item => item.pick);
}

export const isStockPickable = (snapshot: UsStockSnapshot) => !snapshot.error && !!snapshot.signal && isUsStockCandidate(snapshot.signal);
export const isCryptoPickable = (snapshot: RadarSnapshot) => !snapshot.error && !!snapshot.signal && isRadarCandidate(snapshot.signal);

/** 量價階段對應的未達條件說明；WATCH／BREAKOUT／RETEST 本身不是阻擋原因。 */
const PHASE_BLOCKERS: Record<string, string> = {
  EXTENDED: '漲幅過熱（硬風控）', EXCLUDED: '流動性不合格（硬風控）', WAIT: '量價條件未成立',
};

export function stockWatchItem(market: DashboardMarket, snapshot: UsStockSnapshot): DashboardWatchItem {
  const signal = snapshot.signal!;
  const blockers = [PHASE_BLOCKERS[signal.phase], !signal.dailyTrendUp && '日線 EMA20／50 未轉多']
    .filter((item): item is string => !!item);
  return { market, symbol: snapshot.symbol, name: snapshot.name, price: signal.price, changePct: signal.changeDay,
    changeLabel: '當日', score: signal.score, statusLabel: `${US_STOCK_PHASE_LABELS[signal.phase]}・${bigFishLabel(signal.bigFish)}`,
    blockers: blockers.length ? blockers : ['未通過雷達候選條件'], signalClosedAt: signal.closedAt, stockSnapshot: snapshot };
}

export function cryptoWatchItem(snapshot: RadarSnapshot): DashboardWatchItem {
  const signal = snapshot.signal!;
  const fish = signal.bigFish ? bigFishLabel(signal.bigFish) : '4 小時吃大魚未計算';
  const blockers = [PHASE_BLOCKERS[signal.phase]].filter((item): item is string => !!item);
  return { market: 'CRYPTO', symbol: snapshot.symbol, name: snapshot.symbol.replace(/USDT$/, '') + ' / USDT',
    price: signal.price, changePct: signal.change24h, changeLabel: '24 小時', score: signal.score,
    statusLabel: `${PHASE_LABELS[signal.phase]}・${fish}`, blockers: blockers.length ? blockers : ['未通過雷達候選條件'],
    signalClosedAt: signal.barTime + QUARTER_MS, cryptoSnapshot: snapshot };
}

/** 觀察清單依品質分數排序；同分以代號排序，避免 SSR／瀏覽器排序不一致。 */
export const rankWatchlist = (items: DashboardWatchItem[]) => [...items]
  .sort((left, right) => right.score - left.score || (left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0))
  .slice(0, DASHBOARD_RULES.maxWatch);

/** 清單為空時，依實際掃描結果說明原因，例如全部過熱、日線未確認或流動性不足。 */
export function explainEmpty(scanned: number, phases: string[], extra: string[] = []) {
  if (!scanned) return '本輪沒有任何標的完成分析，請參考下方的資料異常說明。';
  const count = (phase: string) => phases.filter(item => item === phase).length;
  const parts = [
    count('EXTENDED') && `${count('EXTENDED')} 檔漲幅過熱`,
    count('EXCLUDED') && `${count('EXCLUDED')} 檔流動性不合格`,
    count('WAIT') && `${count('WAIT')} 檔仍在等待量價條件`,
    ...extra,
  ].filter(Boolean);
  return `已分析 ${scanned} 檔，目前沒有標的同時通過既有雷達的候選條件${parts.length ? `：${parts.join('、')}` : ''}。`;
}
