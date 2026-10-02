/**
 * 【詳細繁體中文註解】：Bitget 交易所服務 — 簽名與現貨下單
 *
 * 用途:
 *   1. 作為加密貨幣自動交易的第二個可選交易所(users.preferredExchange = 'BITGET')
 *   2. 美股代幣(rToken)自動下單 — Bitget 是本系統唯一支援此功能的交易所,
 *      股票代幣與一般加密貨幣使用「完全相同」的現貨下單 API,只是交易對代號不同
 *      (股票代幣格式為 r + 美股代號 + USDT,例如 Apple → RAAPLUSDT)
 *
 * 簽名機制(與 Binance 不同,不可沿用 binanceService.ts 的簽名邏輯):
 *   簽名原文 = timestamp + HTTP方法(大寫) + 請求路徑(含 query string) + body(JSON 字串)
 *   使用 HMAC-SHA256、密鑰為 API Secret,簽名結果為 Base64 編碼(Binance 是 hex)。
 *   另外需要 ACCESS-PASSPHRASE(建立 API 金鑰時自訂的密碼),Binance 沒有這道手續。
 *
 * 重要下單單位規則(容易出錯,務必注意):
 *   市價買單(BUY):size 參數是「報價幣金額」(要花多少 USDT),不是股數/幣數!
 *   市價賣單(SELL):size 參數是「基礎幣數量」(要賣幾股/幾顆幣)。
 *   因此本檔案刻意拆成 placeBitgetMarketBuy / placeBitgetMarketSell 兩個函式,
 *   避免呼叫端誤把數量塞進錯誤的欄位。
 *
 * Demo 模式必須使用 Bitget 後台另建的 Demo API Key，並在每次私有請求帶 paptrading:1。
 * 正式金鑰與 Demo 金鑰由呼叫端分開保存；本服務不會把 Demo 請求降級成正式下單。
 */

const BITGET_API_URL = 'https://api.bitget.com';

/** Bitget 現貨加密貨幣下單數量精度(與 Binance 不同,需獨立維護,經實測 API 取得) */
export const BITGET_CRYPTO_PRECISION: Record<string, number> = {
  BTCUSDT: 6,
  ETHUSDT: 4,
  SOLUSDT: 4,
  ADAUSDT: 3,
  DOGEUSDT: 4,
  XRPUSDT: 4,
  SUIUSDT: 2,
  AVAXUSDT: 4,
  ICPUSDT: 4,
  ZECUSDT: 3,
  ASTERUSDT: 2,
};

/** 股票代幣(rToken)下單數量精度預設值(股數模擬,與前端回測的美股精度慣例一致) */
export const BITGET_STOCK_TOKEN_PRECISION = 4;

/** 將美股代號轉為 Bitget 股票代幣交易對,例如 "COIN" -> "RCOINUSDT" */
export const toBitgetStockSymbol = (ticker: string): string => `R${ticker.toUpperCase()}USDT`;

