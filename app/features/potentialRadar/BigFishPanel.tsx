/** @file 呈現收盤後的吃大魚原始條件與防守線；不將觀察訊號當成實際持倉。 */
import { bigFishLabel } from '../../services/potentialRadar/bigFish';
import type { RadarSignal } from '../../services/potentialRadar/types';

const price = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 7 });

export function BigFishPanel({ signal }: { signal: RadarSignal }) {
  const fish = signal.bigFish;
  if (!fish) return <p className="rounded bg-black/5 p-3 text-xs">吃大魚 2.0：此筆尚未計算，等待新版掃描。</p>;
  const blocked = signal.phase === 'EXCLUDED' || signal.phase === 'EXTENDED';
  return <section aria-label="吃大魚策略訊號" className={`rounded-lg border p-3 space-y-2 text-sm ${fish.entry ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-black/10 bg-black/5'}`}>
    {/* 舊快照沒有 timeframe 欄位，代表升級前以 15 分線計算的結果 */}
    <p className="font-semibold">吃大魚 2.0 · {fish.timeframe === '4h' ? '4 小時線' : '15 分線（舊版資料）'}</p>
    <p>{bigFishLabel(fish)}</p>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      <dt>動態防守線（ST）</dt><dd className="text-right">{price(fish.supertrend)} · {fish.direction === -1 ? '綠' : '紅'}</dd>
      <dt>牛熊生命線（EMA200）</dt><dd className="text-right">{price(fish.ema200)}</dd>
      <dt>MACD／訊號線</dt><dd className="text-right">{price(fish.macdLine)}／{price(fish.signalLine)}</dd>
    </dl>
    {fish.entry && blocked && <p className="text-xs text-amber-800">原始進場條件成立，但{signal.phase === 'EXCLUDED' ? '流動性不合格' : '漲幅過熱'}，不列優先觀察。</p>}
    {fish.exitLong && <p className="text-xs text-amber-800">{fish.entry ? '提早進場與出場條件同時成立；' : ''}ST 為紅色，若持有多單，原策略符合平倉條件。</p>}
    <p className="text-xs opacity-65">線位為 USDT 參考值，未設定停損委託；只標示當根條件，不代表已成交。</p>
  </section>;
}
