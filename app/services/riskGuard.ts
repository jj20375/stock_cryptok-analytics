import type { MarketRiskLevel, CryptoMarketRegime } from "./cryptoMarketRegime";

export interface RiskSettings {
  capitalBaseUsdt: number;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxPositionSizePct: number;
  riskStopLossPct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  cryptoCrashGuardEnabled: boolean;
  liveTradingEnabled: boolean;
}

export interface RiskDecision {
  allowTrade: boolean;
  reason: string;
  riskLevel: MarketRiskLevel;
  settings: RiskSettings;
  stats: {
    dailyPnL: number;
    dailyTrades: number;
    openPositions: number;
    consecutiveLosses: number;
    maxDailyLossUsdt: number;
  };
}

interface TradeLike {
  symbol: string;
  status: string;
  pnl: string | null;
  createdAt: string;
  closedAt: string | null;
}

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  capitalBaseUsdt: 1000,
  maxRiskPerTradePct: 0.5,
  maxDailyLossPct: 1,
  maxPositionSizePct: 10,
  riskStopLossPct: 5,
  maxOpenPositions: 2,
  maxTradesPerDay: 3,
  cryptoCrashGuardEnabled: true,
  liveTradingEnabled: false,
};

const parsePositiveNumber = (value: unknown, fallback: number, min = 0.0001, max = Number.POSITIVE_INFINITY) => {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const parsePositiveInteger = (value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
};

export const getRiskSettingsFromUser = (user: any): RiskSettings => ({
  capitalBaseUsdt: parsePositiveNumber(user.capitalBaseUsdt, DEFAULT_RISK_SETTINGS.capitalBaseUsdt, 10),
  maxRiskPerTradePct: parsePositiveNumber(user.maxRiskPerTradePct, DEFAULT_RISK_SETTINGS.maxRiskPerTradePct, 0.1, 3),
  maxDailyLossPct: parsePositiveNumber(user.maxDailyLossPct, DEFAULT_RISK_SETTINGS.maxDailyLossPct, 0.1, 10),
  maxPositionSizePct: parsePositiveNumber(user.maxPositionSizePct, DEFAULT_RISK_SETTINGS.maxPositionSizePct, 1, 100),
  riskStopLossPct: parsePositiveNumber(user.riskStopLossPct, DEFAULT_RISK_SETTINGS.riskStopLossPct, 1, 30),
  maxOpenPositions: parsePositiveInteger(user.maxOpenPositions, DEFAULT_RISK_SETTINGS.maxOpenPositions, 1, 20),
  maxTradesPerDay: parsePositiveInteger(user.maxTradesPerDay, DEFAULT_RISK_SETTINGS.maxTradesPerDay, 1, 50),
  cryptoCrashGuardEnabled: parseBoolean(user.cryptoCrashGuardEnabled, DEFAULT_RISK_SETTINGS.cryptoCrashGuardEnabled),
  liveTradingEnabled: parseBoolean(user.liveTradingEnabled, DEFAULT_RISK_SETTINGS.liveTradingEnabled),
});

const getTaipeiDateKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const isTodayTaipei = (dateLike: string | null, now = new Date()) => {
  if (!dateLike) return false;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return false;
  return getTaipeiDateKey(date) === getTaipeiDateKey(now);
};

const getConsecutiveLosses = (trades: TradeLike[]) => {
  const closedTrades = trades
    .filter((trade) => trade.status === "CLOSED")
    .sort((a, b) => {
      const aTime = new Date(a.closedAt || a.createdAt).getTime();
      const bTime = new Date(b.closedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

  let losses = 0;
  for (const trade of closedTrades) {
    const pnl = parseFloat(trade.pnl || "0");
    if (pnl < 0) losses += 1;
    else break;
  }
  return losses;
};

export const evaluateCapitalRisk = ({
  cryptoRegime,
  isEntrySignal,
  isLive,
  symbol,
  trades,
  user,
}: {
  cryptoRegime?: CryptoMarketRegime;
  isEntrySignal: boolean;
  isLive: boolean;
  symbol: string;
  trades: TradeLike[];
  user: any;
}): RiskDecision => {
  const settings = getRiskSettingsFromUser(user);
  const openTrades = trades.filter((trade) => trade.status === "OPEN");
  const dailyTrades = trades.filter((trade) => isTodayTaipei(trade.createdAt)).length;
  const dailyPnL = trades
    .filter((trade) => trade.status === "CLOSED" && isTodayTaipei(trade.closedAt || trade.createdAt))
    .reduce((sum, trade) => sum + parseFloat(trade.pnl || "0"), 0);
  const consecutiveLosses = getConsecutiveLosses(trades);
  const maxDailyLossUsdt = settings.capitalBaseUsdt * (settings.maxDailyLossPct / 100);

  const stats = {
    dailyPnL,
    dailyTrades,
    openPositions: openTrades.length,
    consecutiveLosses,
    maxDailyLossUsdt,
  };

  if (!isEntrySignal) {
    return {
      allowTrade: true,
      reason: "非開倉訊號，不套用新倉風控限制",
      riskLevel: cryptoRegime?.riskLevel || "LOW",
      settings,
      stats,
    };
  }

  if (isLive && !settings.liveTradingEnabled) {
    return {
      allowTrade: false,
      reason: "LIVE 實戰保護尚未啟用，已阻擋真實下單",
      riskLevel: "HIGH",
      settings,
      stats,
    };
  }

  if (dailyPnL <= -maxDailyLossUsdt) {
    return {
      allowTrade: false,
      reason: `今日虧損 ${Math.abs(dailyPnL).toFixed(2)} USDT 已達上限 ${maxDailyLossUsdt.toFixed(2)} USDT`,
      riskLevel: "HIGH",
      settings,
      stats,
    };
  }

  if (dailyTrades >= settings.maxTradesPerDay) {
    return {
      allowTrade: false,
      reason: `今日交易次數 ${dailyTrades} 已達上限 ${settings.maxTradesPerDay}`,
      riskLevel: "MEDIUM",
      settings,
      stats,
    };
  }

  if (consecutiveLosses >= 3) {
    return {
      allowTrade: false,
      reason: "已連續虧損 3 筆，暫停開新倉保護本金",
      riskLevel: "HIGH",
      settings,
      stats,
    };
  }

  if (openTrades.length >= settings.maxOpenPositions) {
    return {
      allowTrade: false,
      reason: `目前持倉 ${openTrades.length} 筆，已達最大持倉上限 ${settings.maxOpenPositions}`,
      riskLevel: "MEDIUM",
      settings,
      stats,
    };
  }

  if (openTrades.some((trade) => trade.symbol === symbol)) {
    return {
      allowTrade: false,
      reason: `${symbol} 已有開倉紀錄，避免重複加碼`,
      riskLevel: "MEDIUM",
      settings,
      stats,
    };
  }

  if (settings.cryptoCrashGuardEnabled && cryptoRegime && !cryptoRegime.allowLong) {
    return {
      allowTrade: false,
      reason: cryptoRegime.reason,
      riskLevel: cryptoRegime.riskLevel,
      settings,
      stats,
    };
  }

  return {
    allowTrade: true,
    reason: "通過本金保護檢查",
    riskLevel: cryptoRegime?.riskLevel || "LOW",
    settings,
    stats,
  };
};
