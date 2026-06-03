/**
 * 負責處理 Binance 幣安 API 的服務
 */

// 【詳細繁體中文註解】：幣安現貨 API 基礎路徑 (供交易下單使用)
const BINANCE_API_URL = "https://api.binance.com";
// 【詳細繁體中文註解】：幣安公開行情資料 API 基礎路徑 (解決 Cloudflare Worker 機房 IP 遭到 api.binance.com 拒絕連線的問題)
const BINANCE_DATA_URL = "https://data.binance.com";

/**
 * 取得 K 線歷史資料
 * @param symbol 交易對，例如 "BTCUSDT"
 * @param interval K線週期，例如 "4h", "15m"
 * @param limit 取得幾筆資料 (預設 500)
 */
export const getKlines = async (symbol: string, interval: string, limit: number = 500) => {
  // 【詳細繁體中文註解】：嘗試從幣安官方主要 API 取得資料
  try {
    const binanceUrl = `${BINANCE_API_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const response = await fetch(binanceUrl);
    if (response.ok) {
      const data = await response.json() as any[];
      return data.map(k => ({
        openTime: k[0] as number,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6] as number,
      }));
    } else {
      console.warn(`⚠️ [Binance API] 行情請求失敗，Status: ${response.statusText}。準備 fallback。`);
    }
  } catch (e) {
    console.warn(`⚠️ [Binance API] 取得 ${symbol} K線遭遇例外封鎖，嘗試切換至 OKX 備用來源。`, e);
  }

  // 【詳細繁體中文註解】：若幣安無法連線，則切換至 OKX API 取得技術指標行情（不影響幣安下單）
  try {
    const okxSymbol = symbol.replace('USDT', '-USDT');
    const okxInterval = interval.replace('h', 'H'); // OKX 的小時單位必須為大寫 H
    const okxUrl = `https://www.okx.com/api/v5/market/candles?instId=${okxSymbol}&bar=${okxInterval}&limit=${limit}`;
    
    const response = await fetch(okxUrl);
    if (!response.ok) {
      throw new Error(`OKX 備用節點回傳錯誤: ${response.statusText}`);
    }
    
    const result = await response.json() as any;
    if (result.code !== '0' || !result.data) {
      throw new Error(`OKX API 拒絕服務: ${result.msg}`);
    }
    
    // 【詳細繁體中文註解】：OKX 的 K 線排序是「最新到最舊」，我們必須將其反轉以匹配既有策略邏輯
    const reversedData = [...result.data].reverse();
    
    return reversedData.map((k: any) => ({
      openTime: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: parseInt(k[0]), // 使用 openTime 暫代
    }));
    
  } catch (okxError) {
    throw new Error(`[備份失效] 無法從任何來源取得 ${symbol} 的行情資料: ${(okxError as any).message}`);
  }
};

/**
 * 產生 HMAC SHA256 簽名
 */
const generateSignature = async (queryString: string, apiSecret: string): Promise<string> => {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiSecret);
  const messageData = encoder.encode(queryString);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const signatureArray = Array.from(new Uint8Array(signature));
  const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return signatureHex;
};

/**
 * 呼叫幣安測試下單 API (不會實際扣款)
 * @param symbol 交易對，例如 "BTCUSDT"
 * @param side 買或賣: "BUY" 或 "SELL"
 * @param quantity 購買數量 (BTC)
 * @param apiKey 幣安 API Key
 * @param apiSecret 幣安 Secret Key
 */
export const placeTestOrder = async (
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  apiKey: string,
  apiSecret: string
): Promise<boolean> => {
  const endpoint = "/api/v3/order/test";
  const timestamp = Date.now();
  
  // 建立 Query 參數字串
  const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
  
  // 產生簽名
  const signature = await generateSignature(queryString, apiSecret);
  
  const url = `${BINANCE_API_URL}${endpoint}?${queryString}&signature=${signature}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Binance Test Order Failed:", data);
      return false;
    }

    // 測試下單成功回傳 {}
    return true;
  } catch (error) {
    console.error("Binance Test Order Exception:", error);
    return false;
  }
};

/**
 * 呼叫幣安正式下單 API (實戰！將會真實扣款與買賣)
 * @param symbol 交易對，例如 "BTCUSDT"
 * @param side 買或賣: "BUY" 或 "SELL"
 * @param quantity 購買數量 (BTC)
 * @param apiKey 幣安 API Key
 * @param apiSecret 幣安 Secret Key
 */
export const placeRealOrder = async (
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  apiKey: string,
  apiSecret: string
): Promise<boolean> => {
  const endpoint = "/api/v3/order";
  const timestamp = Date.now();
  
  // 建立 Query 參數字串
  const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
  
  // 產生簽名
  const signature = await generateSignature(queryString, apiSecret);
  
  const url = `${BINANCE_API_URL}${endpoint}?${queryString}&signature=${signature}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("🔥 Binance REAL Order Failed:", data);
      return false;
    }

    // 正式下單成功會回傳詳細的 order 物件
    console.log("✅ Binance REAL Order Success:", data);
    return true;
  } catch (error) {
    console.error("🔥 Binance REAL Order Exception:", error);
    return false;
  }
};
