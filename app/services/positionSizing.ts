export interface PositionSizingInput {
  capitalBaseUsdt: number;
  currentPrice: number;
  maxPositionSizePct: number;
  maxRiskPerTradePct: number;
  precision: number;
  stopLossPct: number;
  minNotionalUsdt?: number;
}

export interface PositionSizingResult {
  quantity: number;
  notionalUsdt: number;
  riskUsdt: number;
  stopLossPrice: number;
  maxRiskNotionalUsdt: number;
  maxPositionNotionalUsdt: number;
  reason?: string;
}

const floorToPrecision = (value: number, precision: number) => {
  const multiplier = Math.pow(10, precision);
  return Math.floor(value * multiplier) / multiplier;
};

export const calculateRiskBasedPosition = ({
  capitalBaseUsdt,
  currentPrice,
  maxPositionSizePct,
  maxRiskPerTradePct,
  precision,
  stopLossPct,
  minNotionalUsdt = 5,
}: PositionSizingInput): PositionSizingResult => {
  if (capitalBaseUsdt <= 0 || currentPrice <= 0 || stopLossPct <= 0) {
    return {
      quantity: 0,
      notionalUsdt: 0,
      riskUsdt: 0,
      stopLossPrice: 0,
      maxRiskNotionalUsdt: 0,
      maxPositionNotionalUsdt: 0,
      reason: "本金、價格或停損設定不完整",
    };
  }

  const riskUsdt = capitalBaseUsdt * (maxRiskPerTradePct / 100);
  const stopLossPrice = currentPrice * (1 - stopLossPct / 100);
  const maxRiskNotionalUsdt = riskUsdt / (stopLossPct / 100);
  const maxPositionNotionalUsdt = capitalBaseUsdt * (maxPositionSizePct / 100);
  const notionalUsdt = Math.min(maxRiskNotionalUsdt, maxPositionNotionalUsdt);
  const quantity = floorToPrecision(notionalUsdt / currentPrice, precision);
  const roundedNotional = quantity * currentPrice;

  if (quantity <= 0 || roundedNotional < minNotionalUsdt) {
    return {
      quantity: 0,
      notionalUsdt: roundedNotional,
      riskUsdt,
      stopLossPrice,
      maxRiskNotionalUsdt,
      maxPositionNotionalUsdt,
      reason: "依照目前風控設定，計算出的倉位低於交易所最小下單額",
    };
  }

  return {
    quantity,
    notionalUsdt: roundedNotional,
    riskUsdt,
    stopLossPrice,
    maxRiskNotionalUsdt,
    maxPositionNotionalUsdt,
  };
};
