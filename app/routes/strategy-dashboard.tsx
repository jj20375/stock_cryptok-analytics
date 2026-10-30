/**
 * @file 即時戰略 Dashboard：台股、美股、虛擬幣三個面板，各自顯示大盤羅盤與目前值得關注的標的。
 * 面板資料由 /api/strategy-dashboard 唯讀取得；本頁不提供下單、不觸發推播或任何交易。
 */
import { useEffect, useState } from 'react';
import { Link, redirect, type LoaderFunctionArgs } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { MARKET_LABELS } from '../features/strategyDashboard/format';
import { MarketPanel } from '../features/strategyDashboard/MarketPanel';
import { DASHBOARD_MARKETS, isDashboardMarket, type DashboardMarket } from '../services/strategyDashboard/types';
import { getUserId } from '../utils/auth';

export function meta() {
  return [{ title: '即時戰略 Dashboard' }];
}

/** 只檢查登入；清單資料改由面板在瀏覽器端分別讀取，切換面板時不必重新載入整頁。 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  return null;
}

/** 記住上次看的面板；localStorage 可能被瀏覽器封鎖，失敗時退回台股面板。 */
const LAST_MARKET_KEY = 'strategy-dashboard:last-market';

export default function StrategyDashboardPage() {
  const [market, setMarket] = useState<DashboardMarket>('TW');
  /**
   * 曾經開過的面板保持掛載（隱藏而不卸載），切回時保留資料、篩選與 K 線抽屜狀態。
   * 初始為空集合：等讀完 localStorage 才掛載第一個面板，避免先多抓一次台股再跳到上次的面板。
   */
  const [visited, setVisited] = useState<Set<DashboardMarket>>(() => new Set());
  useEffect(() => {
    let initial: DashboardMarket = 'TW';
    try {
      const stored = window.localStorage.getItem(LAST_MARKET_KEY);
      if (isDashboardMarket(stored)) initial = stored;
    } catch { /** 無法讀取時維持預設面板。 */ }
    setMarket(initial);
    setVisited(new Set([initial]));
  }, []);
  const select = (next: DashboardMarket) => {
    setMarket(next);
    setVisited(previous => new Set(previous).add(next));
    try { window.localStorage.setItem(LAST_MARKET_KEY, next); } catch { /** 無法儲存只影響下次預設面板。 */ }
  };

  return <AppLayout><div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="mb-2 text-xs tracking-widest opacity-60">STRATEGY DASHBOARD</p>
        <h1 className="text-3xl font-bold">即時戰略 Dashboard</h1>
        <p className="mt-2 text-sm opacity-75">依市場切換：上方看大盤環境，下方列出既有雷達挑出的候選標的、進場區間與停損參考。</p>
      </div>
      <Link
        to="/meme-desk"
        className="rounded-lg border border-black/20 bg-white/80 px-4 py-2 text-xs font-semibold hover:bg-black/5"
      >
        🛡️ Solana 14 關防 Rug 戰情室 →
      </Link>
    </header>
    <nav role="tablist" aria-label="市場面板" className="flex gap-2">
      {DASHBOARD_MARKETS.map(item => <button key={item} type="button" role="tab" aria-selected={market === item}
        aria-controls={`panel-${item}`} onClick={() => select(item)}
        className={`rounded-full border px-5 py-2 text-sm font-semibold ${market === item ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200' : 'border-black/20 bg-white/60'}`}>
        {MARKET_LABELS[item]}</button>)}
    </nav>
    {DASHBOARD_MARKETS.filter(item => visited.has(item)).map(item =>
      <div key={item} id={`panel-${item}`} role="tabpanel" hidden={market !== item}>
        <MarketPanel market={item} active={market === item} />
      </div>)}
  </div></AppLayout>;
}
