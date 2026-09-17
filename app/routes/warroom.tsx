/** @component 戰情室整合行情、訊號與獨立模擬研究；登入後只讀，不觸發交易。 */
import { useState } from 'react';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { getUserId } from '../utils/auth';
import { useWarRoom } from '../features/warroom/useWarRoom';
import { CoinSignalCard } from '../features/warroom/components/CoinSignalCard';
import { TerminalNav, TerminalStat, SignalDistribution, tradingPct, tradingTime } from '../features/tradingDashboard/components';
import { ResearchPanel } from '../features/tradingDashboard/ResearchPanel';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (!await getUserId(request, (context as any).cloudflare.env)) throw redirect('/login');
  return null;
}
const RISK_LABELS: Record<string, string> = { LOW: '風險偏低', MEDIUM: '風險中等', HIGH: '風險偏高', CRASH: '熔斷警戒' };

export default function WarRoomPage() {
  /** 週期會重新查詢，金額與槓桿只影響本機試算，不會送出訂單。 */
  const [interval, setInterval] = useState('4h');
  const [marginUsdt, setMarginUsdt] = useState(100);
  const [leverage, setLeverage] = useState(3);
  const [filter, setFilter] = useState('ALL');
  const { data, loading, error, refresh } = useWarRoom(interval);
  const coins = data?.coins ?? [];
  const healthy = coins.filter(coin => !coin.error && coin.signal != null);
  const longs = healthy.filter(c => c.signal === 'LONG').length;
  const shorts = healthy.filter(c => c.signal === 'SHORT').length;
  const unavailable = coins.length - healthy.length;
  const sorted = [...coins].filter(c => filter === 'ALL' || c.signal === filter).sort((a, b) =>
    Number(!!a.error) - Number(!!b.error) || Number(a.signal === 'HOLD') - Number(b.signal === 'HOLD'));
  return <AppLayout><div className="trading-dashboard">
    <header className="terminal-header"><div><p className="terminal-eyebrow">MARKET INTELLIGENCE / 01</p><h1>戰情室</h1><p className="terminal-subtitle">掌握市場方向，讓訊號、風險與研究結果同時可見。</p></div>
      <div className="flex items-center gap-3"><span className={`terminal-status ${error ? 'error' : 'warn'}`}>{error ? '行情讀取異常' : loading ? '行情更新中' : '觀察模式'}</span>
        <button className="terminal-button" disabled={loading} onClick={refresh}>更新行情</button></div></header>
    <TerminalNav current="warroom" />
    <section className="terminal-stats" aria-label="行情摘要">
      <TerminalStat label="BTC 大盤風險" value={data ? RISK_LABELS[data.marketRegime.riskLevel] : '—'} note={data?.marketRegime.reason ?? '等待行情評估'} tone="terminal-warn" />
      <TerminalStat label="偏多訊號" value={data ? longs : '—'} note="現貨技術指標參考" tone="terminal-up" />
      <TerminalStat label="偏空訊號" value={data ? shorts : '—'} note="方向參考，無自動下單" tone="terminal-down" />
      <TerminalStat label="有效行情" value={data ? `${healthy.length} / ${coins.length}` : '—'} note={data ? `更新 ${tradingTime(data.updatedAt)} · 台北` : '每 60 秒更新'} />
    </section>
    {error && <p role="alert" className="terminal-status error mb-4">{error}</p>}
    <div className="terminal-grid">
      <section className="terminal-panel"><div className="terminal-panel-heading"><h2>市場熱區</h2><span>{interval} 單根已收盤漲跌</span></div><div className="terminal-heatmap">
        {coins.map(c => <a key={c.symbol} href={`#coin-${c.symbol}`} className="terminal-tile" data-tone={c.error ? 'warn' : (c.changePct ?? 0) >= 0 ? 'up' : 'down'} onClick={() => setFilter('ALL')}><strong>{c.symbol.replace('USDT', '')}</strong><span>{c.error ? '待更新' : tradingPct(c.changePct)}</span></a>)}
        {!coins.length && <p className="terminal-empty">{loading ? '行情載入中…' : '暫無可用行情'}</p>}
      </div></section>
      <section className="terminal-panel"><div className="terminal-panel-heading"><h2>訊號分布</h2><span>Supertrend 動能</span></div><SignalDistribution segments={[
        { label: '偏多', count: longs, color: '#75e3ba' }, { label: '偏空', count: shorts, color: '#ff91a5' },
        { label: '觀望', count: healthy.length - longs - shorts, color: '#738cad' }, { label: '資料異常', count: unavailable, color: '#f3c578' },
      ]} /></section>
    </div>
    <ResearchPanel />
    <div className="terminal-toolbar"><div className="flex flex-wrap gap-3">
      <label className="terminal-muted">K 線週期 <select className="terminal-input" value={interval} onChange={e => setInterval(e.target.value)}>{['1h', '4h', '1d'].map(v => <option key={v}>{v}</option>)}</select></label>
      <label className="terminal-muted">訊號 <select className="terminal-input" value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">全部</option><option value="LONG">偏多</option><option value="SHORT">偏空</option><option value="HOLD">觀望</option></select></label>
    </div><div className="flex flex-wrap gap-3"><label className="terminal-muted">試算保證金 USDT <input className="terminal-input w-24" type="number" min="1" max="1000000" value={marginUsdt} onChange={e => setMarginUsdt(Math.min(1_000_000, Math.max(1, Number(e.target.value) || 1)))} /></label>
      <label className="terminal-muted">槓桿 <input className="terminal-input w-20" type="number" min="1" max="125" value={leverage} onChange={e => setLeverage(Math.min(125, Math.max(1, Number(e.target.value) || 1)))} /></label></div></div>
    <div className="terminal-cards">{sorted.map(coin => <div key={coin.symbol}><CoinSignalCard coin={coin} marginUsdt={marginUsdt} leverage={leverage} /></div>)}
      {!sorted.length && <p className="terminal-empty">{loading ? '正在載入訊號…' : '目前沒有符合條件的標的'}</p>}</div>
    <p className="terminal-footer">訊號來自已收盤現貨行情，資金費率另取 Binance 永續。合約爆倉價是簡化逐倉試算，實際金額以交易所為準。策略尚須歷史及樣本外驗證，本頁不執行下單。</p>
  </div></AppLayout>;
}
