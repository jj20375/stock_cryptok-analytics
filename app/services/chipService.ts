/**
 * 【詳細繁體中文註解】
 * 台灣股市籌碼面與信用交易資料結構
 */
export interface StockChipInfo {
  date: string;
  symbol: string;
  name: string;
  // 三大法人買賣超 (單位: 股)
  foreignBuySell: number; // 外資及陸資 (不含外資自營商)
  trustBuySell: number;   // 投信
  dealerBuySell: number;  // 自營商
  totalInstitutionBuySell: number; // 三大法人合計買賣超股數
  
  // 信用交易 (單位: 張)
  marginBalance: number;  // 融資今日餘額 (張)
  shortBalance: number;   // 融券今日餘額 (張)
  shortMarginRatio: number; // 券資比 (%) (融券餘額 / 融資餘額 * 100)
}

// 【詳細繁體中文註解】
// 內存快取結構與暫存時間 (快取 2 小時，避免在 Cloudflare Workers 環境重複呼叫被證交所封鎖)
interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

const CACHE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 小時
const chipCache: Record<string, CacheEntry<StockChipInfo>> = {};
let twseRawCache: {
  date: string;
  inst: any;
  margin: any;
} | null = null;
let twseCacheTime = 0;

/**
 * 日期格式化為 YYYYMMDD
 */
function formatYYYYMMDD(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * 簡易超時控制的 Fetch
 */
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 8000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

/**
 * 【詳細繁體中文註解】
 * 自證交所獲取上市三大法人日報，自動往前搜尋有資料的交易日 (避開假日)
 */
async function fetchInstDataWithFallback(): Promise<{ dateStr: string; data: any } | null> {
  let date = new Date();
  // 最多往前嘗試 7 天
  for (let i = 0; i < 7; i++) {
    const dateStr = formatYYYYMMDD(date);
    const url = `https://www.twse.com.tw/fund/T86?response=json&date=${dateStr}&selectType=ALL`;
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://www.twse.com.tw/zh/trading/foreign/t86.html"
        }
      });
      if (res.ok) {
        const json = await res.json();
        // 證交所 API 成功返回代碼為 "OK" 且有 data 欄位
        if (json && json.stat === "OK" && json.data && json.data.length > 0) {
          return { dateStr, data: json };
        }
      }
    } catch (err) {
      console.warn(`[ChipService] 嘗試獲取三大法人失敗 (${dateStr}):`, err);
    }
    // 往前推一天
    date.setDate(date.getDate() - 1);
  }
  return null;
}

/**
 * 【詳細繁體中文註解】
 * 自證交所獲取上市信用交易日報 (融資融券)
 * @param targetDateStr 指定的日期 (YYYYMMDD)
 */
