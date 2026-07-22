/**
 * 【詳細繁體中文註解】：回測交易成本模型(手續費 + 滑價)
 *
 * 模擬假設(會在回測報告中揭露):
 *   - 手續費:名目金額 × feeRate,進場與出場各收一次。
 *     預設 0.001(Binance 現貨 taker 0.1%);美股免佣券商可設 0。
 *   - 滑價:市價單成交價相對理論價的不利偏移,以基點(bps)表示。
 *     買入成交價 = 理論價 × (1 + slippageBps/10000)
 *     賣出成交價 = 理論價 × (1 - slippageBps/10000)
 *     預設 5 bps(0.05%),為主流幣種流動性下的保守估計;小幣或劇烈行情實際滑價可能更大。
 */

export interface CostModel {
  /** 手續費率(0.001 = 0.1%) */
  feeRate: number;
  /** 滑價基點(5 = 0.05%) */
  slippageBps: number;
}

/** 預設成本模型:Binance 現貨 taker 費率 + 5 bps 滑價 */
export const DEFAULT_COST_MODEL: CostModel = {
  feeRate: 0.001,
  slippageBps: 5,
};

/**
 * 套用滑價後的實際成交價。
 * @param price 理論成交價(K 線 open/close 或停損價)
 * @param direction 資金方向:'BUY' 買入(不利方向=價格變高)、'SELL' 賣出(不利方向=價格變低)
 */
export const applySlippage = (price: number, direction: 'BUY' | 'SELL', model: CostModel): number => {
  const slip = model.slippageBps / 10000;
  return direction === 'BUY' ? price * (1 + slip) : price * (1 - slip);
};

/** 單邊手續費(以成交名目金額計) */
export const calculateFee = (fillPrice: number, quantity: number, model: CostModel): number => {
  return fillPrice * quantity * model.feeRate;
};
