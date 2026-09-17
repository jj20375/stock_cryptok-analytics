/**
 * 【詳細繁體中文註解】：永續合約風險輔助工具(僅供顯示用,不涉及下單)
 *
 * 用途:「戰情室」頁面需要在只讀看板上呈現合約交易的關鍵風險資訊——
 * 資金費率(持倉成本)與爆倉價估算(槓桿倍數下的最大虧損邊界)。
 * 本檔案不呼叫任何下單 API,純粹計算/查詢公開資料。
 *
 * 爆倉價計算為簡化估算,原因:
 *   真實爆倉價會依交易所的「維持保證金階梯」(依倉位名目金額分級,倉位越大維持保證金率越高)、
 *   實際手續費、資金費率累積而變動,且逐倉/全倉模式計算方式也不同。
 *   本工具採用「逐倉模式 + 固定維持保證金率」的簡化公式,僅供戰情室快速评估使用,
 *   實際爆倉價請以交易所當下顯示的數值為準,不可直接依賴此估算值下單。
 */

// 【詳細繁體中文註解】：簡化維持保證金率預設值 —
// 主流幣種在多數交易所低槓桿階梯的維持保證金率約落在 0.4%~0.5%,此處取 0.5% 保守估計。
const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;

export interface LiquidationEstimateInput {
  entryPrice: number;
  leverage: number;
  side: 'LONG' | 'SHORT';
  maintenanceMarginRate?: number;
}

/**
 * 估算逐倉模式下的爆倉價(簡化公式,詳見檔頭說明)。
 * LONG:entryPrice × (1 − 1/槓桿 + 維持保證金率)
 * SHORT:entryPrice × (1 + 1/槓桿 − 維持保證金率)
 */
export const estimateLiquidationPrice = ({
  entryPrice,
  leverage,
  side,
  maintenanceMarginRate = DEFAULT_MAINTENANCE_MARGIN_RATE,
}: LiquidationEstimateInput): number => {
  if (leverage <= 0 || entryPrice <= 0) return 0;
  return side === 'LONG'
    ? entryPrice * (1 - 1 / leverage + maintenanceMarginRate)
    : entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
};

/**
 * 檢查策略建議的停損價是否會「來不及觸發」— 也就是停損價已經超過估算爆倉價,
 * 代表實際交易時系統會先爆倉、停損形同虛設。這是高槓桿新手最容易忽略的風險,
 * 戰情室必須明確標示警告。
 */
export const isStopLossPastLiquidation = (
  side: 'LONG' | 'SHORT',
  stopLossPrice: number,
  liquidationPrice: number
): boolean => (side === 'LONG' ? stopLossPrice <= liquidationPrice : stopLossPrice >= liquidationPrice);

export interface FundingRateInfo {
  fundingRate: number;
  nextFundingTime: number;
  markPrice: number;
}

/**
 * 查詢 Binance USDT 本位永續合約的當前資金費率與標記價格(公開端點,不需金鑰)。
 * 外部 API 副作用註記:單一標的查詢失敗時回傳 null,呼叫端應略過該標的、不中斷整體流程。
 */
export const fetchFundingRate = async (symbol: string): Promise<FundingRateInfo | null> => {
  try {
    /** 持倉成本是輔助資料，八秒逾時就顯示未知，不能拖住整頁量價訊號。 */
    const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = (await response.json()) as any;
    return {
      fundingRate: parseFloat(data.lastFundingRate),
      nextFundingTime: data.nextFundingTime,
      markPrice: parseFloat(data.markPrice),
    };
  } catch (error) {
    console.error(`❌ [Futures Risk] ${symbol} 資金費率查詢失敗:`, error);
    return null;
  }
};