async function fetchMarginData(targetDateStr: string): Promise<any | null> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${targetDateStr}&selectType=ALL`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.twse.com.tw/zh/trading/margin/mi-margn.html"
      }
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.tables && json.tables.length > 0) {
        return json;
      }
    }
  } catch (err) {
    console.warn(`[ChipService] 獲取融資融券失敗 (${targetDateStr}):`, err);
  }
  return null;
}

/**
 * 【詳細繁體中文註解】
 * 輔助函數：將包含逗號的字串安全轉換成數字
 */
function parseStringToNum(str: string): number {
  if (!str) return 0;
  const clean = str.replace(/,/g, "").trim();
  const num = parseInt(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * 【詳細繁體中文註解】
 * 獲取指定台股代號之最新籌碼與信用交易資料
 * @param symbol 台股代碼 (例如 "2330" 或 "2330.TW")
 */
export const getTWStockChips = async (symbol: string): Promise<StockChipInfo | null> => {
  const code = symbol.replace(".TW", "").replace(".TWO", "").trim();
  
  // 1. 檢查快取
  const cached = chipCache[code];
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_DURATION_MS)) {
    return cached.data;
  }

  try {
    // 2. 獲取全市場法人日報 (如果全域快取失效，重新抓取)
    if (!twseRawCache || (now - twseCacheTime > CACHE_DURATION_MS)) {
      console.log(`[ChipService] 快取過期，開始重新獲取證交所籌碼資料...`);
      const instResult = await fetchInstDataWithFallback();
      if (!instResult) {
        console.warn(`[ChipService] 無法取得最新三大法人交易日報`);
        return null;
      }
      
      const dateStr = instResult.dateStr;
      const marginData = await fetchMarginData(dateStr);
      
      twseRawCache = {
        date: dateStr,
        inst: instResult.data,
        margin: marginData
      };
      twseCacheTime = now;
    }

    const { date, inst, margin } = twseRawCache;

    // 3. 解析三大法人資料
    // 【欄位索引定位邏輯】：動態查找欄位避免證交所微調格式
    const instFields = inst.fields || [];
    const symbolIdx = instFields.indexOf("證券代號");
    const nameIdx = instFields.indexOf("證券名稱");
    
    // 尋找「外資買賣超股數」、「投信買賣超股數」、「自營商買賣超股數」與「三大法人買賣超股數」
    const foreignIdx = instFields.findIndex((f: string) => f.includes("外陸資買賣超股數") || f.includes("外資買賣超股數"));
    const trustIdx = instFields.findIndex((f: string) => f.includes("投信買賣超股數"));
    const dealerIdx = instFields.findIndex((f: string) => f.includes("自營商買賣超股數"));
    const totalIdx = instFields.findIndex((f: string) => f.includes("三大法人買賣超股數"));

    const instRows = inst.data || [];
    const stockInstRow = instRows.find((r: string[]) => r[symbolIdx || 0]?.trim() === code);

    let foreignBuySell = 0;
    let trustBuySell = 0;
    let dealerBuySell = 0;
    let totalInstitutionBuySell = 0;
    let stockName = code;

    if (stockInstRow) {
      stockName = stockInstRow[nameIdx].trim();
      if (foreignIdx !== -1) foreignBuySell = parseStringToNum(stockInstRow[foreignIdx]);
      if (trustIdx !== -1) trustBuySell = parseStringToNum(stockInstRow[trustIdx]);
      if (dealerIdx !== -1) dealerBuySell = parseStringToNum(stockInstRow[dealerIdx]);
      if (totalIdx !== -1) totalInstitutionBuySell = parseStringToNum(stockInstRow[totalIdx]);
    }

    // 4. 解析融資融券信用交易資料
    let marginBalance = 0;
    let shortBalance = 0;
    let shortMarginRatio = 0;

    if (margin && margin.tables) {
      // 融資融券統計通常在名為「融資融券彙總 (全部)」或「融資融券彙總」的表格中
      const marginTable = margin.tables.find((t: any) => t.title && t.title.includes("融資融券彙總"));
      if (marginTable) {
        const marginFields = marginTable.fields || [];
        const marginDataRows = marginTable.data || [];
        
        // 由於融資和融券的部分欄位標題相同（例如：買進、賣出、今日餘額），
        // 證交所 API 中「融資今日餘額」通常在較前位置，而「融券今日餘額」在較後位置。
        // 我們依據固定欄位結構與欄位名稱定位：
        // 結構：[代號, 名稱, 資買, 資賣, 資償, 資前餘, 資今餘, 資限, 券買, 券賣, 券償, 券前餘, 券今餘, 券限, 資券抵, 註記]
        const marginRow = marginDataRows.find((r: string[]) => r[0]?.trim() === code);
        
        if (marginRow) {
          // 一般而言，融資今日餘額在第 6 索引 (第 7 欄)，融券今日餘額在第 12 索引 (第 13 欄)
          // 為了安全起見，我們精確依據固定代碼結構提取：
          marginBalance = parseStringToNum(marginRow[6]); // 融資今日餘額
          shortBalance = parseStringToNum(marginRow[12]); // 融券今日餘額
          
          if (marginBalance > 0) {
            shortMarginRatio = parseFloat(((shortBalance / marginBalance) * 100).toFixed(2));
          }
        }
      }
    }

    const data: StockChipInfo = {
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      symbol: code,
      name: stockName,
      foreignBuySell,
      trustBuySell,
      dealerBuySell,
      totalInstitutionBuySell,
      marginBalance,
      shortBalance,
      shortMarginRatio
    };

    // 5. 寫入快取
    chipCache[code] = {
      timestamp: now,
      data
    };

    return data;
  } catch (error) {
    console.error(`[ChipService] 處理 ${code} 籌碼資料失敗:`, error);
    return null;
  }
};
