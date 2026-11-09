/** @file 掃描 Bitget 美股現貨 rToken；每輪只抓成交額前二十檔，錯誤保留在報告，不送單。 */
import { analyzeStockToken } from './analysis';
import { loadStockTokenCandles, loadStockTokenInstruments, loadStockTokenQuotes, stockTokenQuoteIssue } from './market';
import { STOCK_TOKEN_RULES as RULES, type StockTokenCandidate, type StockTokenReport } from './types';

export async function collectStockTokenReport(now = Date.now(), signal = AbortSignal.timeout(150_000)): Promise<StockTokenReport> {
  const [instruments, quotes] = await Promise.all([loadStockTokenInstruments(signal), loadStockTokenQuotes(signal)]);
  const bySymbol = new Map(quotes.map(quote => [quote.symbol, quote]));
  const exclusions: Record<string, number> = {};
  const eligible = instruments.filter(item => {
    const issue = stockTokenQuoteIssue(bySymbol.get(item.symbol), now);
    if (issue) exclusions[issue] = (exclusions[issue] ?? 0) + 1;
    return !issue;
  })
    .sort((a, b) => bySymbol.get(b.symbol)!.platformTurnover - bySymbol.get(a.symbol)!.platformTurnover || a.symbol.localeCompare(b.symbol));
  const candidates: StockTokenCandidate[] = [];
  let failed = 0;
  for (const instrument of eligible.slice(0, RULES.scanLimit)) {
    signal.throwIfAborted();
    try {
      const [hourly, fourHourly] = await Promise.all([
        loadStockTokenCandles(instrument.symbol, '1H', now, signal), loadStockTokenCandles(instrument.symbol, '4H', now, signal),
      ]);
      candidates.push(analyzeStockToken(instrument, bySymbol.get(instrument.symbol), { hourly, fourHourly }, now));
    } catch (error) {
      signal.throwIfAborted();
      failed++;
      candidates.push({ ...instrument, status: 'ERROR', reasons: [error instanceof Error ? error.message : '行情讀取失敗'],
        plan: null, quote: bySymbol.get(instrument.symbol) ?? null, volumeRatio: null, rsi14: null });
    }
  }
  candidates.sort((a, b) => Number(b.status === 'ENTRY') - Number(a.status === 'ENTRY')
    || (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0) || a.symbol.localeCompare(b.symbol));
  return { version: RULES.version, startedAt: now, completedAt: Date.now(), total: instruments.length, eligible: eligible.length, exclusions,
    selected: candidates.length, failed, candidates, error: null };
}
