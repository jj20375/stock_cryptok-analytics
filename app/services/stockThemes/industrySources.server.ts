/**
 * @file 股票產業別公開資料來源（證交所 OpenAPI、Nasdaq 公開篩選器），含 Worker 記憶體快取。
 *
 * 【詳細繁體中文註解】：
 * - 台股：https://openapi.twse.com.tw/v1/opendata/t187ap03_L（上市公司基本資料，含「產業別」兩碼代號）。
 * - 美股：https://api.nasdaq.com/api/screener/stocks（含 sector／industry 英文欄位）。
 * - 兩者皆免金鑰；每份資料在同一個 Worker isolate 內快取 INDUSTRY_CACHE_TTL_MS（12 小時），
 *   日報一天只跑數次，不會對來源造成壓力。
 * - 失敗策略（fallback）：任何網路錯誤、逾時或格式異常一律回傳「空表」並以 console.warn 記錄，
 *   絕不拋出例外，確保日報本身照常送出；查無產業的股票再交給 AI 推估或顯示「未分類」。
 * - Nasdaq 可能拒絕部分雲端出口 IP，因此美股另有人工題材名單與 AI 推估兩層備援。
 */
import { TWSE_INDUSTRY_CODES, US_SECTOR_ZH } from './taxonomy';

export interface IndustryRecord {
  /** 繁體中文產業名稱。 */
  industry: string;
  /** 原始英文產業細項（僅美股），用於題材關鍵字比對。 */
  rawIndustry?: string;
}

/** 快取有效期間：12 小時。產業別極少變動，過期只為了吸收新上市公司。 */
export const INDUSTRY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** 單一來源最長等待 12 秒；Worker 排程有總執行時間限制，不能讓日報卡在產業資料。 */
const FETCH_TIMEOUT_MS = 12_000;

type CacheEntry = { at: number; map: Map<string, IndustryRecord> };
const cache: Partial<Record<'TW' | 'US', CacheEntry>> = {};

/** 測試用：清除 isolate 內快取，避免測試之間互相污染。 */
export const resetIndustryCache = () => { delete cache.TW; delete cache.US; };

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', ...headers },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

/** 解析證交所上市公司基本資料；代號 → 中文產業名稱。純函式，方便單元測試。 */
export function parseTwseCompanies(rows: unknown): Map<string, IndustryRecord> {
  const map = new Map<string, IndustryRecord>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows as Array<Record<string, unknown>>) {
    const code = String(row['公司代號'] ?? '').trim();
    const rawCode = String(row['產業別'] ?? '').trim();
    if (!/^\d{4,6}$/.test(code) || !/^\d{1,2}$/.test(rawCode)) continue;
    const industryCode = rawCode.padStart(2, '0');
    map.set(code, { industry: TWSE_INDUSTRY_CODES[industryCode] ?? `產業代號 ${industryCode}` });
  }
  return map;
}

/** 解析 Nasdaq 篩選器；代號（已移除分隔符號）→ 「中文 Sector・英文 Industry」。 */
export function parseNasdaqScreener(payload: unknown): Map<string, IndustryRecord> {
  const map = new Map<string, IndustryRecord>();
  const rows = (payload as { data?: { rows?: unknown } })?.data?.rows;
  if (!Array.isArray(rows)) return map;
  for (const row of rows as Array<Record<string, unknown>>) {
    const symbol = String(row.symbol ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sector = String(row.sector ?? '').trim();
    const rawIndustry = String(row.industry ?? '').trim();
    if (!symbol || (!sector && !rawIndustry)) continue;
    const sectorZh = US_SECTOR_ZH[sector] ?? sector;
    map.set(symbol, { industry: [sectorZh, rawIndustry].filter(Boolean).join('・'), rawIndustry });
  }
  return map;
}

/**
 * 取得指定市場的產業對照表；命中快取直接回傳，否則重新抓取。
 * 失敗時回傳空 Map（不寫入快取，下一次日報會再嘗試）。
 */
export async function getIndustryMap(market: 'TW' | 'US', now = Date.now()): Promise<Map<string, IndustryRecord>> {
  const hit = cache[market];
  if (hit && now - hit.at < INDUSTRY_CACHE_TTL_MS) return hit.map;
  try {
    const map = market === 'TW'
      ? parseTwseCompanies(await fetchJson('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'))
      : parseNasdaqScreener(await fetchJson('https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true'));
    if (map.size > 0) cache[market] = { at: now, map };
    return map;
  } catch (error) {
    console.warn(`[Stock Themes] ${market} 產業資料暫時無法取得，改用人工名單與 AI 推估：`, String(error));
    return new Map();
  }
}
