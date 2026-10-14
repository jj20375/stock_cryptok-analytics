/** @component 本金風控數字欄位；沿用設定頁的門檻，原生form驗證通過後才交給伺服器儲存。 */
import { NumericInput } from '../../components/NumericInput';

const fields = [
  { name: 'capitalBaseUsdt', label: '本金基準 (USDT)', min: 10, max: 100000000, step: 10 },
  { name: 'maxRiskPerTradePct', label: '單筆最大風險 (%)', min: 0.1, max: 3, step: 0.1 },
  { name: 'maxDailyLossPct', label: '每日最大虧損 (%)', min: 0.1, max: 10, step: 0.1 },
  { name: 'maxPositionSizePct', label: '單筆最大倉位 (%)', min: 1, max: 100, step: 1 },
  { name: 'riskStopLossPct', label: '預設停損距離 (%)', min: 1, max: 30, step: 0.5 },
  { name: 'maxOpenPositions', label: '最大同時持倉數', min: 1, max: 20, step: 1 },
  { name: 'maxTradesPerDay', label: '每日最大交易次數', min: 1, max: 50, step: 1 },
] as const;
type Values = Record<typeof fields[number]['name'], string | number>;

export function RiskSettingsFields({ values }: { values: Values }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{fields.map(field => <label key={field.name} className="block text-sm font-bold text-[#141414]">
    {field.label}<NumericInput {...field} defaultValue={values[field.name]} className="mt-1 w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none" />
  </label>)}</div>;
}
