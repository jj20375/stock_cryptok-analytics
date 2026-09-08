import type { BacktestDetail } from '../types';
import { waveSource } from '../../../services/cryptoUniverse';

/** 目標衡量採帳戶期末權益，不把單筆漲幅或多幣獨立回測相加當成翻倍。 */
export function WaveGoalResult({ detail }: { detail: BacktestDetail }) {
  const result = detail.result;
  if (detail.strategyId !== 'crypto_wave' || !result || result.initialCapital <= 0) return null;
  const multiple = result.finalEquity / result.initialCapital;
  const remaining = Math.max(0, result.initialCapital * 2 - result.finalEquity);
  return <section className="bg-white/80 border border-black/20 rounded p-4 space-y-2 text-sm">
    <h2 className="font-bold">翻倍目標驗證：期末 {multiple.toFixed(2)} 倍本金</h2>
    <p>{multiple >= 2 ? '本次歷史區間期末達到翻倍目標。' : `距離兩倍本金尚差 ${remaining.toFixed(2)} USDT。`}
      {' '}最大回撤 {result.maxDrawdownPct}%，共 {result.totalTrades} 筆交易。</p>
    <p>來源：{waveSource(detail.symbol)}。已計入設定的費用與滑價；此為單幣複利模擬，非多幣共同資金組合。</p>
    <p className="text-amber-800">{result.totalTrades < 20 ? '交易少於 20 筆，樣本有限。' : ''} 尚未完成樣本外驗證，歷史達標不代表未來可重現。</p>
  </section>;
}
