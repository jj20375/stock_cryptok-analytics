/** @component 波段訊號卡；有效行情才顯示價位與品質檢查，回測連結固定使用原 4h 策略。 */
import { Link } from 'react-router';
import { waveSource, waveSourceLabel } from '../../services/cryptoUniverse';
import { WAVE_INTERVAL_MS, WAVE_LABELS } from '../../services/strategy/strategies/cryptoWave';
import { SETUP_LABELS } from '../../services/waveRadar/analysis';
import { Sparkline, tradingPrice, tradingPct, tradingTime } from './components';
import type { WaveCardData } from './waveCards';

export function WaveCard({ card }: { card: WaveCardData }) {
  const { coin, snapshot, signal, healthy, active, stale, rotation, pullbackCandidate } = card;
  const a = healthy ? snapshot?.analysis : null;
  return <article className="terminal-card" data-tone={active ? 'up' : !healthy || signal?.phase === 'EXTENDED' ? 'warn' : signal?.phase === 'EXIT' ? 'down' : ''} id={`wave-${coin.symbol}`}>
    <div className="terminal-card-header"><div><h3>{coin.symbol.replace('USDT', '')}<span className="terminal-muted"> / USDT</span></h3><p className="terminal-muted">{coin.name}</p></div>
      <span className="terminal-badge">{healthy ? WAVE_LABELS[signal!.phase] : snapshot?.error ? '資料異常' : '等待更新'}</span></div>
    <p className="terminal-muted">{snapshot?.source ? waveSourceLabel(snapshot.source) : waveSource(coin.symbol)}</p>
    {healthy && (pullbackCandidate || rotation.candidate) && <div className="terminal-signal-chips">
      {pullbackCandidate && <span>{a?.pullbackStage === 'CONFIRMED' ? '回踩轉強確認' : '4H 回踩形成中'}</span>}
      {rotation.candidate && <span>BTC 強勢榜 #{rotation.rank}</span>}
    </div>}
    <p className="text-xs my-3">{snapshot?.error || (stale ? '尚無最新已收盤行情，暫不判斷上漲機會。' : signal?.reason)}</p>
    {healthy && <>
      <div className="flex justify-between items-center"><strong className="terminal-price">{tradingPrice(signal!.price)}</strong><span className={(a?.changePct ?? 0) >= 0 ? 'terminal-up' : 'terminal-down'}>{tradingPct(a?.changePct)}</span></div>
      <p className="terminal-muted">4h 收盤 USDT · 單根漲跌</p>
      <Sparkline values={a?.closes} label={`${coin.symbol} 最近 24 根 4h 收盤`} />
      <dl className="terminal-kv"><dt>突破參考</dt><dd>{tradingPrice(signal!.breakout)}</dd><dt>量能倍數</dt><dd>{signal!.volumeRatio?.toFixed(2) ?? '—'} ×</dd>
        <dt>追蹤失效參考</dt><dd>{tradingPrice(snapshot?.tracking?.stopPrice)}</dd><dt>相對 BTC（4h／24h）</dt><dd>{tradingPct(rotation.relative4h)} / {tradingPct(rotation.relative24h)}</dd></dl>
      {a?.pullbackStage && a.pullbackStage !== 'NONE' && <details className="terminal-divider"><summary className="text-xs cursor-pointer">4H 回踩{a.pullbackStage === 'CONFIRMED' ? '轉強確認' : '形成中'} · {a.pullbackChecks.filter(c => c.passed).length}/{a.pullbackChecks.length} 項</summary>
        <ul className="terminal-checks">{a.pullbackChecks.map(check => <li key={check.label} className={check.passed ? 'terminal-up' : ''}>{check.passed ? '✓' : '○'} {check.label}</li>)}</ul>
        <p className="terminal-muted mt-3">MA20 {tradingPrice(a.pullbackMa20)}；候選階段不等於進場。</p></details>}
      {a && <details className="terminal-divider"><summary className="text-xs cursor-pointer">{SETUP_LABELS[a.setup]} · {a.checks.filter(c => c.passed).length}/{a.checks.length} 項</summary>
        <ul className="terminal-checks">{a.checks.map(check => <li key={check.label} className={check.passed ? 'terminal-up' : ''}>{check.passed ? '✓' : '○'} {check.label}</li>)}</ul>
        <dl className="terminal-kv"><dt>當前停損試算</dt><dd>{tradingPrice(a.stopPrice)}</dd><dt>1R / 2R 風險倍數參考</dt><dd>{tradingPrice(a.target1R)} / {tradingPrice(a.target2R)}</dd></dl>
        <p className="terminal-muted">{a.nextStep} 品質項目並非勝率，R 倍數並非預測目標。</p></details>}
    </>}
    {signal?.barTime && <p className="terminal-muted mt-4">K 線收盤 {tradingTime(signal.barTime + WAVE_INTERVAL_MS)} · 台北</p>}
    <Link className="terminal-up inline-block text-xs mt-4" to={`/backtest?market=CRYPTO&symbol=${coin.symbol}&strategyId=crypto_wave`}>驗證 4h 波段策略 →</Link>
  </article>;
}
