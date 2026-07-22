/**
 * 【詳細繁體中文註解】：Bitget 股票代幣(rToken)標的清單抓取
 *
 * 用途:Bitget 透過 Reality Protocol 上架了數百檔美股代幣化交易對(格式為 r+美股代號+USDT,
 * 例如 Apple → RAAPLUSDT),數量遠多於本系統手動維護的常見標的清單。
 * 本模組只拿來「擴充回測標的選單」——列出使用者可以選哪些美股代號,
 * **不**拿 Bitget 代幣本身的價格/成交量做回測資料來源。
 *
 * 為什麼不直接用 Bitget 代幣的 K 線做回測:
 *   rToken 是在 Bitget 自家撮合系統內用 USDT 交易的合成代幣,套利機制通常能讓價格貼近真實股價,
 *   但「成交量」是代幣在 Bitget 上被交易的量,跟真實股票在美股市場的成交量是兩回事。
 *   本系統有 3 種策略(連續爆量/量增未破前高/日線量增2倍)核心訊號就是成交量異常,
 *   若改用代幣成交量,驗證的是不相關的數據,回測會失去意義。
 *   因此實際歷史資料仍統一走 stockDailyHistory.ts(Yahoo Finance,真實美股成交量)。
 *
 * 外部 API 副作用註記:Bitget 現貨交易對清單為公開端點,不需金鑰;
 * 失敗時回傳空陣列(不影響既有手動維護清單的可用性),不拋例外阻斷前端。
 */

const BITGET_SYMBOLS_URL = 'https://api.bitget.com/api/v2/spot/public/symbols';

/**
 * 抓取 Bitget 上架的美股代幣(rToken)清單,回傳去除 "r" 前綴的真實美股代號(如 "AAPL")。
 *
 * 判斷規則:baseCoin 需符合 /^r[A-Z]/ — Reality Protocol 的股票代幣統一以小寫 r 開頭、
 * 後面接大寫美股代號(如 rAAPL、rTSLA);一般加密貨幣代號本身全大寫(如 RSR、BTC),
 * 不會誤判為股票代幣。
 */
export const fetchBitgetStockTickers = async (): Promise<string[]> => {
  try {
    const response = await fetch(BITGET_SYMBOLS_URL);
    if (!response.ok) return [];

    const json = (await response.json()) as any;
    const symbols: any[] = json?.data ?? [];

    const tickers = symbols
      .filter((s) => s.quoteCoin === 'USDT' && s.status === 'online' && /^r[A-Z]/.test(s.baseCoin ?? ''))
      .map((s) => (s.baseCoin as string).slice(1).toUpperCase());

    // 去重並排序,方便前端下拉選單呈現
    return [...new Set(tickers)].sort();
  } catch (error) {
    console.error('❌ [Bitget Stock Symbols] 抓取失敗:', error);
    return [];
  }
};
