/** @file 公開題材與財務證據契約；節目標題不代表公司受惠或買進訊號。 */
export type TaiwanMarket = 'TWSE' | 'TPEX';
export interface PublicSourceStatus {
  label: string;
  url: string;
  fetchedAt: string;
  status: 'ok' | 'unavailable';
  message?: string;
}
export interface MentionedStock {
  code: string;
  name: string;
  symbol: string;
}
export interface ProgramTopic {
  id: string;
  title: string;
  url: string;
  videoUrl: string;
  /** 由標題讀取的台北節目日期，並非影片發布時間。 */
  programDate: string;
  themes: string[];
  stocks: MentionedStock[];
}
export interface RevenueEvidence {
  period: string;
  exportedAt: string | null;
  /** 官方月營收以新台幣千元計，不能直接與以元計的市值相除。 */
  revenueThousandTwd: number | null;
  yoyPct: number | null;
  momPct: number | null;
  cumulativeYoyPct: number | null;
}
export interface IncomeEvidence {
  year: number;
  quarter: number;
  exportedAt: string | null;
  /** 財報是年初至該季累計，EPS 單位為新台幣元，毛利率單位為 %。 */
  cumulativeEpsTwd: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
}
export interface StockFinancialEvidence {
  code: string;
  name: string;
  market: TaiwanMarket | null;
  revenue: RevenueEvidence | null;
  income: IncomeEvidence | null;
  sources: PublicSourceStatus[];
  warnings: string[];
}
export interface PublicResearch {
  fetchedAt: string;
  programs: ProgramTopic[];
  sources: PublicSourceStatus[];
  financials: StockFinancialEvidence | null;
}
