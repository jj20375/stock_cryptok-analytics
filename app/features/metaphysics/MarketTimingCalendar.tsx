/** @component 市場變盤日曆：切換台股／BTC／美股，列出 31 天方向與變盤強度，點日期展開四化觸發與當日 AI 解說。 */
import { useState } from 'react';
import type { MarketCalendar } from '../../services/metaphysics/pageData.server';
import { NarrativeBox } from './NarrativeBox';
import { directionTone, shortDate, strengthStars } from './dayStyles';

export function MarketTimingCalendar({ markets }: { markets: MarketCalendar[] }) {
  const [marketIndex, setMarketIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const calendar = markets[marketIndex];
  const day = calendar.days[dayIndex];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {markets.map((m, i) => (
          <button key={m.market} onClick={() => { setMarketIndex(i); setDayIndex(0); }}
            className={`rounded border px-3 py-1 text-sm ${i === marketIndex ? 'border-current' : 'border-current/20 opacity-70'}`}>{m.label}</button>
        ))}
      </div>
      <p className="text-xs opacity-65">
        本命盤：{calendar.birthNote}{calendar.timeAssumed && '（時辰為假設）'}　·　目前大限：
        {calendar.decadal ? `${calendar.decadal.name}（虛歲 ${calendar.decadal.range[0]}–${calendar.decadal.range[1]}）` : '超出大限範圍（市場盤年齡逾 120 歲）'}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
        {calendar.days.map((d, i) => {
          const tone = directionTone(d.directionScore);
          return (
            <button key={d.tradeDate} onClick={() => setDayIndex(i)}
              className={`rounded border p-2 text-left text-xs ${tone.className} ${i === dayIndex ? 'ring-1 ring-current' : ''}`}>
              <div className="font-semibold">{shortDate(d.tradeDate)}</div>
              <div>{tone.label} {d.directionScore > 0 ? `+${d.directionScore}` : d.directionScore}</div>
              <div aria-label={`變盤強度 ${d.turningStrength}`}>{strengthStars(d.turningStrength)}</div>
            </button>
          );
        })}
      </div>
      <article className="space-y-3 rounded-xl border border-current/15 p-4">
        <h3 className="font-bold">{calendar.label} {shortDate(day.tradeDate)}：方向 {day.directionScore}、變盤強度 {day.turningStrength}</h3>
        <p className="text-xs opacity-65">流年 {day.stems.流年}・流月 {day.stems.流月}・流日 {day.stems.流日}（{day.ruleVersion}）</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{day.triggers.map((t) => <li key={t}>{t}</li>)}</ul>
        {/* AI 解說只提供「今天」，避免為未來 30 天逐日呼叫 AI。 */}
        {dayIndex === 0 && <NarrativeBox kind={`market_${calendar.market}`} />}
      </article>
    </section>
  );
}
