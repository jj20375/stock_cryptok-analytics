/** @file Bitget／Bybit USDT 永續公開行情；不接受外部 URL、不以現貨資料冒充。 */
import type { Candle } from '../strategy/types';
import type { FundingPoint, MarginTier } from '../backtest/futures';
import { HOUR_MS } from '../strategy/futuresRegime';

export type FuturesCandleKind = 'TRADE' | 'MARK';
export type FuturesInstrument = 'BITGET_USDT_PERP' | 'BYBIT_USDT_PERP';
export const futuresCacheKey = (symbol: string, kind: FuturesCandleKind, instrument: FuturesInstrument = 'BITGET_USDT_PERP') =>
  `${instrument === 'BYBIT_USDT_PERP' ? 'BYBIT' : 'BITGET'}:USDT-PERP:${kind}:${symbol}`;
export const validFuturesSymbol = (symbol: unknown): symbol is string => typeof symbol === 'string' && /^[A-Z0-9]{2,20}USDT$/.test(symbol);

export async function bitgetPublic<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  try {
    const response = await fetch(`https://api.bitget.com/api/v2/mix/${endpoint}?${new URLSearchParams(params)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CryptoAnalytics/1.0' }, signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json() as { code: string; data: T; msg?: string; message?: string };
    /** 公開行情不含憑證；只記錄端點、狀態與短訊息，方便區分供應商拒絕與本機 TLS 失敗。 */
    if (response.status === 403) {
      console.warn('[Bitget Futures] 公開行情請求遭拒', { endpoint, status: response.status,
        code: payload?.code, message: String(payload?.msg ?? payload?.message ?? '').slice(0, 160) });
      throw new Error('Bitget 拒絕此環境的行情請求（403），請稍後重試；持續發生時需確認網路或交易所 API 存取限制。');
    }
    if (!response.ok || payload?.code !== '00000') throw new Error(`Bitget 永續資料暫時無法取得（${payload?.code ?? response.status}）`);
    return payload.data;
  } catch (error) {
    const failure = error as { name?: string; cause?: { code?: string } };
    /** 公開行情只記錄錯誤類別與代碼；不輸出原始請求、標頭或使用者憑證。 */
    if (error instanceof TypeError) console.warn('[Bitget Futures] 公開連線失敗', {
      endpoint, name: failure.name, causeCode: failure.cause?.code,
    });
    /** 本機 HTTPS 檢查可能回傳未受信任的憑證；清楚回報原因，不能停用驗證或改餵別家行情。 */
    if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(failure.cause?.code ?? '')) {
      throw new Error('Bitget 連線的憑證驗證失敗，請確認網路的 HTTPS 檢查憑證，或換用可正常連線的網路後重試。', { cause: error });
    }
    if (failure.name === 'TimeoutError' || failure.name === 'AbortError') throw new Error('Bitget 行情連線逾時，請稍後重試。', { cause: error });
    if (error instanceof TypeError) throw new Error('無法連線至 Bitget 行情服務，請檢查網路後重試。', { cause: error });
    if (error instanceof SyntaxError) throw new Error('Bitget 行情回應格式錯誤，可能受到網路攔截，請稍後重試。', { cause: error });
    throw error;
  }
}

export async function futuresCandlesPage(symbol: string, kind: FuturesCandleKind, from: number, to: number) {
  if (!validFuturesSymbol(symbol)) throw new Error('永續商品代號無效');
  /** 每頁固定 200 根 1H，使用排他的終點避免邊界重複；未收盤根一律排除。 */
  const end = Math.min(Math.floor(to / HOUR_MS) * HOUR_MS + HOUR_MS, Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
  const start = Math.max(Math.floor(from / HOUR_MS) * HOUR_MS, end - 200 * HOUR_MS);
  const rows = await bitgetPublic<string[][]>(kind === 'MARK' ? 'market/history-mark-candles' : 'market/history-candles', {
    symbol, productType: 'USDT-FUTURES', granularity: '1H', startTime: String(start), endTime: String(end), limit: '200',
  });
  if (!Array.isArray(rows)) throw new Error('Bitget 合約 K 線格式錯誤');
  const result = rows.map(row => {
    const [openTime, open, high, low, close, volume] = row.slice(0, 6).map(Number);
    if (![openTime, open, high, low, close, volume].every(Number.isFinite) || openTime % HOUR_MS || low <= 0 || volume < 0
      || low > Math.min(open, close) || high < Math.max(open, close)) throw new Error('Bitget 合約 K 線數值無效');
    return { openTime, open, high, low, close, volume };
  }).filter(c => c.openTime >= from && c.openTime <= to && c.openTime + HOUR_MS <= Date.now()).sort((a, b) => a.openTime - b.openTime);
  return result as Candle[];
}

export async function fundingPage(symbol: string, page: number): Promise<FundingPoint[]> {
  const rows = await bitgetPublic<Array<{ fundingTime: string; fundingRate: string }>>('market/history-fund-rate', {
    symbol, productType: 'USDT-FUTURES', pageSize: '100', pageNo: String(page),
  });
  if (!Array.isArray(rows)) throw new Error('Bitget 資金費率格式錯誤');
  return rows.map(row => {
    const time = Number(row.fundingTime), rate = Number(row.fundingRate);
    if (!Number.isFinite(time) || !Number.isFinite(rate) || Math.abs(rate) > 1 || time % HOUR_MS) throw new Error('Bitget 資金費率數值或結算時間無效');
    return { time, rate };
  }).sort((a, b) => b.time - a.time);
}

export async function futuresMetadata(symbol: string) {
  const [contracts, tiers, funding, ticker, depth] = await Promise.all([
    bitgetPublic<Array<Record<string, string>>>('market/contracts', { symbol, productType: 'USDT-FUTURES' }),
    bitgetPublic<Array<Record<string, string>>>('market/query-position-lever', { symbol, productType: 'USDT-FUTURES' }),
    bitgetPublic<Array<Record<string, string>>>('market/current-fund-rate', { symbol, productType: 'USDT-FUTURES' }),
    bitgetPublic<Array<Record<string, string>>>('market/ticker', { symbol, productType: 'USDT-FUTURES' }),
    bitgetPublic<{ bids: string[][]; asks: string[][] }>('market/merge-depth', { symbol, productType: 'USDT-FUTURES', precision: 'scale0', limit: '50' }),
  ]);
  const contract = contracts.find(row => row.symbol === symbol), current = ticker[0], fund = funding.find(row => row.symbol === symbol);
  if (!contract || contract.symbolStatus !== 'normal' || !current || !fund) throw new Error('永續商品未正常交易或必要資料不足');
  const marginTiers: MarginTier[] = tiers.map(row => ({ min: Number(row.startUnit), max: Number(row.endUnit), rate: Number(row.keepMarginRate), maxLeverage: Number(row.leverage) }));
  if (!marginTiers.length || marginTiers.some(t => !Object.values(t).every(Number.isFinite) || t.min < 0 || t.max <= t.min || t.rate <= 0 || t.rate >= 1)) throw new Error('合約維持保證金級距無效');
  const price = Number(current.lastPr), markPrice = Number(current.markPrice), quoteVolume = Number(current.usdtVolume), fundingRate = Number(fund.fundingRate);
  const fundingInterval = Number(fund.fundingRateInterval), nextFundingTime = Number(fund.nextUpdate);
  if (![price, markPrice, fundingRate, fundingInterval, nextFundingTime].every(Number.isFinite) || price <= 0 || markPrice <= 0 || fundingInterval <= 0) throw new Error('合約成交價、標記價或結算資料無效');
  const bids = depth.bids?.map(row => row.slice(0, 2).map(Number)), asks = depth.asks?.map(row => row.slice(0, 2).map(Number));
  if (!bids?.length || !asks?.length || [...bids, ...asks].some(row => row.length !== 2 || row.some(n => !Number.isFinite(n) || n <= 0))) throw new Error('合約委託簿深度不足或格式無效');
  const bid = bids[0][0], ask = asks[0][0], mid = (bid + ask) / 2;
  const bidDepthUsdt = bids.filter(row => row[0] >= mid * 0.998).reduce((sum, row) => sum + row[0] * row[1], 0);
  const askDepthUsdt = asks.filter(row => row[0] <= mid * 1.002).reduce((sum, row) => sum + row[0] * row[1], 0);
  if (!Number.isInteger(Number(contract.volumePlace)) || Number(contract.volumePlace) < 0 || Number(contract.volumePlace) > 8
    || !Number.isInteger(Number(contract.pricePlace)) || Number(contract.pricePlace) < 0 || Number(contract.pricePlace) > 12
    || !(Number(contract.minTradeNum) > 0) || !(Number(contract.sizeMultiplier) > 0)) throw new Error('合約數量與價格精度無效');
  return { tiers: marginTiers, observedAt: Date.now(), price, markPrice, quoteVolume, fundingRate, fundingInterval, nextFundingTime,
    spreadPct: (ask - bid) / mid * 100, bidDepthUsdt, askDepthUsdt,
    takerFeeRate: Number(contract.takerFeeRate) || null, precision: Number(contract.volumePlace), pricePrecision: Number(contract.pricePlace),
    minQuantity: Number(contract.minTradeNum), minNotional: Number(contract.minTradeUSDT) || 5, quantityStep: Number(contract.sizeMultiplier),
    minLeverage: Number(contract.minLever), maxLeverage: Number(contract.maxLever), fundingIntervalHours: fundingInterval };
}

/** 研究層只依賴兩家交易所共用的風險與成交規格欄位。 */
export type FuturesResearchMetadata = Pick<Awaited<ReturnType<typeof futuresMetadata>>,
  'tiers' | 'observedAt' | 'precision' | 'minQuantity' | 'minNotional' | 'quantityStep' | 'minLeverage' | 'maxLeverage' | 'fundingIntervalHours'>;

/**
 * 新倉最低 24H 成交額，單位 USDT。2026-10-14 使用者決定由 5,000 萬降為 1,000 萬，
 * 讓全市場掃描涵蓋約 55 個合約；價差與深度兩道檢查不變，仍限制小幣滑價。
 */
export const FUTURES_MIN_QUOTE_VOLUME_USDT = 10_000_000;

/** 目前流動性只用於新倉，不回填到過去訊號。 */
export function futuresLiquidityError(metadata: Awaited<ReturnType<typeof futuresMetadata>>, notional: number) {
  if (!Number.isFinite(metadata.quoteVolume) || metadata.quoteVolume < FUTURES_MIN_QUOTE_VOLUME_USDT) return '永續近 24H 成交額不足 1,000 萬 USDT';
  if (metadata.spreadPct < 0 || metadata.spreadPct > 0.15) return '合約買賣價差超過 0.15%';
  if (notional > Math.min(metadata.bidDepthUsdt, metadata.askDepthUsdt) * 0.01) return '名目部位超過附近雙邊深度的 1%';
  return null;
}
