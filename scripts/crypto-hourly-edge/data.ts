/** @file 1h→4h 研究的標的池快照與歷史 K 線快取；只讀交易所公開行情，不碰帳戶、資料庫、下單或 Slack。 */
/**
 * 【詳細繁體中文註解】：研究資料準備
 *
 * 標的池定義（使用者需求「24 小時交易量 300 萬 USDT」）：
 *   - Binance 現貨 USDT 交易對，或 Binance USDⓈ-M 永續（underlyingType = COIN），
 *     24 小時「計價幣成交額」quoteVolume ≥ 3,000,000 USDT。
 *   - 排除穩定幣、法幣、黃金代幣、股票／指數／商品 TradFi 合約：它們不是本研究要預測的「虛擬幣」，
 *     價格行為（盯住 1 美元或跟隨美股盤）會扭曲 4 小時漲跌基礎比例。
 *   - 這是「今天」的快照，套用到過去會有倖存者偏誤（今天仍熱門的幣，過去多半漲過），
 *     因此研究腳本另外加上「逐時點」流動性門檻，並在報告揭露此偏誤。
 *
 * 歷史 K 線鐵則：只走 `marketData/binanceHistory.ts` 的 fetchBinanceRange（實際來源為 Bybit／Gate／Binance.US 現貨，
 * 同一標的整段鎖定單一來源）。不可走 stockService.fetchStockData()，該函式會用即時價覆寫最後一根 K。
 * fetchBinanceRange 已過濾未收盤 K 線，快取檔因此可重現。
 *
 * 外部 API 副作用：只發 GET 公開行情；以小併發與間隔避免觸發交易所限流。
 * 快取寫在 research/（已被 .gitignore 排除，體積約數百 MB，可隨時重抓）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchBinanceRange } from '../../app/services/marketData/binanceHistory';
import type { Candle } from '../../app/services/strategy/types';

/** 研究輸出根目錄（gitignore 內），所有大型快取與結果 JSON 都放這裡。 */
export const RESEARCH_DIR = 'research/crypto-1h-4h-2026-10-26';
/** 24 小時成交額門檻，單位 USDT（使用者指定 300 萬）。 */
export const MIN_QUOTE_VOLUME_USDT = 3_000_000;
/** 歷史抓取起點（UTC）：比樣本起點 2025-01-01 早三個月，留給 EMA200／4h 指標暖機。 */
export const HISTORY_START = Date.UTC(2024, 9, 1);
/** 歷史抓取終點（UTC，不含）：固定在快照日 00:00，避免重跑時多出新 K 讓結果不可重現。 */
export const HISTORY_END = Date.UTC(2026, 9, 26);

/** 穩定幣／法幣／黃金代幣：價格非自由波動，不屬於研究標的。 */
const NON_CRYPTO_BASES = new Set(['USDC', 'FDUSD', 'TUSD', 'USD1', 'XUSD', 'RLUSD', 'EUR', 'U', 'DAI', 'USDP',
  'BUSD', 'PYUSD', 'USDE', 'USDS', 'AEUR', 'XAUT', 'PAXG', 'USTC', 'BFUSD']);

export interface UniverseEntry { symbol: string; quoteVolumeUsdt: number; venues: ('SPOT' | 'PERP')[] }
export interface Universe { observedAt: string; minQuoteVolumeUsdt: number; entries: UniverseEntry[]; excluded: string[] }

