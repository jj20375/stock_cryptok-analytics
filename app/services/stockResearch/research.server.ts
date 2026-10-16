/** @file 組合題材及官方財務證據；不呼叫 AI、不寫資料庫、不產生交易或通知。 */
import { buildFinancialEvidence, listedStocks, parseFinancialRows, type FinancialTable } from './financials';
import { parsePublicPrograms } from './programs';
import { fetchPublicSource } from './sources.server';
import type { PublicResearch } from './types';

export async function fetchPublicResearch(symbol?: string): Promise<PublicResearch> {
  const keys = ['programs', 'twRevenue', 'twIncome', 'otcRevenue', 'otcIncome'] as const;
  const responses = await Promise.all(keys.map(key => fetchPublicSource(key)));
  const tables: FinancialTable[] = responses.slice(1).map((response, index) => {
    let source = { ...response.source }, rows: FinancialTable['rows'] = [];
    if (source.status === 'ok') {
      try { rows = parseFinancialRows(response.text); }
      catch { source = { ...source, status: 'unavailable', message: '公開資料格式變更，暫停使用此來源。' }; }
    }
    return { market: index < 2 ? 'TWSE' : 'TPEX', kind: index % 2 === 0 ? 'revenue' : 'income', rows, source };
  });
  const programs = parsePublicPrograms(responses[0].text, listedStocks(tables));
  const programSource = { ...responses[0].source };
  if (programSource.status === 'ok' && !programs.length) {
    programSource.status = 'unavailable';
    programSource.message = '目前未讀到近 14 天的公開單元標題；可能是來源改版或暫無近期資料。';
  }
  return { fetchedAt: new Date().toISOString(), programs,
    financials: symbol ? buildFinancialEvidence(symbol, tables) : null,
    sources: [programSource, ...tables.map(table => table.source)] };
}

/** 既有 AI 僅取得該股明確相關的標題與財報，不把全站題材套給每一家公司。 */
export function stockResearchContext(research: PublicResearch): string {
  const code = research.financials?.code;
  return JSON.stringify({ financials: research.financials,
    titleMentions: research.programs.filter(program => program.stocks.some(stock => stock.code === code)).slice(0, 5)
      .map(({ title, programDate, url }) => ({ title, programDate, url })),
    limitations: '僅公開標題，未讀取影片、字幕或會員內容；標題提及不是受惠證據。財報為年初至該季累計，出表日期不是原始公告日期。缺值不得自行補寫。' });
}
