/** @file 回測成交假設的共用數字邊界；前端提示與API使用同一份限制，百分比欄位單位為%。 */
import type { BacktestFormValues } from './types';
export type ExecutionSettings = Pick<BacktestFormValues, 'initialCapital' | 'feeRatePct' | 'sellTaxRatePct'
  | 'slippageBps' | 'fillMode' | 'maxRiskPerTradePct' | 'maxPositionSizePct'>;
const fields: { key: Exclude<keyof ExecutionSettings, 'fillMode'>; label: string; min: number; max?: number; step: number }[] = [
  { key: 'initialCapital', label: '初始資金（標的報價幣別）', min: 100, step: 0.01 },
  { key: 'feeRatePct', label: '手續費率 %（單邊）', min: 0, max: 5, step: 0.0001 },
  { key: 'sellTaxRatePct', label: '賣出交易稅率 %', min: 0, max: 5, step: 0.01 },
  { key: 'slippageBps', label: '滑價（bps）', min: 0, max: 1000, step: 1 },
  { key: 'maxRiskPerTradePct', label: '單筆風險 %', min: 0.1, max: 5, step: 0.01 },
  { key: 'maxPositionSizePct', label: '最大倉位 %', min: 1, max: 100, step: 1 },
];
/** 合約與API同樣限制0.25%風險、5%部位及零現貨交易稅。 */
export const getExecutionFields = (futures = false) => fields.map(field => !futures ? field : field.key === 'maxRiskPerTradePct'
  ? { ...field, min: 0.01, max: 0.25 } : field.key === 'maxPositionSizePct' ? { ...field, max: 5 }
  : field.key === 'sellTaxRatePct' ? { ...field, max: 0 } : field);
