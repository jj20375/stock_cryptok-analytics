/**
 * @file 全市場自動化的商品清單；只讀 Bitget 公開行情，不使用帳戶憑證、不下單。
 *
 * 範圍依 2026-10-14 使用者決定：所有 Bitget USDT 永續（含股票、黃金等 RWA 合約），
 * 只保留正常交易且 24H 成交額達新倉流動性門檻者，避免掃描必定被流動性檢查擋下的商品。
 */
import { bitgetPublic, FUTURES_MIN_QUOTE_VOLUME_USDT, validFuturesSymbol } from './market.server';

type Row = Record<string, string | undefined>;

/** 清單快取十分鐘：成交額排名變化慢，且每分鐘排程不必重抓 800 多筆合約規格。 */
const UNIVERSE_CACHE_MS = 10 * 60_000;
let cache: { at: number; symbols: string[] } | null = null;

/** 純函式：依合約狀態、代號格式與 24H 成交額過濾，成交額高者優先掃描。 */
export function selectFuturesUniverse(tickers: Row[], contracts: Row[], minQuoteVolumeUsdt = FUTURES_MIN_QUOTE_VOLUME_USDT) {
  const tradable = new Set(contracts.filter(row => row.symbolStatus === 'normal' && row.symbolType === 'perpetual'
    && row.quoteCoin === 'USDT').map(row => row.symbol));
  return tickers
    .map(row => ({ symbol: row.symbol ?? '', volume: Number(row.usdtVolume) }))
    .filter(row => validFuturesSymbol(row.symbol) && tradable.has(row.symbol) && Number.isFinite(row.volume) && row.volume >= minQuoteVolumeUsdt)
    .sort((a, b) => b.volume - a.volume)
    .map(row => row.symbol);
}

export async function futuresAutomationUniverse(now = Date.now()) {
  if (cache && now - cache.at < UNIVERSE_CACHE_MS) return cache.symbols;
  const [tickers, contracts] = await Promise.all([
    bitgetPublic<Row[]>('market/tickers', { productType: 'USDT-FUTURES' }),
    bitgetPublic<Row[]>('market/contracts', { productType: 'USDT-FUTURES' }),
  ]);
  if (!Array.isArray(tickers) || !Array.isArray(contracts)) throw new Error('Bitget 全市場合約清單格式錯誤');
  const symbols = selectFuturesUniverse(tickers, contracts);
  /** 行情異常回傳空清單時不覆寫快取，避免整輪誤判為沒有可交易商品。 */
  if (!symbols.length) throw new Error('Bitget 全市場合約清單為空，暫停本輪掃描');
  cache = { at: now, symbols };
  return symbols;
}

/** 測試用：清除模組快取，避免不同測試案例共用上一輪清單。 */
export function resetFuturesUniverseCache() { cache = null; }
