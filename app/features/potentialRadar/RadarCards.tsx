/** @file 候選卡片與研究追蹤表；只呈現傳入快照，不發送請求或執行交易。 */
import { DAY_MS, PHASE_LABELS, QUARTER_MS, type RadarObservation, type RadarSnapshot } from '../../services/potentialRadar/types';
import { bigFishLabel } from '../../services/potentialRadar/bigFish';
import { DERIVATIVE_LABELS } from '../../services/potentialRadar/derivatives';
import { BigFishPanel } from './BigFishPanel';
import { TrendConfirmationPanel } from './TrendConfirmationPanel';
import { DerivativesPanel } from './DerivativesPanel';
import { BarChart3 } from 'lucide-react';

export const formatPct = (n: number | null) => n === null ? '待追蹤' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
export const formatTime = (n: number) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(n);
const price = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 7 });

export { snapshotFresh } from './freshness';

export function RadarCard({ snapshot, observation, onOpenChart }: { snapshot: RadarSnapshot; observation?: RadarObservation; onOpenChart?: (snapshot: RadarSnapshot) => void }) {
  const signal = snapshot.signal!;
  return <article className="rounded-xl border border-black/15 bg-white/80 p-5 space-y-4">
    <div className="flex justify-between gap-3">
      <div><h2 className="font-bold text-xl">{snapshot.symbol.replace(/USDT$/, '')}</h2>
        <span className="text-xs opacity-60">{signal.source === 'GATE_SPOT' ? 'Gate' : 'Bybit'} 現貨 · USDT</span></div>
      <div className="text-right"><button type="button" onClick={() => onOpenChart?.(snapshot)} className="mb-2 inline-flex items-center gap-1 rounded border border-black/20 bg-white/70 px-2 py-1 text-xs font-medium hover:bg-white" aria-label={`開啟 ${snapshot.symbol} K 線圖`}><BarChart3 size={14} />K 線圖</button><br />
        <span className="rounded bg-emerald-50 text-emerald-800 px-2 py-1 text-sm">{PHASE_LABELS[signal.phase]}</span>
        <p className="mt-2 text-xl font-semibold">{signal.score}<span className="text-xs font-normal opacity-60"> / 100 觀察分數</span></p></div>
    </div>
    <p className="text-sm font-medium">{signal.trendConfirmation?.confirmed ? '15 分觸發與中週期趨勢共振' : signal.hourlyUp && signal.fourHourlyUp ? '多週期轉強，等待 MA20 回踩確認' : '短線異動，等待較大週期確認'}</p>
    <BigFishPanel signal={signal} />
    <TrendConfirmationPanel signal={signal} />
    <DerivativesPanel derivatives={signal.derivatives} />
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt>15 分收盤</dt><dd className="text-right">{price(signal.price)}</dd>
      <dt>15 分漲跌</dt><dd className="text-right">{formatPct(signal.change15m)}</dd>
      <dt>15 分成交額倍數</dt><dd className="text-right">{signal.volumeRatio.toFixed(2)} 倍</dd>
      <dt>近 1h／24h 漲跌</dt><dd className="text-right">{formatPct(signal.change1h)}／{formatPct(signal.change24h)}</dd>
      <dt>突破參考</dt><dd className="text-right">{price(signal.breakout)}</dd>
      <dt>距突破參考</dt><dd className="text-right">{formatPct(signal.distancePct)}</dd>
      <dt>結構失效參考</dt><dd className="text-right">{price(signal.invalidation)}</dd>
      <dt>1 小時／4 小時趨勢</dt><dd className="text-right">{signal.hourlyUp ? '向上' : '待確認'}／{signal.fourHourlyUp ? '向上' : '待確認'}</dd>
      <dt>領先 BTC：1h／4h／24h</dt><dd className="text-right">{[signal.relative1h, signal.relative4h, signal.relative24h].map(n => n.toFixed(1)).join('／')} 百分點</dd>
      <dt>BTC 近 24 小時</dt><dd className="text-right">{formatPct(signal.btcChange24h)}</dd>
    </dl>
    <ul className="text-sm space-y-1 list-disc pl-4">{signal.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    {signal.risks.length > 0 && <p className="text-sm text-amber-800 rounded bg-amber-50 p-3">{signal.risks.join('；')}</p>}
    <details className="text-xs opacity-80">
      <summary className="cursor-pointer">分數構成與流動性</summary>
      <p className="mt-2">量能 {signal.parts.volume}/25 · 相對強度 {signal.parts.relative}/25 · 結構 {signal.parts.structure}/25 · 趨勢 {signal.parts.trend}/15 · 整理 {signal.parts.compression}/10</p>
      <p className="mt-2">24h 成交額 {(signal.turnover24h / 1_000_000).toFixed(2)} 百萬 USDT · 即時價差 {signal.spreadPct.toFixed(3)}%</p>
      <p>±1% 內前 50 檔深度：買 {(signal.depth.bid / 1000).toFixed(1)} 千／賣 {(signal.depth.ask / 1000).toFixed(1)} 千 USDT</p>
      <p>結構失效參考為最近四根低點；掛單深度不保證可成交。</p>
    </details>
    {observation && <p className="text-xs">最近研究入選：{formatTime(observation.detectedAt)} · 相對入選收盤 {formatPct((signal.price / observation.entryPrice - 1) * 100)}</p>}
    <p className="text-xs opacity-60">K 線收盤 {formatTime(signal.barTime + QUARTER_MS)} · 掃描 {formatTime(snapshot.checkedAt)}（台北）</p>
  </article>;
}

export function ObservationTable({ observations, now }: { observations: RadarObservation[]; now: number }) {
  if (!observations.length) return <p className="text-sm opacity-70">尚無入選紀錄。出現合格候選後會開始保存研究樣本。</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm text-left">
    <caption className="text-left text-xs opacity-70 pb-3">最近 100 筆；每幣入選至少間隔 24 小時，包含退榜與失敗紀錄。漲跌以入選 K 線收盤為研究基準，非實際交易報酬，未扣費用。</caption>
    <thead className="border-b border-black/20"><tr>{['幣種／入選時間（台北）', '當時階段／分數', '24h', '72h', '7 天', '期間最大漲／跌', '追蹤狀態'].map(label => <th key={label} className="py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
    <tbody>{observations.map(observation => <tr key={observation.id} className="border-b border-black/10">
      <td className="py-3 pr-4"><strong>{observation.symbol.replace(/USDT$/, '')}</strong><p className="text-xs opacity-60">{formatTime(observation.detectedAt)}</p></td>
      <td className="pr-4">{PHASE_LABELS[observation.signal.phase]}／{observation.signal.score}
        {observation.signal.bigFish?.entry && <p className="text-xs text-emerald-800">{bigFishLabel(observation.signal.bigFish)}</p>}
        {observation.signal.derivatives && <p className="text-xs opacity-70">永續：{DERIVATIVE_LABELS[observation.signal.derivatives.status]}</p>}
        <p className="text-xs opacity-60">{observation.signal.version}</p></td>
      <td className="pr-4">{formatPct(observation.returns.h24)}</td><td className="pr-4">{formatPct(observation.returns.h72)}</td><td className="pr-4">{formatPct(observation.returns.d7)}</td>
      <td className="pr-4">{observation.checkedThrough > observation.enteredAt ? `${formatPct(observation.maxRise)}／${formatPct(observation.maxFall)}` : '待追蹤'}</td>
      <td className="py-3 text-xs max-w-48">{observation.error || (observation.complete ? '七天追蹤完成' :
        now > observation.enteredAt + 8 * DAY_MS ? '資料未補齊，保留失敗樣本' : '追蹤中（輪替補算）')}
        <p className="opacity-60 mt-1">已追蹤至 {formatTime(observation.checkedThrough)}</p></td>
    </tr>)}</tbody>
  </table></div>;
}
