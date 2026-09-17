/** @component 現貨技術訊號與合約風險試算；不使用现貨價格冒充永續合約成交價。 */
import { estimateLiquidationPrice, isStopLossPastLiquidation } from '../../../services/futuresRisk';
import { Sparkline, tradingPct, tradingPrice, tradingTime } from '../../tradingDashboard/components';
import type { CoinSignal } from '../types';

export function CoinSignalCard({ coin, marginUsdt, leverage }: { coin: CoinSignal; marginUsdt: number; leverage: number }) {
  const healthy = !coin.error && coin.signal != null && coin.price != null;
  const directional = healthy && (coin.signal === 'LONG' || coin.signal === 'SHORT');
  /** 簡化逐倉模型；實際合約價差、維持保證金階梯與費用仍須由交易所核對。 */
  const liquidation = directional ? estimateLiquidationPrice({ entryPrice: coin.price!, leverage, side: coin.signal as 'LONG' | 'SHORT' }) : 0;
  const lateStop = directional && coin.stopLossPrice != null && isStopLossPastLiquidation(coin.signal as 'LONG' | 'SHORT', coin.stopLossPrice, liquidation);
  const tone = !healthy ? 'warn' : coin.signal === 'LONG' ? 'up' : coin.signal === 'SHORT' ? 'down' : '';
  return <article className="terminal-card" data-tone={tone} id={`coin-${coin.symbol}`}>
    <div className="terminal-card-header"><div><h3>{coin.symbol.replace('USDT', '')}<span className="terminal-muted"> / USDT</span></h3><p className="terminal-muted">{coin.name}</p></div>
      <span className={`terminal-badge terminal-${tone}`}>{!healthy ? '資料異常' : coin.signal === 'LONG' ? '偏多 LONG' : coin.signal === 'SHORT' ? '偏空 SHORT' : '觀望 HOLD'}</span></div>
    {!healthy ? <p className="terminal-warn">{coin.error || '等待行情資料'}</p> : <>
      <div className="flex justify-between items-center"><strong className="terminal-price">{tradingPrice(coin.price)}</strong><span className={(coin.changePct ?? 0) >= 0 ? 'terminal-up' : 'terminal-down'}>{tradingPct(coin.changePct)}</span></div>
      <p className="terminal-muted">已收盤現貨價 · 單根 K 線漲跌</p>
      <Sparkline values={coin.closes} label={`${coin.symbol} 最近 24 根已收盤行情`} />
      <p className="text-xs">{coin.reason}</p>
      <dl className="terminal-kv"><dt>現貨來源</dt><dd>{coin.source ?? '未提供'}</dd><dt>K 線起始（台北）</dt><dd>{coin.barTime ? tradingTime(coin.barTime) : '—'}</dd>
        <dt>Binance 永續資金費率</dt><dd>{coin.fundingRate == null ? '—' : `${(coin.fundingRate * 100).toFixed(4)}%`}</dd></dl>
      {directional && <details className="terminal-divider"><summary className="text-xs cursor-pointer">合約倉位試算 · {leverage} 倍</summary>
        <dl className="terminal-kv"><dt>名目倉位</dt><dd>{(marginUsdt * leverage).toFixed(2)} USDT</dd><dt>策略停損參考</dt><dd>{tradingPrice(coin.stopLossPrice)}</dd>
          <dt>簡化估算爆倉價</dt><dd>{tradingPrice(liquidation)}</dd></dl>
        {lateStop && <p className="terminal-warn text-xs">依此簡化試算，可能在策略停損前先觸及爆倉價。請重新評估槓桿。</p>}
        <p className="terminal-muted">{coin.exitHint}。以現貨價作試算參考，未計手續費、滑價與資金費率。</p>
      </details>}
    </>}
  </article>;
}
