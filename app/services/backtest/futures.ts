/** @file 合約模擬與執行共用風險計算；USDT 單資產逐倉，級距快照不是歷史強平保證。 */
import type { Candle, StrategyEntryPlan } from '../strategy/types';
import { applySlippage, calculateFee, type CostModel } from './costs';
import { resolveEntryRisk } from './entryExecution';

export interface FundingPoint { time: number; rate: number }
export interface MarginTier { min: number; max: number; rate: number; maxLeverage: number }
export interface FuturesSimulation {
  leverage: number;
  funding: FundingPoint[];
  marks: Candle[];
  tiers: MarginTier[];
  /** 目前公開級距的取得時間；過去可能不同，因此輸出必須揭露模型限制。 */
  tiersObservedAt: number;
  fundingComplete: boolean;
  direction?: 'BOTH' | 'LONG' | 'SHORT';
  minQuantity?: number;
  minNotional?: number;
  quantityStep?: number;
  minLeverage?: number;
}

export function maintenanceRate(notional: number, tiers: MarginTier[]) {
  return tiers.find(tier => notional >= tier.min && notional <= tier.max)?.rate;
}

/** 無歷史維持保證金抵扣額時不自行猜測；使用完整級距率估算是較嚴格的壓力情境。 */
export function liquidationEstimate(side: 'LONG' | 'SHORT', entry: number, quantity: number, margin: number,
  fundingPnl: number, feeRate: number, tiers: MarginTier[]) {
  let price = entry;
  for (let i = 0; i < 8; i++) {
    const rate = maintenanceRate(price * quantity, tiers);
    if (rate == null || quantity <= 0) return null;
    const balance = (margin + fundingPnl) / quantity;
    const next = side === 'LONG' ? (entry - balance) / (1 - rate - feeRate) : (entry + balance) / (1 + rate + feeRate);
    if (next <= 0) return null;
    if (Math.abs(next - price) < entry * 1e-9) return next;
    price = next;
  }
  return price;
}

/** 槓桿是上限，不是固定倍數；逐倍降低以保留半個停損風險的強平緩衝，不改名目部位或停損。 */
export function futuresLeverageForStop(side: 'LONG' | 'SHORT', price: number, quantity: number, stop: number,
  feeRate: number, tiers: MarginTier[], cap: number, minimum = 1) {
  if (![price, quantity, stop, feeRate, cap, minimum].every(Number.isFinite) || price <= 0 || quantity <= 0 || stop <= 0
    || feeRate < 0 || feeRate >= 1 || !Number.isInteger(cap) || cap < 1 || cap > 75 || minimum < 1
    || (side === 'LONG' ? stop >= price : stop <= price)) return { error: side === 'LONG' && stop === 0
      ? '幣價停損100%的多單停損價為0，無法保留合約強平安全距離' : '合約槓桿與停損設定無效' };
  const notional = quantity * price, tier = tiers.find(t => notional >= t.min && notional <= t.max);
  if (tiers.length && (!tier || !Number.isFinite(tier.maxLeverage) || tier.rate + feeRate >= 1)) return { error: '合約級距不足或無法估算強平' };
  const maximum = Math.floor(Math.min(cap, tier?.maxLeverage ?? cap));
  if (maximum < minimum) return { error: '合約最低槓桿超出設定上限或級距限制' };
  /** 無級距的純研究只保留未驗證標示；實際 Demo 的行情層要求有效完整級距。 */
  if (!tiers.length) return { leverage: maximum, margin: notional / maximum, liquidationPrice: null };
  for (let leverage = maximum; leverage >= Math.ceil(minimum); leverage--) {
    const margin = notional / leverage;
    let liquidationPrice = liquidationEstimate(side, price, quantity, margin, 0, feeRate, tiers);
    /** 1x 多單配置等同完整名目本金，模型沒有正價格強平點；不把其他缺資料情況當成安全。 */
    if (liquidationPrice == null && side === 'LONG' && leverage === 1) liquidationPrice = 0;
    if (liquidationPrice != null && (side === 'LONG' ? stop - liquidationPrice : liquidationPrice - stop) >= Math.abs(price - stop) * 0.5) {
      return { leverage, margin, liquidationPrice };
    }
  }
  return { error: '使用者槓桿上限與商品最低倍數內，無法保留安全強平距離' };
}

/** 預估資金費率只讀進場之前已結算資料；不把未來有利費率拿來擴大倉位。 */
export function knownFundingBudget(points: FundingPoint[], time: number, side: 'LONG' | 'SHORT', holdingHours: number) {
  const known = points.filter(point => point.time <= time).slice(-2);
  if (!known.length) return 0;
  const intervalHours = known.length > 1 ? Math.max(1, (known[1].time - known[0].time) / 3_600_000) : 1;
  return Math.max(0, known.at(-1)!.rate * (side === 'LONG' ? 1 : -1)) * Math.ceil(holdingHours / intervalHours);
}

export function futuresEntryRisk(side: 'LONG' | 'SHORT', price: number, plan: StrategyEntryPlan | undefined, cost: CostModel,
  equity: number, riskPct: number, positionPct: number, precision: number, leverage: number, fundingBudget = 0, fallbackStopPct = 5) {
  const resolved = resolveEntryRisk(side, price, fallbackStopPct, plan, cost);
  if ('error' in resolved) return resolved;
  const distance = Math.abs(price - resolved.stopLossPrice);
  const targetPrice = plan?.targetMultiple != null ? price + (side === 'LONG' ? 1 : -1) * distance * plan.targetMultiple : plan?.targetPrice;
  const stopFill = applySlippage(resolved.stopLossPrice, side === 'LONG' ? 'SELL' : 'BUY', cost);
  const lossPerUnit = Math.abs(price - stopFill) + calculateFee(price, 1, cost) + calculateFee(stopFill, 1, cost) + price * fundingBudget;
  if (targetPrice != null && plan?.minRewardRisk != null) {
    const targetFill = applySlippage(targetPrice, side === 'LONG' ? 'SELL' : 'BUY', cost);
    const netReward = (side === 'LONG' ? targetFill - price : price - targetFill)
      - calculateFee(price, 1, cost) - calculateFee(targetFill, 1, cost) - price * fundingBudget;
    if (netReward / lossPerUnit < plan.minRewardRisk) return { error: '手續費、滑價與資金費率後目標空間不足' };
  }
  /** 同時保留 0.25% 單筆與 5% 名目上限；槓桿不乘到名目部位。 */
  const scale = 10 ** precision;
  const quantity = Math.floor(Math.min(equity * Math.min(riskPct, 0.25) / 100 / lossPerUnit,
    equity * Math.min(positionPct, 5) / 100 / price, equity / (price / leverage + price * cost.feeRate)) * scale) / scale;
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(leverage) || leverage < 1 || leverage > 75) return { error: '合約數量或槓桿無效' };
  return { ...resolved, quantity, targetPrice, margin: quantity * price / leverage, riskUsdt: quantity * lossPerUnit };
}
