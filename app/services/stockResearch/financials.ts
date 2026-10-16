/** @file 正規化上市／上櫃官方營收及一般業財報；不將累計財報誤當單季。 */
import type { IncomeEvidence, MentionedStock, PublicSourceStatus, RevenueEvidence, StockFinancialEvidence, TaiwanMarket } from './types';

export type FinancialRow = Record<string, string>;
export interface FinancialTable {
  market: TaiwanMarket;
  kind: 'revenue' | 'income';
  rows: FinancialRow[];
  source: PublicSourceStatus;
}

export function parseFinancialRows(text: string): FinancialRow[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || !value.length || !value.every(row => row && typeof row === 'object' && !Array.isArray(row) &&
    Object.values(row).every(cell => typeof cell === 'string') && /^\d{4,6}$/.test(row['公司代號'] ?? row.SecuritiesCompanyCode ?? ''))) {
    throw new Error('官方資料格式不符');
  }
  return value;
}

export function financialNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const cleaned = value.trim().replaceAll(',', '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

/** 官方民國年月／日期轉西元；缺欄或無效日期維持缺值。 */
export function rocDate(value: string | undefined, monthOnly = false): string | null {
  if (!value || !(monthOnly ? /^\d{5}$/ : /^\d{7}$/).test(value)) return null;
  const year = Number(value.slice(0, 3)) + 1911;
  const month = Number(value.slice(3, 5)), day = monthOnly ? 1 : Number(value.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, monthOnly ? 7 : 10);
}

function revenueEvidence(row: FinancialRow): RevenueEvidence | null {
  const period = rocDate(row['資料年月'], true);
  if (!period) return null;
  return { period, exportedAt: rocDate(row['出表日期']), revenueThousandTwd: financialNumber(row['營業收入-當月營收']),
    yoyPct: financialNumber(row['營業收入-去年同月增減(%)']), momPct: financialNumber(row['營業收入-上月比較增減(%)']),
    cumulativeYoyPct: financialNumber(row['累計營業收入-前期比較增減(%)']) };
}

function incomeEvidence(row: FinancialRow): IncomeEvidence | null {
  const yearValue = financialNumber(row['年度'] ?? row.Year), quarter = financialNumber(row['季別'] ?? row.Season);
  if (yearValue === null || !Number.isInteger(yearValue) || yearValue < 90 || yearValue > 200 || quarter === null || ![1, 2, 3, 4].includes(quarter)) return null;
  const revenue = financialNumber(row['營業收入']);
  const margin = (value: string | undefined) => {
    const numerator = financialNumber(value);
    return numerator !== null && revenue !== null && revenue > 0 ? numerator / revenue * 100 : null;
  };
  return { year: yearValue + 1911, quarter, exportedAt: rocDate(row['出表日期'] ?? row.Date),
    cumulativeEpsTwd: financialNumber(row['基本每股盈餘（元）']),
    grossMarginPct: margin(row['營業毛利（毛損）淨額'] ?? row['營業毛利（毛損）']),
    operatingMarginPct: margin(row['營業利益（損失）']) };
}

export function listedStocks(tables: FinancialTable[]): MentionedStock[] {
  return tables.filter(table => table.kind === 'revenue').flatMap(table => table.rows.map(row => ({
    code: row['公司代號'], name: row['公司名稱'], symbol: `${row['公司代號']}.${table.market === 'TWSE' ? 'TW' : 'TWO'}`,
  }))).filter(stock => stock.name && stock.code);
}

export function buildFinancialEvidence(symbol: string, tables: FinancialTable[], now = Date.now()): StockFinancialEvidence {
  const code = symbol.replace(/\.(TW|TWO)$/i, '');
  const requestedMarket = /\.TWO$/i.test(symbol) ? 'TPEX' : /\.TW$/i.test(symbol) ? 'TWSE' : null;
  const matching = tables.filter(table => !requestedMarket || table.market === requestedMarket).flatMap(table => {
    const rows = table.rows.filter(row => (row['公司代號'] ?? row.SecuritiesCompanyCode) === code);
    return rows.map(row => ({ ...table, row }));
  });
  const market = requestedMarket ?? matching[0]?.market ?? null;
  const selected = matching.filter(table => table.market === market);
  /** 若來源包含多個期間，依財報期間排序，不把出表日期當原始公告日期。 */
  const revenue = selected.filter(table => table.kind === 'revenue').map(table => revenueEvidence(table.row))
    .filter((item): item is RevenueEvidence => Boolean(item)).sort((a, b) => b.period.localeCompare(a.period))[0] ?? null;
  const income = selected.filter(table => table.kind === 'income').map(table => incomeEvidence(table.row))
    .filter((item): item is IncomeEvidence => Boolean(item)).sort((a, b) => b.year - a.year || b.quarter - a.quarter)[0] ?? null;
  const warnings: string[] = [];
  if (!revenue) warnings.push('查無月營收；可能尚未收錄、來源缺漏或不適用，不能視為營收為零。');
  if (!income) warnings.push('查無一般業財報；金融、保險等產業本版尚未涵蓋。');
  /** 超過三個月的營收或九個月的累計財報提示資料落後，不擅自外推最新一季。 */
  if (revenue && now - Date.parse(`${revenue.period}-01T00:00:00+08:00`) > 100 * 86_400_000) warnings.push('月營收期間距今超過 100 天，資料可能落後。');
  if (income && now - Date.UTC(income.year, income.quarter * 3, 0) > 270 * 86_400_000) warnings.push('財報期間距今超過 270 天，資料可能落後。');
  return { code, name: selected[0]?.row['公司名稱'] ?? selected[0]?.row.CompanyName ?? code, market, revenue, income,
    sources: tables.filter(table => !market || table.market === market).map(table => table.source), warnings };
}
