/** @file 進場成交驗證：依實際成交價檢查追價、跳空與扣成本後報酬風險，失效訊號不建立持倉。 */
import type { StrategyEntryPlan } from '../strategy/types';
import { applySlippage, calculateFee, type CostModel } from './costs';

export function resolveEntryRisk(side: 'LONG' | 'SHORT', fillPrice: number, fallbackPct: number,
  plan: StrategyEntryPlan | undefined, cost: CostModel): { stopLossPct: number; stopLossPrice: number } | { error: string } {
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return { error: '成交價無效' };
  if (!Number.isFinite(cost.feeRate) || cost.feeRate < 0 || cost.feeRate >= 1 || !Number.isFinite(cost.slippageBps)
    || cost.slippageBps < 0 || cost.slippageBps >= 10_000 || !Number.isFinite(cost.sellTaxRate ?? 0)
    || (cost.sellTaxRate ?? 0) < 0 || (cost.sellTaxRate ?? 0) >= 1) return { error: '成本設定無效' };
  if (plan && (Object.values(plan).some(value => value != null && !Number.isFinite(value)) || plan.stopDistance <= 0)) {
    return { error: '進場快照或 ATR 停損距離無效' };
  }
  if (plan?.minPrice != null && fillPrice < plan.minPrice) return { error: '開盤跳空跌破確認價位' };
  if (plan?.maxPrice != null && fillPrice > plan.maxPrice) return { error: '成交價超出追價上限' };
  const structuralDistance = plan?.stopPrice != null ? (side === 'LONG' ? fillPrice - plan.stopPrice : plan.stopPrice - fillPrice) : plan?.stopDistance;
  if (structuralDistance != null && structuralDistance <= 0) return { error: '成交價已越過結構停損' };
  const distance = plan ? Math.max(structuralDistance ?? plan.stopDistance, plan.minStopDistance ?? 0) : fillPrice * (fallbackPct / 100);
  if (plan?.maxStopDistance != null && distance > plan.maxStopDistance) return { error: '結構停損過寬，取消進場' };
  // 固定百分比允許100%（多單停損價0）；ATR／結構快照仍須小於100%，不得藉此放寬合約強平檢查。
  const stopLossPct = plan ? distance / fillPrice * 100 : fallbackPct;
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0 || stopLossPct > 100 || (plan && stopLossPct === 100)) return { error: '停損距離超出有效範圍' };
  if (plan?.minRewardRisk != null) {
    const targetPrice = plan.targetMultiple != null ? fillPrice + (side === 'LONG' ? 1 : -1) * distance * plan.targetMultiple : plan.targetPrice;
    if (targetPrice == null || targetPrice <= 0 || plan.minRewardRisk <= 0) return { error: '固定目標或報酬風險比無效' };
    /** 目標出場亦按不利滑價與雙邊成本估算；只是下單前門檻，不保證下一根出場成交價。 */
    const targetFill = applySlippage(targetPrice, side === 'LONG' ? 'SELL' : 'BUY', cost);
    const reward = (side === 'LONG' ? targetFill - fillPrice : fillPrice - targetFill)
      - calculateFee(fillPrice, 1, cost, side === 'LONG' ? 'BUY' : 'SELL')
      - calculateFee(targetFill, 1, cost, side === 'LONG' ? 'SELL' : 'BUY');
    if (reward / distance < plan.minRewardRisk) return { error: '扣成本後目標空間不足' };
  }
  return { stopLossPct, stopLossPrice: side === 'LONG' ? fillPrice - distance : fillPrice + distance };
}