/** 產生 Bitget API 簽名(HMAC-SHA256,Base64 編碼) */
export const generateBitgetSignature = async (
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  apiSecret: string
): Promise<string> => {
  const message = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
  const encoder = new TextEncoder();

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));

  // Base64 編碼(注意:Bitget 用 Base64,Binance 用 hex,不可混用)
  const bytes = new Uint8Array(signatureBuffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** 發送已簽名的 Bitget API 請求；Demo 私有請求固定帶 paptrading:1。 */
const bitgetSignedRequest = async (
  method: 'GET' | 'POST',
  requestPath: string,
  bodyObj: Record<string, unknown> | undefined,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  options: { demo?: boolean } = {}
): Promise<any> => {
  const timestamp = Date.now().toString();
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const signature = await generateBitgetSignature(timestamp, method, requestPath, body, apiSecret);

  const response = await fetch(`${BITGET_API_URL}${requestPath}`, {
    method,
    headers: {
      'ACCESS-KEY': apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
      locale: 'zh-TW',
      ...(options.demo ? { paptrading: '1' } : {}),
    },
    ...(method === 'POST' ? { body } : {}),
    signal: AbortSignal.timeout(8_000),
  });

  const data = (await response.json()) as any;
  // Bitget 成功回應的 code 固定為 "00000",其餘皆視為失敗(含 HTTP 200 但業務錯誤的情況)
  if (!response.ok || data.code !== '00000') {
    throw new BitgetApiError(
      String(data.code ?? response.status),
      requestPath,
      data.msg || response.statusText,
    );
  }
  return data.data;
};

/** 保留錯誤碼與端點供安全的帳戶版本判斷；不保存或輸出任何憑證與簽章。 */
class BitgetApiError extends Error {
  constructor(
    readonly code: string,
    readonly requestPath: string,
    message: string,
  ) {
    super(`[Bitget] API 錯誤 code=${code}: ${message}`);
    this.name = 'BitgetApiError';
  }
}

const bitgetSignedPost = (
  requestPath: string,
  bodyObj: Record<string, unknown>,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  options: { demo?: boolean } = {},
) => bitgetSignedRequest('POST', requestPath, bodyObj, apiKey, apiSecret, passphrase, options);

const bitgetSignedGet = (
  requestPath: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  options: { demo?: boolean } = {},
) => bitgetSignedRequest('GET', requestPath, undefined, apiKey, apiSecret, passphrase, options);

export interface BitgetOrderReceipt {
  orderId: string;
  clientOid: string;
}

export interface BitgetFuturesRules {
  symbol: string;
  quantityPrecision: number;
  pricePrecision: number;
  minTradeQuantity: number;
  sizeMultiplier: number;
  minTradeUsdt: number;
  minLeverage: number;
  maxLeverage: number;
}

export type BitgetFuturesEnvironment = 'DEMO' | 'LIVE';

/** Bitget UTA 將 USDT 永續統一以 category 表示，避免沿用 Classic 的 productType 參數。 */
const BITGET_USDT_FUTURES_CATEGORY = 'USDT-FUTURES';

export interface BitgetFuturesAccount {
  positionMode: 'one_way_mode' | 'hedge_mode';
  marginMode: string;
  /** Demo 可能仍是 Classic 帳戶；後續設定槓桿與下單必須沿用同一套 API。 */
  apiDialect: 'UTA_V3' | 'CLASSIC_V2';
}

export type BitgetDemoFuturesAccount = BitgetFuturesAccount;

/** 合約私有請求必須明確傳入環境；DEMO 才能附加 paptrading，避免測試憑證誤送正式端點。 */
const futuresRequestOptions = (environment: BitgetFuturesEnvironment) => ({ demo: environment === 'DEMO' });

/**
 * 讀取 USDT 永續合約規格。數量必須同時符合小數精度、最低張數與 sizeMultiplier，
 * 不能沿用現貨規格，否則新幣或低價幣可能被交易所拒單。
 */
export async function fetchBitgetFuturesRules(symbol: string): Promise<BitgetFuturesRules> {
  const response = await fetch(
    `${BITGET_API_URL}/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}`,
    { signal: AbortSignal.timeout(5_000) },
  );
  const payload = await response.json() as {
    code?: string;
    msg?: string;
    data?: Array<Record<string, string>>;
  };
  const item = payload.data?.find(entry => entry.symbol === symbol);
  if (!response.ok || payload.code !== '00000' || !item) {
    throw new Error(`[Bitget] 找不到可交易 USDT 永續規格 code=${payload.code ?? response.status}`);
  }
  const quantityPrecision = Number(item.volumePlace);
  const pricePrecision = Number(item.pricePlace);
  const minTradeQuantity = Number(item.minTradeNum);
  const sizeMultiplier = Number(item.sizeMultiplier);
  const minLeverage = Number(item.minLever);
  const maxLeverage = Number(item.maxLever);
  const reportedMinTradeUsdt = Number(item.minTradeUSDT);
  const minTradeUsdt = Number.isFinite(reportedMinTradeUsdt) && reportedMinTradeUsdt > 0
    ? reportedMinTradeUsdt
    : 5;
  if (![quantityPrecision, pricePrecision, minTradeQuantity, sizeMultiplier, minLeverage, maxLeverage].every(Number.isFinite) ||
      quantityPrecision < 0 || pricePrecision < 0 || minTradeQuantity <= 0 || sizeMultiplier <= 0 ||
      minLeverage < 1 || maxLeverage < minLeverage || item.symbolStatus !== 'normal') {
    throw new Error(`[Bitget] ${symbol} 永續合約規格無效`);
  }
  return {
    symbol, quantityPrecision, pricePrecision, minTradeQuantity, sizeMultiplier, minTradeUsdt,
    minLeverage, maxLeverage,
  };
}

/** 五分鐘備援停損使用 Bitget 永續 Mark Price，與合約執行商品保持一致。 */
export async function fetchBitgetFuturesMarkPrice(symbol: string): Promise<number> {
  const response = await fetch(
    /** Bitget V3 行情端點不支援此合約查詢格式，統一改用 V2 mix ticker。 */
    `${BITGET_API_URL}/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}`,
    { signal: AbortSignal.timeout(5_000) },
  );
  const payload = await response.json() as { code?: string; data?: Array<{ markPrice?: string; lastPr?: string }> };
  /** Mark Price 優先，少數商品未提供時才回退最新成交價，避免測試流程取得空值。 */
  const price = Number(payload.data?.[0]?.markPrice || payload.data?.[0]?.lastPr);
  if (!response.ok || payload.code !== '00000' || !Number.isFinite(price) || price <= 0) {
    throw new Error(`[Bitget] ${symbol} 永續 Mark Price 不可用`);
  }
  return price;
}

/** 查詢持倉模式，供開倉參數與槓桿設定使用；不自行切換單向／雙向模式。 */
export async function fetchBitgetFuturesAccount(
  environment: BitgetFuturesEnvironment,
  symbol: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
): Promise<BitgetFuturesAccount> {
  /**
   * Bitget 同時存在 UTA V3 與 Classic V2 Demo 帳戶。先探測 V3；只有收到明確的
   * 40099 環境不符才回退 V2，其他驗證錯誤直接中止，避免掩蓋簽章或權限問題。
   * 兩次請求都固定帶 paptrading:1，絕不因回退而送往正式交易環境。
   */
  if (environment === 'DEMO') {
    try {
      const data = await bitgetSignedGet(
        '/api/v3/account/settings', apiKey, apiSecret, passphrase, futuresRequestOptions(environment),
      ) as {
        holdMode?: string;
        symbolConfigList?: Array<{ category?: string; symbol?: string; marginMode?: string }>;
      };
      if (data?.holdMode !== 'one_way_mode' && data?.holdMode !== 'hedge_mode') {
        throw new Error('[Bitget] DEMO UTA 帳戶未回傳有效持倉模式');
      }
      const symbolConfig = data.symbolConfigList?.find(config =>
        config.category === BITGET_USDT_FUTURES_CATEGORY && config.symbol === symbol,
      );
      return {
        positionMode: data.holdMode,
        marginMode: symbolConfig?.marginMode || '',
        apiDialect: 'UTA_V3',
      };
    } catch (error) {
      if (!(error instanceof BitgetApiError) || error.code !== '40099') throw error;
    }
  }
  const path = `/api/v2/mix/account/account?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&marginCoin=USDT`;
  let data: { posMode?: string; marginMode?: string };
  try {
    data = await bitgetSignedGet(path, apiKey, apiSecret, passphrase, futuresRequestOptions(environment));
  } catch (error) {
    /** 兩套 Demo API 都拒絕 40099 時，直接指出使用者填入的是正式環境金鑰。 */
    if (environment === 'DEMO' && error instanceof BitgetApiError && error.code === '40099') {
      throw new Error(
        '[Bitget] Demo 金鑰環境不正確：請先切換 Bitget「Demo Trading」模式，再於該模式的 API Key Management 建立 Demo 專用金鑰。一般 API 頁建立的正式金鑰不能用於 Demo。',
      );
    }
    throw error;
  }
  if (data?.posMode !== 'one_way_mode' && data?.posMode !== 'hedge_mode') {
    throw new Error(`[Bitget] ${environment} 合約帳戶未回傳有效持倉模式`);
  }
  return { positionMode: data.posMode, marginMode: data.marginMode || '', apiDialect: 'CLASSIC_V2' };
}

/**
 * 每次進場固定逐倉，槓桿由上層傳入已驗證的實際值。若帳戶目前不是逐倉，
 * 只有在沒有未平倉部位／委託時 Bitget 才允許切換；切換失敗就拒絕本次進場，不以全倉模式降級送單。
 */
export async function configureBitgetFuturesLong(
  environment: BitgetFuturesEnvironment,
  symbol: string,
  account: BitgetFuturesAccount,
  leverage: number,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
): Promise<void> {
  if (account.apiDialect === 'UTA_V3') {
    /**
     * UTA 以同一個請求設定逐倉與槓桿；雙向模式只寫 longLeverage，
     * 不能連帶改動使用者可能自行保留的空單槓桿。
     */
    const leverageBody = account.positionMode === 'hedge_mode'
      ? {
          category: BITGET_USDT_FUTURES_CATEGORY, symbol, marginMode: 'isolated', posSide: 'long',
          longLeverage: leverage.toString(),
        }
      : {
          category: BITGET_USDT_FUTURES_CATEGORY, symbol, marginMode: 'isolated', posSide: 'long',
          leverage: leverage.toString(),
        };
    await bitgetSignedPost(
      '/api/v3/account/set-leverage', leverageBody,
      apiKey, apiSecret, passphrase, futuresRequestOptions(environment),
    );
    return;
  }
  if (account.marginMode !== 'isolated') {
    await bitgetSignedPost(
      '/api/v2/mix/account/set-margin-mode',
      { symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT', marginMode: 'isolated' },
      apiKey, apiSecret, passphrase, futuresRequestOptions(environment),
    );
  }
  const leverageBody = account.positionMode === 'hedge_mode'
    ? { symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT', longLeverage: leverage.toString(), holdSide: 'long' }
    : { symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT', leverage: leverage.toString() };
  await bitgetSignedPost(
    '/api/v2/mix/account/set-leverage', leverageBody,
    apiKey, apiSecret, passphrase, futuresRequestOptions(environment),
  );
}

/** USDT 永續只開多：side=buy、tradeSide=open，並由交易所保存原生停損。 */
export async function placeBitgetFuturesLong(params: {
  environment: BitgetFuturesEnvironment;
  symbol: string;
  quantity: number;
  quantityPrecision: number;
  stopLossPrice: number;
  pricePrecision: number;
  positionMode: BitgetFuturesAccount['positionMode'];
  apiDialect: BitgetFuturesAccount['apiDialect'];
  clientOid: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}): Promise<BitgetOrderReceipt> {
  if (params.apiDialect === 'UTA_V3') {
    /**
     * UTA 市價開多的 qty 以基礎幣數量計，與永續合約規格的 sizeMultiplier 一致。
     * 停損以 Mark Price 觸發市價平倉，避免單一交易所最新成交價失真時漏觸發。
     */
    const data = await bitgetSignedPost(
      '/api/v3/trade/place-order',
      {
        category: BITGET_USDT_FUTURES_CATEGORY,
        symbol: params.symbol,
        qty: params.quantity.toFixed(params.quantityPrecision),
        side: 'buy',
        ...(params.positionMode === 'hedge_mode' ? { posSide: 'long' } : {}),
        orderType: 'market',
        clientOid: params.clientOid,
        reduceOnly: 'no',
        stopLoss: params.stopLossPrice.toFixed(params.pricePrecision),
        slTriggerBy: 'mark',
        slOrderType: 'market',
      },
      params.apiKey, params.apiSecret, params.passphrase, futuresRequestOptions(params.environment),
    ) as { orderId?: string; clientOid?: string };
    if (!data?.orderId) throw new Error('[Bitget] DEMO UTA 合約開多成功回應缺少 orderId');
    return { orderId: data.orderId, clientOid: data.clientOid || params.clientOid };
  }
  const data = await bitgetSignedPost(
    '/api/v2/mix/order/place-order',
    {
      symbol: params.symbol,
      productType: 'USDT-FUTURES',
      marginMode: 'isolated',
      marginCoin: 'USDT',
      size: params.quantity.toFixed(params.quantityPrecision),
      side: 'buy',
      tradeSide: 'open',
      orderType: 'market',
      clientOid: params.clientOid,
      presetStopLossPrice: params.stopLossPrice.toFixed(params.pricePrecision),
    },
    params.apiKey, params.apiSecret, params.passphrase, futuresRequestOptions(params.environment),
  ) as { orderId?: string; clientOid?: string };
  if (!data?.orderId) throw new Error(`[Bitget] ${params.environment} 合約開多成功回應缺少 orderId`);
  return { orderId: data.orderId, clientOid: data.clientOid || params.clientOid };
}

/**
 * 平倉使用 Flash Close 並鎖定 holdSide=long。這個端點會關閉既有多單，
 * 不會像一般 sell 市價單在持倉不足時反向建立空單。
 */
export async function closeBitgetFuturesLong(
  environment: BitgetFuturesEnvironment,
  symbol: string,
  quantity: string,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
): Promise<BitgetOrderReceipt> {
  if (environment === 'DEMO') {
    const account = await fetchBitgetFuturesAccount(environment, symbol, apiKey, apiSecret, passphrase);
    /**
     * UTA 雙向模式以 sell + long 明確平多；單向模式再加 reduceOnly=yes，
     * 兩種分支都禁止持倉不足時反手建立空單。
     */
    if (account.apiDialect === 'UTA_V3') {
      const data = await bitgetSignedPost(
        '/api/v3/trade/place-order',
        {
          category: BITGET_USDT_FUTURES_CATEGORY,
          symbol,
          qty: quantity,
          side: 'sell',
          ...(account.positionMode === 'hedge_mode' ? { posSide: 'long' } : { reduceOnly: 'yes' }),
          orderType: 'market',
          clientOid: `close-${Date.now()}`,
        },
        apiKey, apiSecret, passphrase, futuresRequestOptions(environment),
      ) as { orderId?: string; clientOid?: string };
      if (!data?.orderId) throw new Error('[Bitget] DEMO UTA 平多成功回應缺少 orderId');
      return { orderId: data.orderId, clientOid: data.clientOid || '' };
    }
  }
  const data = await bitgetSignedPost(
    '/api/v2/mix/order/close-positions',
    { symbol, holdSide: 'long', productType: 'USDT-FUTURES' },
    apiKey, apiSecret, passphrase, futuresRequestOptions(environment),
  ) as {
    successList?: Array<{ orderId?: string; clientOid?: string }>;
    failureList?: Array<{ errorCode?: string; errorMsg?: string }>;
  };
  const result = data?.successList?.[0];
  if (!result?.orderId) {
    const failure = data?.failureList?.[0];
    throw new Error(`[Bitget] ${environment} 平多失敗${failure ? ` ${failure.errorCode ?? ''} ${failure.errorMsg ?? ''}` : ''}`.trim());
  }
  return { orderId: result.orderId, clientOid: result.clientOid || '' };
}

/** 以下 Demo 包裝器保留既有 API；所有呼叫都明確鎖定 DEMO，不能自動降級成正式盤。 */
export const fetchBitgetDemoFuturesAccount = (
  symbol: string, apiKey: string, apiSecret: string, passphrase: string,
) => fetchBitgetFuturesAccount('DEMO', symbol, apiKey, apiSecret, passphrase);

export const configureBitgetDemoFuturesLong = (
  symbol: string, account: BitgetFuturesAccount, leverage: number,
  apiKey: string, apiSecret: string, passphrase: string,
) => configureBitgetFuturesLong('DEMO', symbol, account, leverage, apiKey, apiSecret, passphrase);

export const placeBitgetDemoFuturesLong = (
  params: Omit<Parameters<typeof placeBitgetFuturesLong>[0], 'environment'>,
) => placeBitgetFuturesLong({ ...params, environment: 'DEMO' });

export const closeBitgetDemoFuturesLong = (
  symbol: string, quantity: string, apiKey: string, apiSecret: string, passphrase: string,
) => closeBitgetFuturesLong('DEMO', symbol, quantity, apiKey, apiSecret, passphrase);

/**
 * 市價買單。size 為「報價幣金額」(要花多少 USDT),由呼叫端傳入計算好的名目金額。
 * @param symbol 交易對,如 BTCUSDT(加密貨幣)或 RAAPLUSDT(股票代幣)
 * @param notionalQuote 買入名目金額(USDT)
 */
export const placeBitgetMarketBuy = async (
  symbol: string,
  notionalQuote: number,
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<boolean> => {
  try {
    await bitgetSignedPost(
      '/api/v2/spot/trade/place-order',
      { symbol, side: 'buy', orderType: 'market', size: notionalQuote.toString() },
      apiKey,
      apiSecret,
      passphrase
    );
    return true;
  } catch (error) {
    console.error('🔥 [Bitget] 市價買單失敗:', error);
    return false;
  }
};

/**
 * 市價賣單。size 為「基礎幣數量」(要賣幾股/幾顆幣),與買單單位不同,務必注意。
 * @param symbol 交易對,如 BTCUSDT(加密貨幣)或 RAAPLUSDT(股票代幣)
 * @param baseQuantity 賣出數量(基礎幣/股數)
 */
export const placeBitgetMarketSell = async (
  symbol: string,
  baseQuantity: number,
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<boolean> => {
  try {
    await bitgetSignedPost(
      '/api/v2/spot/trade/place-order',
      { symbol, side: 'sell', orderType: 'market', size: baseQuantity.toString() },
      apiKey,
      apiSecret,
      passphrase
    );
    return true;
  } catch (error) {
    console.error('🔥 [Bitget] 市價賣單失敗:', error);
    return false;
  }
};
