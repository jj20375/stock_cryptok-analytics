/** @component 我的八字：命局與投資性格、大運流年、31 天流日吉凶（疊加所選市場的變盤強度與提示）。 */
import { useState } from 'react';
import type { BirthInput } from '../../services/metaphysics/baziProfile';
import { combinedHint } from '../../services/metaphysics/combinedHint';
import type { BaziView, MarketCalendar } from '../../services/metaphysics/pageData.server';
import { BirthProfileForm } from './BirthProfileForm';
import { NarrativeBox } from './NarrativeBox';
import { GRADE_CLASS, shortDate, strengthStars } from './dayStyles';

interface Props { bazi: BaziView | null; birth: BirthInput | null; markets: MarketCalendar[] }

export function MyBaziPanel({ bazi, birth, markets }: Props) {
  const [marketIndex, setMarketIndex] = useState(0);
  if (!bazi) {
    return (
      <section className="space-y-4 rounded-xl border border-current/15 p-5">
        <h2 className="text-lg font-bold">填寫生辰，查看你的八字運勢</h2>
        {birth && <p className="text-sm text-rose-300">已保存的生辰無法排盤，請重新填寫。</p>}
        <BirthProfileForm birth={birth} />
      </section>
    );
  }
  const { profile } = bazi;
  const market = markets[marketIndex];
  const strengthByDate = new Map(market.days.map((d) => [d.tradeDate, d.turningStrength]));
  const pillars = [['年', profile.pillars.year], ['月', profile.pillars.month], ['日', profile.pillars.day], ['時', profile.pillars.hour]] as const;
  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <article className="space-y-2 rounded-xl border border-current/15 p-4">
          <h3 className="font-bold">命局與投資性格</h3>
          <p className="text-lg tracking-widest">{pillars.map(([name, p]) => `${name}:${p ? p.stem + p.branch : '—'}`).join('　')}</p>
          <p className="text-sm">日主 {profile.dayElement}・{profile.strength}（{profile.strengthScore} 分）・喜 {profile.favorableGroups.join('、')}{profile.unfavorableGroups.length > 0 && `・忌 ${profile.unfavorableGroups.join('、')}`}</p>
          <p className="text-sm">性格：{profile.labels.join('、')}</p>
          {profile.hourUnknown && <p className="text-xs text-amber-200">時辰不明，只排三柱；補填時辰可得完整分析。</p>}
          {profile.dstCorrected && <p className="text-xs opacity-65">已依台灣舊時制把出生時間減 1 小時。</p>}
          <p className="text-xs opacity-50">喜用神為扶抑法簡化版，不處理從格與調候。</p>
          <NarrativeBox kind="bazi_profile" />
        </article>
        <article className="space-y-2 rounded-xl border border-current/15 p-4">
          <h3 className="font-bold">大運與流年</h3>
          <p className="text-sm">目前大運：{bazi.daYun ? `${bazi.daYun.ganZhi}（${bazi.daYun.startYear}–${bazi.daYun.endYear}）・${bazi.daYun.luck.grade3}` : '尚未起運'}</p>
          <p className="text-sm">今年流年：{bazi.yearLuck.pillar.stem}{bazi.yearLuck.pillar.branch}・{bazi.yearLuck.grade5}{bazi.yearLuck.flags.length > 0 && `（${bazi.yearLuck.flags.join('、')}）`}</p>
          <p className="text-sm">本月流月：{bazi.monthLuck.pillar.stem}{bazi.monthLuck.pillar.branch}・{bazi.monthLuck.grade5}</p>
          <NarrativeBox kind="bazi_daily" />
        </article>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">疊加市場：
        {markets.map((m, i) => (
          <button key={m.market} onClick={() => setMarketIndex(i)}
            className={`rounded border px-2 py-0.5 ${i === marketIndex ? 'border-current' : 'border-current/20 opacity-70'}`}>{m.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {bazi.days.map((d) => {
          // 個人以台北日期、市場以當地日期；同一天字串比對即可（美股日期可能落後一天，查不到時強度視為 0）。
          const strength = strengthByDate.get(d.date) ?? 0;
          const hint = combinedHint(strength, d.grade5);
          return (
            <div key={d.date} className="rounded border border-current/15 p-2 text-xs">
              <div className="font-semibold">{shortDate(d.date)}</div>
              <div className={GRADE_CLASS[d.grade5]}>{d.grade5}{d.flags.length > 0 && ` ${d.flags.join('/')}`}</div>
              <div>{market.label} {strengthStars(strength)}</div>
              <div className="opacity-80">{hint.tone}</div>
            </div>
          );
        })}
      </div>
      <details className="rounded-xl border border-current/15 p-4">
        <summary className="cursor-pointer text-sm">修改或刪除生辰</summary>
        <div className="mt-3"><BirthProfileForm birth={birth} /></div>
      </details>
    </section>
  );
}
