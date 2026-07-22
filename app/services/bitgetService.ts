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
 * PAPER 模式設計差異:
 *   Bitget 官方沒有提供類似 Binance /order/test 的測試下單端點,
 *   因此 PAPER 模式不會呼叫 Bitget API 驗證,由呼叫端直接視為「模擬成功」
 *   (與既有 Binance PAPER 模式會實際呼叫測試端點的行為不同,呼叫端需自行處理此差異)。
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
const generateSignature = async (
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

/** 發送已簽名的 Bitget 現貨 API 請求(POST,JSON body) */
const bitgetSignedPost = async (
  requestPath: string,
  bodyObj: Record<string, unknown>,
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<any> => {
  const timestamp = Date.now().toString();
  const body = JSON.stringify(bodyObj);
  const signature = await generateSignature(timestamp, 'POST', requestPath, body, apiSecret);

  const response = await fetch(`${BITGET_API_URL}${requestPath}`, {
    method: 'POST',
    headers: {
      'ACCESS-KEY': apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
      locale: 'zh-TW',
    },
    body,
  });

  const data = (await response.json()) as any;
  // Bitget 成功回應的 code 固定為 "00000",其餘皆視為失敗(含 HTTP 200 但業務錯誤的情況)
  if (!response.ok || data.code !== '00000') {
    throw new Error(`[Bitget] API 錯誤 code=${data.code}: ${data.msg || response.statusText}`);
  }
  return data.data;
};

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
