/** @file 玄學羅盤頁面：紫微市場變盤日曆、我的八字、命中率。玄學參考，不影響任何量化訊號與交易。 */
import { useState } from 'react';
import { useActionData, useLoaderData } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { HitRatePanel } from '../features/metaphysics/HitRatePanel';
import { MarketTimingCalendar } from '../features/metaphysics/MarketTimingCalendar';
import { MetaphysicsDisclaimer } from '../features/metaphysics/MetaphysicsDisclaimer';
import { MyBaziPanel } from '../features/metaphysics/MyBaziPanel';
import { loadMetaphysicsPage, metaphysicsAction } from '../services/metaphysics/pageData.server';

export const loader = loadMetaphysicsPage;
export const action = metaphysicsAction;

const TABS = ['市場變盤日曆', '我的八字', '命中率'] as const;

export default function MetaphysicsPage() {
  const { markets, bazi, birth, taipeiToday } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // 剛送出生辰表單時直接停在「我的八字」，讓使用者看到結果。
  const [tab, setTab] = useState<(typeof TABS)[number]>(actionData ? '我的八字' : '市場變盤日曆');
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header>
          <p className="mb-2 text-xs tracking-widest opacity-60">ZI WEI · BA ZI · {taipeiToday}</p>
          <h1 className="text-3xl font-bold">玄學羅盤</h1>
        </header>
        <MetaphysicsDisclaimer />
        {actionData && (
          <p role="status" className={`rounded border p-3 text-sm ${actionData.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-rose-500/40 text-rose-300'}`}>
            {actionData.ok ? actionData.message : actionData.error}
          </p>
        )}
        <nav className="flex gap-2 border-b border-current/15">
          {TABS.map((name) => (
            <button key={name} onClick={() => setTab(name)}
              className={`px-3 py-2 text-sm ${tab === name ? 'border-b-2 border-current font-bold' : 'opacity-60'}`}>{name}</button>
          ))}
        </nav>
        {tab === '市場變盤日曆' && <MarketTimingCalendar markets={markets} />}
        {tab === '我的八字' && <MyBaziPanel bazi={bazi} birth={birth} markets={markets} />}
        {tab === '命中率' && <HitRatePanel markets={markets} />}
      </div>
    </AppLayout>
  );
}
