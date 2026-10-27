/** @file 以風險為上限的資金管理模擬與「翻倉」蒙地卡羅；純計算，僅用樣本外交易紀錄，不下單。 */
/**
 * 【詳細繁體中文註解】：資金管理規則（研究模擬，不是投資建議）
 *
 * 單筆倉位 = 權益 × 單筆風險比例 ÷ 停損距離（2×ATR14）；停損觸發時虧損約為 1R = 權益 × 風險比例。
 * 風控疊加規則（全部以「已實現權益」判斷）：
 *   1. 同時最多 MAX_CONCURRENT 筆、同幣不重複持倉；單筆名目不超過權益 50%，總名目不超過權益 2 倍。
 *   2. 連虧降倉：連續 3 筆虧損後風險減半，直到下一筆獲利恢復。
 *   3. 回撤降倉：權益距高點回撤 ≥ 15% 時風險減半。
 *   4. 回撤熔斷：回撤 ≥ 25% 時停止開新倉 7 天（168 小時），之後以當下權益為新高點、半風險重新開始。
 *   5. 複利：風險比例乘上「當前權益」，獲利後部位自動放大，即所謂翻倉；虧損後部位自動縮小。
 * 簡化假設：同小時多筆訊號依 |分數| 由大到小挑選；出場後才結算權益（持倉中的浮動虧損受停損約束，未逐根盯市）。
 */
import { maxDrawdown, seededRandom } from './stats';

export interface OosTrade { hour: number; symbol: number; side: 1 | -1; gross: number; stopPct: number; score: number }

export interface PortfolioConfig {
  /** 單筆風險比例（0.01 = 每筆停損虧權益 1%）。 */
  riskFraction: number;
  /** 來回成本（比例），含雙邊手續費與滑價。 */
  cost: number;
  maxConcurrent: number;
  /** false 時以初始資金計算部位（不複利），用來對照複利效果。 */
  compound: boolean;
  /** 是否啟用連虧降倉、回撤降倉與熔斷。 */
  riskControls: boolean;
}

export interface PortfolioResult {
  finalEquity: number; trades: number; wins: number; maxDrawdown: number; haltedTimes: number; skipped: number;
  curve: { hour: number; equity: number }[];
  /** 實際成交（通過同時持倉上限與風控）的交易，供蒙地卡羅抽樣，避免把無法同時持有的訊號全部算進去。 */
  taken: OosTrade[];
}

const HOLD_HOURS = 5;          // 訊號 h 收盤 → h+1 開盤進場 → h+5 開盤出場
const MAX_NOTIONAL_PER_TRADE = 0.5;
const MAX_GROSS_EXPOSURE = 2;
const LOSS_STREAK_CUT = 3;
const DD_REDUCE = 0.15;
const DD_HALT = 0.25;
const HALT_HOURS = 168;

export function simulatePortfolio(trades: OosTrade[], config: PortfolioConfig): PortfolioResult {
  const byHour = new Map<number, OosTrade[]>();
  for (const t of trades) (byHour.get(t.hour) ?? byHour.set(t.hour, []).get(t.hour)!).push(t);
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  let equity = 1, peak = 1, lossStreak = 0, haltUntil = -Infinity, haltedTimes = 0, wins = 0, count = 0, skipped = 0;
  const open: { exitHour: number; symbol: number; notional: number; pnl: number }[] = [];
  const taken: OosTrade[] = [];
  const curve: { hour: number; equity: number }[] = [{ hour: hours[0] ?? 0, equity: 1 }];
  const settle = (untilHour: number) => {
    open.sort((a, b) => a.exitHour - b.exitHour);
    while (open.length && open[0].exitHour <= untilHour) {
      const position = open.shift()!;
      equity += position.pnl;
      count++;
      if (position.pnl > 0) { wins++; lossStreak = 0; } else lossStreak++;
      peak = Math.max(peak, equity);
      curve.push({ hour: position.exitHour, equity });
      if (config.riskControls && (peak - equity) / peak >= DD_HALT && untilHour >= haltUntil) {
        haltUntil = position.exitHour + HALT_HOURS; haltedTimes++; peak = equity;
      }
    }
  };
  for (const hour of hours) {
    settle(hour + 1);
    if (equity <= 0) break;
    if (config.riskControls && hour < haltUntil) { skipped += byHour.get(hour)!.length; continue; }
    const candidates = byHour.get(hour)!.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    for (const t of candidates) {
      const gross = open.reduce((s, p) => s + p.notional, 0);
      if (open.length >= config.maxConcurrent || open.some(p => p.symbol === t.symbol)) { skipped++; continue; }
      let risk = config.riskFraction;
      if (config.riskControls) {
        if (lossStreak >= LOSS_STREAK_CUT) risk *= 0.5;
        if ((peak - equity) / peak >= DD_REDUCE) risk *= 0.5;
      }
      const base = config.compound ? equity : 1;
      const notional = Math.min((base * risk) / t.stopPct, base * MAX_NOTIONAL_PER_TRADE, Math.max(0, base * MAX_GROSS_EXPOSURE - gross));
      if (notional <= 0) { skipped++; continue; }
      open.push({ exitHour: hour + HOLD_HOURS, symbol: t.symbol, notional, pnl: notional * (t.gross - config.cost) });
      taken.push(t);
    }
  }
  settle(Infinity);
  return { finalEquity: equity, trades: count, wins, maxDrawdown: maxDrawdown(curve.map(p => p.equity)), haltedTimes, skipped, curve, taken };
}

