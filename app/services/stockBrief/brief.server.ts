/** @file 按選定股票組合基本面及消息；全部為公開資料讀取，不呼叫 AI 或交易引擎。 */
import { fetchPublicResearch } from '../stockResearch/research.server';
import { getStockName } from '../marketData/stockSupport';
import { fetchBriefSource, sourceJson } from './source.server';
import { parseAnnouncements, parseStockNews, parseTaiwanValuation } from './normalize';
import { isTaiwanFund, type BriefMarket, type StockBrief, type StockValuation } from './types';

const taiwanSources = {
  TWSE: { valuation: 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', announcements: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L', label: '證交所' },
  TPEX: { valuation: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis', announcements: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O', label: '櫃買中心' },
};

export async function buildStockBrief(symbol: string, market: BriefMarket): Promise<StockBrief> {
  const [result, news, profile] = await Promise.all([
    market === 'TW' ? taiwanBrief(symbol) : usBrief(symbol),
    fetchBriefSource('Yahoo Finance 個股新聞', `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=${market}&lang=${market === 'TW' ? 'zh-TW' : 'en-US'}`),
    market === 'TW' && !isTaiwanFund(symbol) && symbol.endsWith('.TW') ?
      fetchBriefSource('證交所公司基本資料', 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L') : Promise.resolve(null),
  ]);
  const profiles = profile ? sourceJson(profile) : null;
  const company = Array.isArray(profiles) ? profiles.find(row => row?.['公司代號'] === symbol.split('.')[0]) : null;
  const aliases = typeof company?.['英文簡稱'] === 'string' ? [company['英文簡稱'].trim()] : [];
  if (news.source.status === 'ok' && !/<rss\b/i.test(news.text)) {
    news.source = { ...news.source, status: 'unavailable', message: '新聞來源格式無法辨識。' };
  }
  return { ...result, news: [...result.news, ...parseStockNews(news.text, symbol, result.name, market, Date.now(), aliases)]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), sources: [...result.sources, news.source, ...(profile ? [profile.source] : [])] };
}

async function taiwanBrief(symbol: string): Promise<StockBrief> {
  const isFund = isTaiwanFund(symbol), board = symbol.endsWith('.TWO') ? taiwanSources.TPEX : taiwanSources.TWSE;
  const [values, announcements, research] = await Promise.all([
    fetchBriefSource(`${board.label} 本益比／殖利率／股價淨值比`, board.valuation),
    fetchBriefSource(`${board.label} 重大訊息`, board.announcements),
    /** 基金不套用投信公司的公司財報；個股沿用既有官方財務快取。 */
    isFund ? Promise.resolve(null) : fetchPublicResearch(symbol),
  ]);
  const valueRows = sourceJson(values), announcementRows = sourceJson(announcements);
  for (const [response, rows] of [[values, valueRows], [announcements, announcementRows]] as const) {
    if (response.source.status === 'ok' && !Array.isArray(rows)) response.source = { ...response.source, status: 'unavailable', message: '官方資料格式無法辨識。' };
  }
  const official = isFund ? null : parseTaiwanValuation(valueRows, symbol, values.source);
  const financials = research?.financials ?? null;
  const fallbackName = getStockName(symbol);
  const name = official?.name ?? (financials?.name !== financials?.code ? financials?.name : null) ?? fallbackName;
  const warnings = isFund ? ['此標的是 ETF／ETN；公司營收與 EPS 不適用，請另核對基金持股、淨值、折溢價及配息公告。'] : [];
  if (!isFund && !official) warnings.push('目前查無此股官方估值資料；未提供的欄位不代表零或估值便宜。');
  warnings.push('重大訊息為官方最新批次資料，不是完整 30 天公告歷史；查無資料不代表沒有事件。');
  return { symbol, market: 'TW', name, isFund, fetchedAt: new Date().toISOString(), valuation: official?.valuation ?? null,
    financials, news: parseAnnouncements(announcementRows, symbol, announcements.source), warnings,
    sources: [values.source, announcements.source, ...(financials?.sources ?? [])] };
}

async function usBrief(symbol: string): Promise<StockBrief> {
  const [summary, chart] = await Promise.all([
    fetchBriefSource('Yahoo Finance 基本面', `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,price`),
    fetchBriefSource('Yahoo Finance 商品資料', `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`),
  ]);
  const details = sourceJson(summary)?.quoteSummary?.result?.[0];
  const meta = sourceJson(chart)?.chart?.result?.[0]?.meta;
  const detail = details?.summaryDetail, stats = details?.defaultKeyStatistics;
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  /** Yahoo 原始殖利率為比例，轉成百分點後才交給 UI，保留真實的零值。 */
  const yieldRatio = number(detail?.dividendYield?.raw ?? detail?.trailingAnnualDividendYield?.raw);
  const valuation: StockValuation | null = details ? {
    pe: number(detail?.trailingPE?.raw ?? stats?.trailingPE?.raw), pb: number(stats?.priceToBook?.raw),
    dividendYieldPct: yieldRatio === null ? null : yieldRatio * 100, asOf: null, source: summary.source,
  } : null;
  const isFund = ['ETF', 'MUTUALFUND'].includes(meta?.instrumentType ?? details?.price?.quoteType);
  const rawName = meta?.shortName ?? meta?.longName;
  return { symbol, market: 'US', name: typeof rawName === 'string' ? rawName.slice(0, 100) : symbol, isFund, fetchedAt: new Date().toISOString(),
    valuation: isFund ? null : valuation, financials: null, news: [], sources: [summary.source, chart.source],
    warnings: [isFund ? '基金的公司營收及 EPS 不適用，請核對基金持股、淨值與配息資料。' :
      '美股此區使用 Yahoo 資料；SEC 官方財報尚未接入。估值原始日期未提供，讀取時間不代表財報期間。',
      ...(!valuation && !isFund ? ['基本面來源暫無可用數字，仍可查看下方新聞與完整分析入口。'] : [])] };
}
