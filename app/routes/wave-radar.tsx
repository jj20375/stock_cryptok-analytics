/** @component 波段雷達終端；每分鐘重讀快照，不觸發市場掃描、通知或下單。 */
import { useEffect, useState } from 'react';
import { redirect, useLoaderData, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { count, isNull } from 'drizzle-orm';
import { AppLayout } from '../components/AppLayout';
import { getUserId } from '../utils/auth';
import { waveNotifications, waveRadar } from '../db/waveSchema';
import { WAVE_LABELS } from '../services/strategy/strategies/cryptoWave';
import { TerminalNav, TerminalStat, SignalDistribution } from '../features/tradingDashboard/components';
import { ResearchPanel } from '../features/tradingDashboard/ResearchPanel';
import { WaveCard } from '../features/tradingDashboard/WaveCard';
import { buildWaveCards } from '../features/tradingDashboard/waveCards';
import { WaveOpportunityBoard } from '../features/tradingDashboard/WaveOpportunityBoard';

/** 登入才可查看全站共享行情；重新整理只讀資料庫，不觸發通知或下單。 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  const db = drizzle(env.DB);
  const settings = { enabled: env.WAVE_RADAR_ENABLED === 'true', slack: !!(env.SLACK_API_TOKEN && env.CRYPTO_ENTRY_SLACK_CHANNEL_ID) };
  try {
    const rows = await db.select().from(waveRadar);
    const [pending] = await db.select({ total: count() }).from(waveNotifications).where(isNull(waveNotifications.sentAt));
    return { ...settings, rows, pending: pending.total, error: null, now: Date.now() };
  } catch {
    return { ...settings, rows: [], pending: 0, error: '監控資料尚未就緒，請先套用資料庫更新並檢查連線。', now: Date.now() };
  }
}

export default function WaveRadarPage() {
  const data = useLoaderData<typeof loader>();
  const { state, revalidate } = useRevalidator();
  /** 篩選僅改變呈現，所有摘要仍以完整觀察清單計算。 */
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  useEffect(() => { const timer = setInterval(revalidate, 60_000); return () => clearInterval(timer); }, [revalidate]);
  const cards = buildWaveCards(data.rows, data.now);
  const active = cards.filter(c => c.active).length;
  const watching = cards.filter(c => c.healthy && c.signal?.phase === 'WATCH').length;
  const pullbacks = cards.filter(c => c.pullbackCandidate).length;
  const rotations = cards.filter(c => c.rotation.candidate).length;
  const healthy = cards.filter(c => c.healthy).length;
  const visible = cards.filter(c => (filter === 'ALL' || (filter === 'ACTIVE' ? c.active : filter === 'PULLBACK' ? c.pullbackCandidate :
    filter === 'ROTATION' ? c.rotation.candidate : filter === 'STALE' ? !c.healthy : c.healthy && c.signal?.phase === filter)) &&
    `${c.coin.symbol} ${c.coin.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <AppLayout><div className="trading-dashboard">
    <header className="terminal-header"><div><p className="terminal-eyebrow">SWING OPPORTUNITIES / 02</p><h1>波段雷達</h1><p className="terminal-subtitle">日線辨方向，4 小時找結構。從觀察名單到可驗證的交易論點。</p></div>
      <button className="terminal-button" disabled={state !== 'idle'} onClick={() => revalidate()}>{state === 'idle' ? '更新畫面' : '更新中…'}</button></header>
    <TerminalNav current="wave-radar" />
    <section className="terminal-stats" aria-label="波段摘要">
      <TerminalStat label="正式策略訊號" value={active} note="突破、守穩或已啟用的回踩進場" tone="terminal-up" />
      <TerminalStat label="回踩候選" value={pullbacks} note="MA20 支撐形成中或轉強確認" tone="terminal-warn" />
      <TerminalStat label="相對強勢輪動" value={rotations} note="4h、24h 同時領先 BTC 的前五名" />
      <TerminalStat label="行情覆蓋" value={`${healthy} / ${cards.length}`} note={`${cards.length - healthy} 檔等待更新或資料異常`} tone="terminal-warn" />
      <TerminalStat label="Slack 待發事件" value={data.pending} note={data.slack ? '已設定通知；待發不代表已送達' : '尚未設定通知'} />
    </section>
    {data.error && <p role="alert" className="terminal-status error mb-4">{data.error}</p>}
    <div className="terminal-grid"><section className="terminal-panel"><div className="terminal-panel-heading"><h2>全市場觀察矩陣</h2><span>{data.enabled ? '每 15 分鐘分批掃描' : '排程尚未啟用'}</span></div>
      <div className="terminal-heatmap">{cards.map(c => <a key={c.coin.symbol} className="terminal-tile" href={`#wave-${c.coin.symbol}`} onClick={() => { setFilter('ALL'); setSearch(''); }}
        data-tone={!c.healthy ? 'warn' : c.active ? 'up' : c.signal?.phase === 'EXIT' ? 'down' : ''}><strong>{c.coin.symbol.replace('USDT', '')}</strong><span>{c.healthy ? WAVE_LABELS[c.signal!.phase] : '待更新'}</span></a>)}</div></section>
      <section className="terminal-panel"><div className="terminal-panel-heading"><h2>監控品質</h2><span>有效資料優先</span></div><SignalDistribution segments={[
        { label: '正式策略訊號', count: active, color: '#75e3ba' }, { label: '突破候選', count: watching, color: '#81aaff' },
        { label: '其他有效狀態', count: healthy - active - watching, color: '#738cad' }, { label: '待更新／異常', count: cards.length - healthy, color: '#f3c578' },
      ]} /><div className="terminal-divider"><h3 className="text-sm mb-2">通知包含哪些分析？</h3><p className="terminal-muted">突破放量、回測守穩與趨勢回踩，加上日線方向、收盤強度、ATR 距離及流動性檢查。每則附失效條件與風險試算；新分析尚無已驗證勝率。</p></div></section></div>
    <WaveOpportunityBoard cards={cards} />
    <ResearchPanel />
    <div className="terminal-toolbar"><label className="terminal-muted">搜尋幣種 <input className="terminal-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="BTC、SOL…" /></label>
      <label className="terminal-muted">篩選 <select className="terminal-input" value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">全部狀態</option><option value="ACTIVE">突破／守穩</option><option value="PULLBACK">4H 回踩候選</option><option value="ROTATION">相對 BTC 強勢</option><option value="WATCH">突破候選觀察</option><option value="EXTENDED">延伸不追</option><option value="STALE">待更新／異常</option></select></label></div>
    <div className="terminal-cards">{visible.map(card => <div key={card.coin.symbol}><WaveCard card={card} /></div>)}{!visible.length && <p className="terminal-empty">目前沒有符合條件的觀察標的。</p>}</div>
    <p className="terminal-footer">現貨做多研究，網站回測預設下一根開盤成交、單筆風險 1%、單幣部位上限 25%。各幣獨立回測不能相加當成投資組合報酬。翻倍是驗證目標而非保證；本頁不自動下單。</p>
  </div></AppLayout>;
}
