/** @component 回踩與相對強勢觀察榜；候選不等於進場訊號，也不觸發通知或下單。 */
import { tradingPct, tradingPrice } from './components';
import type { WaveCardData } from './waveCards';

export function WaveOpportunityBoard({ cards }: { cards: WaveCardData[] }) {
  const pullbacks = cards.filter(card => card.pullbackCandidate)
    .sort((a, b) => Number(b.snapshot?.analysis?.pullbackStage === 'CONFIRMED') - Number(a.snapshot?.analysis?.pullbackStage === 'CONFIRMED'));
  const rotations = cards.filter(card => card.rotation.candidate).sort((a, b) => (a.rotation.rank ?? 99) - (b.rotation.rank ?? 99));
  return <section className="terminal-opportunity-grid" aria-label="策略候選名單">
    <article className="terminal-panel"><div className="terminal-panel-heading"><h2>4H 趨勢回踩</h2><span>{pullbacks.length} 檔接近支撐</span></div>
      <p className="terminal-muted mb-4">日線多頭、MA20 上升且價格回到支撐帶；形成中仍須等待收盤轉強。</p>
      <div className="terminal-watch-list">{pullbacks.slice(0, 6).map(card => {
        const analysis = card.snapshot!.analysis!;
        return <a key={card.coin.symbol} href={`#wave-${card.coin.symbol}`}><span><strong>{card.coin.symbol.replace('USDT', '')}</strong><small>{analysis.pullbackStage === 'CONFIRMED' ? '轉強確認' : '回踩形成中'}</small></span>
          <span className={analysis.pullbackStage === 'CONFIRMED' ? 'terminal-up' : 'terminal-warn'}>{tradingPrice(analysis.pullbackMa20)}<small>MA20</small></span></a>;
      })}{!pullbacks.length && <p className="terminal-empty compact">目前沒有符合回踩支撐帶的標的。</p>}</div>
    </article>
    <article className="terminal-panel"><div className="terminal-panel-heading"><h2>相對 BTC 強勢輪動</h2><span>前 5 名觀察</span></div>
      <p className="terminal-muted mb-4">只列日線多頭，且 4h、24h 同時領先 BTC 的標的；排名不是勝率。</p>
      <div className="terminal-watch-list">{rotations.map(card => <a key={card.coin.symbol} href={`#wave-${card.coin.symbol}`}>
        <span><strong>#{card.rotation.rank} {card.coin.symbol.replace('USDT', '')}</strong><small>相對強勢分數 {card.rotation.score?.toFixed(2)}</small></span>
        <span className="terminal-up">{tradingPct(card.rotation.relative24h)}<small>24h 對 BTC</small></span></a>)}
        {!rotations.length && <p className="terminal-empty compact">目前沒有同時在 4h、24h 領先 BTC 的多頭標的。</p>}</div>
    </article>
  </section>;
}
