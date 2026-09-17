/** @file 交易終端共用圖表與導覽；所有圖形由真實傳入資料衍生，空值不補造行情。 */
import { Link } from 'react-router';

export const tradingPct = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
export const tradingPrice = (n: number | null | undefined) => n == null || !Number.isFinite(n) || n <= 0 ? '—' : n.toLocaleString('en-US', { maximumSignificantDigits: 7 });
export const tradingTime = (value: number | string) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

export function TerminalNav({ current }: { current: 'warroom' | 'wave-radar' }) {
  return <nav className="terminal-nav" aria-label="交易分析頁面">
    <Link to="/warroom" aria-current={current === 'warroom' ? 'page' : undefined}>戰情室</Link>
    <Link to="/wave-radar" aria-current={current === 'wave-radar' ? 'page' : undefined}>波段雷達</Link>
    <Link to="/potential-radar">15 分潛力幣</Link>
  </nav>;
}

export function TerminalStat({ label, value, note, tone = '' }: { label: string; value: string | number; note: string; tone?: string }) {
  return <div className="terminal-stat"><div className="terminal-stat-label">{label}</div>
    <div className={`terminal-stat-value ${tone}`}>{value}</div><p className="terminal-stat-note">{note}</p></div>;
}

export function Sparkline({ values, label }: { values?: number[]; label: string }) {
  if (!values || values.length < 2 || !values.every(n => Number.isFinite(n) && n > 0)) return <p className="terminal-muted my-4">走勢資料等待更新</p>;
  const low = Math.min(...values);
  const range = Math.max(...values) - low;
  const points = values.map((n, i) => `${i / (values.length - 1) * 300},${range > 0 ? 55 - (n - low) / range * 45 : 32}`).join(' ');
  const color = values.at(-1)! >= values[0] ? '#75e3ba' : '#ff91a5';
  return <svg viewBox="0 0 300 64" className="terminal-spark" role="img" aria-label={label} preserveAspectRatio="none">
    <line x1="0" y1="58" x2="300" y2="58" stroke="#26364b" strokeDasharray="4 5" />
    <polygon points={`0,64 ${points} 300,64`} fill={color} opacity=".06" />
    <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export function SignalDistribution({ segments }: { segments: { label: string; count: number; color: string }[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  let end = 0;
  const colors = segments.map(segment => {
    const start = end;
    end += total ? segment.count / total * 360 : 0;
    return `${segment.color} ${start}deg ${end}deg`;
  });
  return <div className="terminal-distribution">
    <div className="terminal-donut" style={{ background: total ? `conic-gradient(${colors.join(',')})` : '#243145' }} aria-hidden="true">
      <div className="terminal-donut-center">{total}<span>監控標的</span></div></div>
    <ul className="terminal-legend" aria-label="訊號數量分布">{segments.map(segment => <li key={segment.label}>
      <span><i className="terminal-dot" style={{ color: segment.color }} />{segment.label}</span><strong>{segment.count}</strong></li>)}</ul>
  </div>;
}