export interface RuinRow { riskFraction: number; tradesPerDay: number; medianFinal: number; pDouble: number; pHalf: number; pRuin80: number; medianMaxDd: number }

/**
 * 翻倉蒙地卡羅：先用組合規則（最多 5 筆同時持倉、不開風控）篩出「實際可成交」的交易，
 * 再依「日」分組後有放回抽 365 天，逐日複利。
 * 當日報酬 = 風險比例 × Σ 當日各筆淨 R（R = 淨報酬 ÷ 停損距離），保留同日交易的相關性。
 * 回報一年後權益 ≥ 2 倍的機率、腰斬機率（權益曾低於 50%）、虧損 80% 機率（實務上等同爆倉）。
 */
/**
 * rShift：每筆 R 額外加上的「假設優勢」，0 = 真實樣本外結果；正值只用來示範「如果真的有優勢」時翻倉與破產的取捨，
 * 報告中必須標示為假設情境，不是本策略的實際表現。
 */
export function ruinMonteCarlo(signals: OosTrade[], cost: number, riskFractions: number[], paths = 2000, seed = 7, rShift = 0): RuinRow[] {
  const trades = simulatePortfolio(signals, { riskFraction: 0.01, cost, maxConcurrent: 5, compound: false, riskControls: false }).taken;
  const byDay = new Map<number, number>();
  for (const t of trades) {
    const day = Math.floor(t.hour / 24);
    byDay.set(day, (byDay.get(day) ?? 0) + (t.gross - cost) / t.stopPct + rShift);
  }
  /** 沒有交易的日子也要納入抽樣（報酬 0），否則會高估交易頻率。 */
  const allDays = trades.length ? Math.max(...byDay.keys()) - Math.min(...byDay.keys()) + 1 : 0;
  const dayR = [...byDay.values(), ...new Array(Math.max(0, allDays - byDay.size)).fill(0)];
  return riskFractions.map(riskFraction => {
    const random = seededRandom(seed);
    const finals: number[] = [], dds: number[] = [];
    let halved = 0, ruined = 0;
    for (let p = 0; p < paths; p++) {
      let equity = 1, peak = 1, worst = 0, low = 1;
      for (let d = 0; d < 365 && dayR.length; d++) {
        /** 單日最多虧光當下權益（R 加總極端時以 -100% 截斷，代表帳戶歸零）。 */
        equity *= Math.max(0, 1 + riskFraction * dayR[Math.floor(random() * dayR.length)]);
        peak = Math.max(peak, equity); worst = Math.max(worst, (peak - equity) / peak); low = Math.min(low, equity);
      }
      finals.push(equity); dds.push(worst);
      if (low <= 0.5) halved++;
      if (low <= 0.2) ruined++;
    }
    finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    return { riskFraction, tradesPerDay: trades.length / (dayR.length || 1), medianFinal: finals[Math.floor(paths / 2)], pDouble: finals.filter(v => v >= 2).length / paths,
      pHalf: halved / paths, pRuin80: ruined / paths, medianMaxDd: dds[Math.floor(paths / 2)] };
  });
}

/** 凱利比例（以 R 為單位）：f* = 平均 R ÷ R 的變異數；平均 R ≤ 0 時凱利建議為 0（不下注）。 */
export function kellyFraction(trades: OosTrade[], cost: number): { meanR: number; sdR: number; kelly: number } {
  const rs = trades.map(t => (t.gross - cost) / t.stopPct);
  const meanR = rs.reduce((s, v) => s + v, 0) / (rs.length || 1);
  const variance = rs.reduce((s, v) => s + (v - meanR) ** 2, 0) / Math.max(1, rs.length - 1);
  return { meanR, sdR: Math.sqrt(variance), kelly: meanR > 0 ? meanR / variance : 0 };
}
