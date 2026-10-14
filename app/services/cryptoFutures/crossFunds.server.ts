/** @file 全倉資金只取交易所可用 USDT，不將現貨、其他抵押幣或借款列入下單本金。 */
import { bitgetSignedGet, type BitgetFuturesAccount, type BitgetFuturesEnvironment } from '../bitgetService';
import type { Credentials } from '../bitgetLedger/types';
import type { MarginTier } from '../backtest/futures';

export interface CrossFunds {
  /** USDT 淨值為風控本金，availableUsdt 已扣除目前初始保證金及鎖定額度。 */
  equityUsdt: number; availableUsdt: number; maintenanceUsdt: number;
}
const amount = (value: unknown) => typeof value === 'string' && value.trim() !== '' || typeof value === 'number'
  ? Number(value) : NaN;
export function parseCrossFunds(data: any, dialect: BitgetFuturesAccount['apiDialect']): CrossFunds {
  let funds: CrossFunds;
  if (dialect === 'UTA_V3') {
    const usdt = Array.isArray(data?.assets) ? data.assets.find((asset: any) => asset.coin === 'USDT') : null;
    const debt = amount(usdt?.debt), effective = amount(data?.effEquity), initial = amount(data?.imr);
    /** 全倉可共享多資產抵押，但本功能只分配實有 USDT；借款或負餘額不能當本金。 */
    if (!Number.isFinite(debt) || debt !== 0 || !Number.isFinite(initial) || initial < 0) throw new Error('合約 USDT 資金含借款或保證金資料不足');
    funds = { equityUsdt: Math.min(amount(usdt?.equity), effective),
      availableUsdt: Math.min(amount(usdt?.available), effective - initial), maintenanceUsdt: amount(data?.mmr) };
  } else {
    /** Classic 多資產帳戶無法將劃轉的 USDT 與其他抵押品風險隔離，需先核對設定。 */
    if (data?.marginCoin !== 'USDT' || data?.assetMode !== 'single') throw new Error('合約自動化需 Classic USDT 單資產帳戶，請核對帳戶資金模式');
    funds = { equityUsdt: amount(data.accountEquity), availableUsdt: Math.min(amount(data.available), amount(data.crossedMaxAvailable)),
      maintenanceUsdt: amount(data.crossedRiskRate) * amount(data.accountEquity) };
  }
  if (!Object.values(funds).every(Number.isFinite) || funds.equityUsdt <= 0 || funds.availableUsdt <= 0 || funds.maintenanceUsdt < 0) throw new Error('合約可用 USDT 不足或資金資料無效；請先劃轉並重試');
  return funds;
}
export async function fetchCrossFunds(environment: BitgetFuturesEnvironment, symbol: string, account: BitgetFuturesAccount, credentials: Credentials) {
  const path = account.apiDialect === 'UTA_V3' ? '/api/v3/account/assets'
    : `/api/v2/mix/account/account?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&marginCoin=USDT`;
  const data = await bitgetSignedGet(path, credentials.apiKey, credentials.apiSecret, credentials.passphrase, { demo: environment === 'DEMO' });
  return parseCrossFunds(data, account.apiDialect);
}
/** 全倉沒有單筆固定强平點；檢查資金及維持保證金壓力，不沿用逐倉價格模型。 */
export function crossEntryCheck(funds: CrossFunds, notional: number, leverage: number, riskUsdt: number, feeRate: number, tiers: MarginTier[]) {
  const tier = tiers.find(row => notional >= row.min && notional <= row.max);
  if (!tier || ![notional, leverage, riskUsdt, feeRate, tier.rate, tier.maxLeverage].every(Number.isFinite)
    || notional <= 0 || leverage < 1 || riskUsdt < 0 || feeRate < 0 || tier.rate < 0 || leverage > tier.maxLeverage) return '合約全倉級距或槓桿資料無效';
  /** 預留雙邊費用與完整計畫停損，不耗盡可用保證金；仍需交易所實際成交與風險對帳。 */
  if (notional / leverage + notional * feeRate * 2 + riskUsdt > funds.availableUsdt) return '全倉可用 USDT 不足以支付保證金、費用與停損預留';
  if (funds.equityUsdt - riskUsdt <= (funds.maintenanceUsdt + notional * tier.rate) * 1.5) return '全倉維持保證金安全緩衝不足';
  return null;
}
