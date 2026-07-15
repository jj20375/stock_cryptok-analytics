import type { MarketKey, ScanResult, ScanStrategy, StockDataPoint, StockOption, Timeframe } from './types';

interface StrategyPromptParams {
  selectedStock: StockOption;
  market: MarketKey;
  latestData: StockDataPoint;
}

export const buildStrategyPrompt = ({
  selectedStock,
  market,
  latestData,
}: StrategyPromptParams) => `# Role: 專業短線交易策略分析師
   
## 任務目標
請根據我提供的 [${selectedStock.symbol} (${selectedStock.name})]，進行短線交易機會分析。請嚴格遵守以下兩套不同的策略邏輯進行評估，並給出「進場」、「觀望」或「風險過高」的具體建議。

---

## 策略 A：股票短線波段 (持有期約 1 週)
**適用對象：** 美股 / 台股 / 其他股票市場
**核心邏輯：** 尋找底部反轉或強勢突破的短線買點。

**分析檢查清單：**
1. **底部反轉特徵：**
   - RSI 是否處於低檔區 (例如 < 45) 並開始回升？
   - KD 或 MACD 是否出現黃金交叉或即將轉正？
2. **強勢突破特徵：**
   - 股價是否剛剛站上 MA20 (月線) 或出現 EMA 黃金交叉？
   - 突破時是否有量能配合？
3. **風險回報：**
   - 預期持有一週，目標漲幅應設定在 5%~10% 之間。
   - 止損位是否明確？(例如跌破前低或 MA20)。

---

## 策略 B：虛擬幣極短線動能 (持有期約 1~3 天)
**適用對象：** 比特幣 / 以太幣 / 主流山寨幣
**核心邏輯：** 捕捉超賣反彈或動能轉強的短線機會。

**進場訊號判定標準：**
1. **超賣反彈：**
   - RSI 是否低於 35？若低於 35，是否出現止跌跡象？
2. **動能轉強：**
   - MACD 柱狀圖是否由負轉正？
   - 價格是否重新站回 MA20 或 EMA 短天期均線之上？
3. **持有與出場：**
   - 預期持有 1~3 天左右。
   - 若 RSI 回升至 60 以上或價格觸碰上軌壓力，應分批止盈。

---

## 當前市場數據
標的: ${selectedStock.symbol} (${selectedStock.name})
市場類型: ${market === 'CRYPTO' ? '虛擬幣' : '股票'}
當前價格: ${latestData.close}
RSI(14): ${latestData.rsi?.toFixed(2)}
MACD: ${latestData.macdHist?.toFixed(2)}
KD: K=${latestData.k?.toFixed(2)}, D=${latestData.d?.toFixed(2)}
MA20: ${latestData.ma20?.toFixed(2)}
EMA12: ${latestData.emaShort?.toFixed(2)}
EMA26: ${latestData.emaLong?.toFixed(2)}

## 輸出格式要求
請針對 [${selectedStock.symbol} (${selectedStock.name})] 輸出以下報告，並以 JSON 格式回傳。
請在各項分析文字中（如結論、操作劇本等），自然地帶入標的名稱與代號：
{
  "marketData": "當前市場數據：(包含標的名稱與代號、現價、RSI 數值、MACD、KD 等狀態)",
  "matchAnalysis": "策略匹配度分析：(評估是否符合底部反轉、均線突破或超賣反彈特徵)",
  "conclusion": "結論：[強烈建議進場 / 觀察 / 不建議] (請提及標的名稱與代號)",
  "actionPlan": "操作劇本：建議進場價位區間、止損價位、目標價位。(請提及標的名稱與代號)",
  "riskWarning": "風險警告：(例如：目前是逆勢接刀，風險較大)"
}`;

const scannerStrategyDescription = (scanStrategy: ScanStrategy, scanTimeframe: Timeframe) => {
  if (scanStrategy === 'consecutive_volume') {
    return `「連續兩天/期以上爆量策略」（掃描成交量連續放大，代表有大量資金持續關注並建倉的強勢標的）於 ${scanTimeframe} 週期。`;
  }
  if (scanStrategy === 'volume_no_break') {
    return `「爆量但未突破前高策略」（掃描爆出大量但受制於前高阻力的標的，可能暗示上檔出貨壓大，或主力在此進行最後洗盤與箱型盤整）於 ${scanTimeframe} 週期。`;
  }
  if (scanStrategy === 'daily_volume_spike') {
    return `「日線爆量策略」（固定使用日線資料，掃描最新日成交量達前一交易日 2 倍以上的標的，用來捕捉異常資金流入或消息驅動行情）。`;
  }
  return `「多空指標強勢追蹤策略」（結合 RSI、MACD、EMA 篩選趨勢向上且具備良好短線回調買點的標的）於 ${scanTimeframe} 週期。`;
};

export const buildScannerPrompt = (
  topCandidates: ScanResult[],
  scanStrategy: ScanStrategy,
  scanTimeframe: Timeframe
) => `你是一位資深的量化交易與 AI 策略分析師。請深入分析以下這幾檔股票的技術指標與成交量特徵，配合當前我們所使用的策略：${scannerStrategyDescription(scanStrategy, scanTimeframe)}，並為前 10 名提供極具參考價值的「AI 智能洞察建議」(Traditional Chinese)。
          
          候選名單：
          ${JSON.stringify(topCandidates)}
          
          請執行以下任務：
          1. 根據技術指標與本策略特性的匹配度，對這 15 檔股票進行二次排序，挑選出最符合該策略特徵的 10 檔。
          2. 為每檔股票提供 20 字以內的具體建議。建議應包含：
             - 具體的支撐位或阻力位。
             - 當前的型態特徵與此策略的關聯性。
             - 具體的進場或防守（止損）警示。
          3. 確保每檔股票的建議都是獨一無二的，符合 Traditional Chinese (繁體中文)，避免籠統的「趨勢轉強」。
          
          請回傳 JSON 格式，包含一個陣列，每個物件有 symbol 和 aiInsight。`;
