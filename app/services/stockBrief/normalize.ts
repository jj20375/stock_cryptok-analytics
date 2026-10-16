/** @file 公開新聞與估值正規化；拒絕未標日期、過期、危險連結及不同國家同代號的消息。 */
import { financialNumber, rocDate } from '../stockResearch/financials';
import type { StockNewsItem, StockValuation } from './types';
import type { PublicSourceStatus } from '../stockResearch/types';

const textValue = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

export function safeNewsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null;
    return url.href;
  } catch { return null; }
}

function decodeText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, key: string) => {
    const names: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    if (!key.startsWith('#')) return names[key.toLowerCase()] ?? entity;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).replace(/[\u0000-\u001f]/g, ' ').trim();
}

/** 近期範圍固定 30 天；資料日期不能用本機抓取時間補值，也不能展示未來新聞。 */
const recent = (stamp: number, now: number) => Number.isFinite(stamp) && stamp <= now && now - stamp <= 30 * 86_400_000;

export function parseStockNews(xml: string, symbol: string, name: string, market: 'TW' | 'US', now = Date.now(), aliases: string[] = []): StockNewsItem[] {
  const items: StockNewsItem[] = [], seen = new Set<string>();
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (tag: string) => decodeText(match[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '');
    const title = field('title'), url = safeNewsUrl(field('link')), stamp = Date.parse(field('pubDate'));
    if (!title || title.length > 500 || !url || !recent(stamp, now) || seen.has(title)) continue;
    if (market === 'TW') {
      const code = symbol.split('.')[0];
      /** Yahoo 的純數字代號可能混入日股；台股需明確標示本國代號或公司中文名稱。 */
      const companyName = name.replace(/\*$/, '');
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      /** 「世界」等兩字公司名稱只接受明確分隔，避免把普通用語誤認成個股題材。 */
      const named = /[\u3400-\u9fff]/.test(companyName) && (companyName.length >= 3 ? title.includes(companyName) :
        companyName.length === 2 && new RegExp(`(?:^|[\\s、，:：《【])${escape(companyName)}(?=$|[\\s、，,.。:：》】])`).test(title));
      /** 英文別名只取官方公司簡稱，例如 TSMC；不靠 AI 猜測新聞與公司的關係。 */
      const englishNamed = aliases.some(alias => /^[A-Z][A-Z .&-]{2,79}$/i.test(alias) && new RegExp(`(?:^|[^a-z0-9])${escape(alias)}(?=$|[^a-z0-9])`, 'i').test(title));
      const taiwanCode = new RegExp(`(?:TWSE|TPEX|TPE|TWO)\\s*:\\s*${code}(?![\\dA-Z])|\\b${code}\\.TW(?:O)?\\b`, 'i');
      if (!named && !englishNamed && !taiwanCode.test(title)) continue;
    }
    seen.add(title);
    items.push({ title, url, publisher: field('source').slice(0, 100) || new URL(url).hostname, publishedAt: new Date(stamp).toISOString(), kind: 'news' });
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 6);
}

export function parseAnnouncements(rows: unknown, symbol: string, source: PublicSourceStatus, now = Date.now()): StockNewsItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    if (!row || (row['公司代號'] ?? row.SecuritiesCompanyCode) !== symbol.split('.')[0]) return [];
    const date = rocDate(textValue(row['發言日期'])), time = String(row['發言時間'] ?? '').padStart(6, '0');
    const title = String(row['主旨 '] ?? row['主旨'] ?? '').trim();
    if (!date || !/^\d{6}$/.test(time) || +time.slice(0, 2) > 23 || +time.slice(2, 4) > 59 || +time.slice(4) > 59) return [];
    const stamp = Date.parse(`${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}+08:00`);
    if (!title || !recent(stamp, now)) return [];
    return [{ title, url: source.url, publisher: source.label, publishedAt: new Date(stamp).toISOString(), kind: 'announcement' as const }];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 4);
}

export function parseTaiwanValuation(rows: unknown, symbol: string, source: PublicSourceStatus): { name: string; valuation: StockValuation } | null {
  if (!Array.isArray(rows)) return null;
  const row = rows.find(item => item && (item.Code ?? item.SecuritiesCompanyCode) === symbol.split('.')[0]);
  if (!row) return null;
  return { name: textValue(row.Name ?? row.CompanyName)?.slice(0, 100) ?? symbol,
    valuation: { pe: financialNumber(textValue(row.PEratio ?? row.PriceEarningRatio)), pb: financialNumber(textValue(row.PBratio ?? row.PriceBookRatio)),
      dividendYieldPct: financialNumber(textValue(row.DividendYield ?? row.YieldRatio)), asOf: rocDate(textValue(row.Date)), source } };
}
