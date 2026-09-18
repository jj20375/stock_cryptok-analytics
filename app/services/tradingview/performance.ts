/** @file 紙上交易績效彙整；未平倉一律排除在報酬統計外，不以 0 充當缺值。 */

export interface TradeRecord {
  id: string;
  market: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryAt: number;
  entryPrice: number;
  entryNote: string | null;
  exitAt: number | null;
  exitPrice: number | null;
  returnPct: number | null;
  closed: boolean;
}

export interface PerformanceSummary {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winCount: number;
  /** 分母為已平倉筆數；沒有已平倉樣本時為 null，不顯示成 0%。 */
  winRate: number | null;
  averageReturn: number | null;
  bestReturn: number | null;
  worstReturn: number | null;
  /** 依出場時間序把每筆報酬連乘，代表「每次全額投入單一部位」的累積結果。 */
  compoundReturn: number | null;
  /** 等權重加總，代表「每筆固定金額」的合計報酬，與複利並列避免單一數字誤導。 */
  sumReturn: number | null;
  lastExitAt: number | null;
}

export interface SymbolPerformance extends PerformanceSummary {
  market: string;
  symbol: string;
}

const closedReturns = (trades: TradeRecord[]) => trades
  .filter(trade => trade.closed && trade.returnPct != null && Number.isFinite(trade.returnPct))
  .sort((left, right) => (left.exitAt ?? 0) - (right.exitAt ?? 0));

export function summarizeTrades(trades: TradeRecord[]): PerformanceSummary {
  const closed = closedReturns(trades);
  const values = closed.map(trade => trade.returnPct as number);
  const wins = values.filter(value => value > 0).length;
  const compound = values.length
    ? (values.reduce((carry, value) => carry * (1 + value / 100), 1) - 1) * 100
    : null;
  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.filter(trade => !trade.closed).length,
    winCount: wins,
    winRate: values.length ? wins / values.length * 100 : null,
    averageReturn: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    bestReturn: values.length ? Math.max(...values) : null,
    worstReturn: values.length ? Math.min(...values) : null,
    compoundReturn: compound,
    sumReturn: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    lastExitAt: closed.length ? closed[closed.length - 1].exitAt : null,
  };
}

/** 依標的分組，讓「哪一檔真的有貢獻」一眼可見；排序以累積報酬由高到低，未平倉不影響排序。 */
export function summarizeBySymbol(trades: TradeRecord[]): SymbolPerformance[] {
  const groups = new Map<string, TradeRecord[]>();
  for (const trade of trades) {
    const key = `${trade.market}:${trade.symbol}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(trade); else groups.set(key, [trade]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [market, symbol] = key.split(':');
      return { market, symbol, ...summarizeTrades(group) };
    })
    .sort((left, right) => (right.compoundReturn ?? -Infinity) - (left.compoundReturn ?? -Infinity));
}

/** 篩選條件皆為選用；symbol 以不分大小寫的子字串比對，方便直接打「SOL」。 */
export function filterTrades(trades: TradeRecord[], filters: { market?: string; symbol?: string }) {
  const market = filters.market?.trim();
  const symbol = filters.symbol?.trim().toLowerCase();
  return trades.filter(trade => {
    if (market && market !== 'all' && trade.market !== market) return false;
    if (symbol && !trade.symbol.toLowerCase().includes(symbol)) return false;
    return true;
  });
}