/** 從 Binance 公開 24h ticker 與永續 exchangeInfo 建立今日標的池；只讀 GET，失敗直接中止。 */
export async function fetchUniverseSnapshot(): Promise<Universe> {
  const getJson = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${url} 回應 ${response.status}`);
    return response.json() as Promise<any>;
  };
  const [spot, perp, perpInfo] = await Promise.all([
    getJson('https://api.binance.com/api/v3/ticker/24hr'),
    getJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
    getJson('https://fapi.binance.com/fapi/v1/exchangeInfo'),
  ]);
  /** 永續合約中屬於股票、指數、商品、外匯的 TradFi 商品底層代號；現貨的代幣化股票以「代號+B」命名，一併排除。 */
  const tradFiBases = new Set<string>();
  const coinPerps = new Set<string>();
  for (const info of perpInfo.symbols) {
    if (info.underlyingType === 'COIN' && info.contractType === 'PERPETUAL') coinPerps.add(info.symbol);
    else tradFiBases.add(String(info.baseAsset));
  }
  const map = new Map<string, UniverseEntry>();
  const excluded: string[] = [];
  const add = (symbol: string, quoteVolume: number, venue: 'SPOT' | 'PERP') => {
    if (!symbol.endsWith('USDT') || quoteVolume < MIN_QUOTE_VOLUME_USDT) return;
    const base = symbol.slice(0, -4);
    const stockLike = tradFiBases.has(base) || (base.endsWith('B') && tradFiBases.has(base.slice(0, -1)));
    /** 非 ASCII 代號（中文迷因幣）在其他交易所沒有對應現貨歷史，無法用同一資料源驗證。 */
    if (NON_CRYPTO_BASES.has(base) || stockLike || !/^[A-Z0-9]+$/.test(base)) { excluded.push(symbol); return; }
    const entry = map.get(symbol) ?? { symbol, quoteVolumeUsdt: 0, venues: [] };
    entry.quoteVolumeUsdt = Math.max(entry.quoteVolumeUsdt, quoteVolume);
    if (!entry.venues.includes(venue)) entry.venues.push(venue);
    map.set(symbol, entry);
  };
  for (const t of spot) add(t.symbol, Number(t.quoteVolume), 'SPOT');
  for (const t of perp) if (coinPerps.has(t.symbol)) add(t.symbol, Number(t.quoteVolume), 'PERP');
  const entries = [...map.values()].sort((a, b) => b.quoteVolumeUsdt - a.quoteVolumeUsdt);
  return { observedAt: new Date().toISOString(), minQuoteVolumeUsdt: MIN_QUOTE_VOLUME_USDT, entries, excluded: [...new Set(excluded)].sort() };
}

/** 單一標的快取格式：candles 以 [openTime, o, h, l, c, v] 陣列儲存以縮小體積。 */
interface CachedSeries { symbol: string; source: string; start: number; end: number; rows: number[][] }

export async function loadCachedSeries(symbol: string): Promise<{ source: string; candles: Candle[] } | null> {
  try {
    const raw = JSON.parse(gunzipSync(await readFile(join(RESEARCH_DIR, 'cache', `${symbol}.json.gz`))).toString()) as CachedSeries;
    if (raw.start !== HISTORY_START || raw.end !== HISTORY_END) return null;
    return { source: raw.source, candles: raw.rows.map(([openTime, open, high, low, close, volume]) => ({ openTime, open, high, low, close, volume })) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** 抓單一標的整段 1h 歷史並寫入快取；已有相同區間快取就直接沿用，不重複打 API。 */
async function fetchAndCache(symbol: string): Promise<{ symbol: string; bars: number; source?: string; error?: string }> {
  const cached = await loadCachedSeries(symbol);
  if (cached) return { symbol, bars: cached.candles.length, source: cached.source };
  try {
    /** 約 755 天 × 24 根 ≈ 18,120 根，單頁 1000 根，maxPages 30 足夠一次抓完。 */
    const result = await fetchBinanceRange(symbol, '1h', HISTORY_START, HISTORY_END - 1, 30, { requestTimeoutMs: 15_000 });
    if (!result.complete) throw new Error('分頁未抓完');
    const unique = [...new Map(result.candles.map(c => [c.openTime, c])).values()]
      .filter(c => c.openTime >= HISTORY_START && c.openTime < HISTORY_END)
      .sort((a, b) => a.openTime - b.openTime);
    const payload: CachedSeries = { symbol, source: result.source, start: HISTORY_START, end: HISTORY_END,
      rows: unique.map(c => [c.openTime, c.open, c.high, c.low, c.close, c.volume]) };
    await writeFile(join(RESEARCH_DIR, 'cache', `${symbol}.json.gz`), gzipSync(JSON.stringify(payload)));
    return { symbol, bars: unique.length, source: result.source };
  } catch (error) {
    return { symbol, bars: 0, error: (error as Error).message };
  }
}

/**
 * Gate 補抓：Gate 公開 K 線只允許「距今 10,000 根以內」（1h 約 416 天），從 HISTORY_START 起抓會回 400，
 * fetchBinanceRange 的自動備援因此對舊區段永遠失敗。對 Bybit 抓不到或歷史太短（< 9,000 根）的標的，
 * 改以 forcedSource=GATE_SPOT 從距今 9,950 根起抓，取兩者中較長者；同一標的仍只用單一來源，不拼接。
 */
const GATE_MAX_POINTS = 9_950;

async function gateBackfill(symbol: string, existingBars: number): Promise<{ bars: number; source?: string; error?: string }> {
  const start = Math.max(HISTORY_START, Math.floor((Date.now() - GATE_MAX_POINTS * 3_600_000) / 3_600_000) * 3_600_000);
  try {
    const result = await fetchBinanceRange(symbol, '1h', start, HISTORY_END - 1, 12, { forcedSource: 'GATE_SPOT', requestTimeoutMs: 15_000 });
    const unique = [...new Map(result.candles.map(c => [c.openTime, c])).values()]
      .filter(c => c.openTime < HISTORY_END).sort((a, b) => a.openTime - b.openTime);
    if (!result.complete || unique.length <= existingBars) return { bars: existingBars, error: 'Gate 未較長' };
    const payload: CachedSeries = { symbol, source: result.source, start: HISTORY_START, end: HISTORY_END,
      rows: unique.map(c => [c.openTime, c.open, c.high, c.low, c.close, c.volume]) };
    await writeFile(join(RESEARCH_DIR, 'cache', `${symbol}.json.gz`), gzipSync(JSON.stringify(payload)));
    return { bars: unique.length, source: result.source };
  } catch (error) {
    return { bars: existingBars, error: (error as Error).message };
  }
}

/** 主流程：快照標的池 → 以 4 併發抓歷史 → Gate 補抓短歷史 → 寫 universe.json 與抓取紀錄。 */
async function main() {
  await mkdir(join(RESEARCH_DIR, 'cache'), { recursive: true });
  const universePath = join(RESEARCH_DIR, 'universe.json');
  let universe: Universe;
  try { universe = JSON.parse(await readFile(universePath, 'utf8')); }
  catch { universe = await fetchUniverseSnapshot(); await writeFile(universePath, JSON.stringify(universe, null, 2)); }
  console.log(`標的池 ${universe.entries.length} 檔（排除 ${universe.excluded.length} 檔），快照 ${universe.observedAt}`);
  const queue = [...universe.entries.map(e => e.symbol)];
  const log: Awaited<ReturnType<typeof fetchAndCache>>[] = [];
  const worker = async () => {
    for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
      const row = await fetchAndCache(symbol);
      log.push(row);
      console.log(`${log.length}/${universe.entries.length} ${symbol} ${row.bars} ${row.source ?? row.error}`);
      /** 每檔之間稍作停頓，四個 worker 合計遠低於 Bybit／Gate 公開端點限流。 */
      await delay(150);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  /** 永續的 1000PEPE 等「千倍單位」合約若已有同底層現貨，跳過避免同一幣重複計入樣本。 */
  const symbols = new Set(universe.entries.map(e => e.symbol));
  for (const row of log) {
    if (row.bars >= 9_000) continue;
    const thousand = row.symbol.match(/^1000(.+)$/)?.[1];
    if (thousand && symbols.has(thousand)) { row.error = `與 ${thousand} 重複，略過`; continue; }
    const filled = await gateBackfill(row.symbol, row.bars);
    if (filled.source) Object.assign(row, filled, { error: undefined });
    console.log(`Gate 補抓 ${row.symbol} → ${filled.bars} ${filled.source ?? filled.error}`);
    await delay(150);
  }
  await writeFile(join(RESEARCH_DIR, 'fetch-log.json'), JSON.stringify(log.sort((a, b) => a.symbol.localeCompare(b.symbol)), null, 2));
}

if (process.argv[1]?.endsWith('data.ts')) await main();
