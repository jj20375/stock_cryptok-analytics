/** @file 選股參考資料契約；財務期間、來源讀取時間與新聞發布時間分開保存。 */
import type { PublicSourceStatus, StockFinancialEvidence } from '../stockResearch/types';

export type BriefMarket = 'TW' | 'US';
export interface StockNewsItem {
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  kind: 'announcement' | 'news';
}
export interface StockValuation {
  pe: number | null;
  pb: number | null;
  /** 殖利率統一以百分點表示，例如 3.5 代表 3.5%，不是 350%。 */
  dividendYieldPct: number | null;
  asOf: string | null;
  source: PublicSourceStatus;
}
export interface StockBrief {
  symbol: string;
  market: BriefMarket;
  name: string;
  isFund: boolean;
  fetchedAt: string;
  valuation: StockValuation | null;
  financials: StockFinancialEvidence | null;
  news: StockNewsItem[];
  sources: PublicSourceStatus[];
  warnings: string[];
}

/** 台股保留上市／上櫃尾碼；ETF 的英文字尾也需通過固定格式，不能拼入任意網址。 */
export function normalizeBriefSymbol(symbol: string, market: string): string | null {
  const value = symbol.trim().toUpperCase();
  if (market === 'US') return /^[A-Z][A-Z0-9.-]{0,14}$/.test(value) ? value : null;
  if (market !== 'TW' || !/^\d{4,6}[A-Z]?(?:\.TW|\.TWO)?$/.test(value)) return null;
  return value.includes('.') ? value : `${value}.TW`;
}

/** 台股 00 開頭基金及 020 開頭 ETN 不套用發行公司的營收／EPS。 */
export function isTaiwanFund(symbol: string): boolean {
  return /^(?:00\d|020\d)/.test(symbol);
}
