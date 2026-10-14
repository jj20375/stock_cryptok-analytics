/** @component 合約研究成本、方向、時間分段與訊號；模型假設隨結果顯示。 */
import { useMemo } from 'react';
import { VelaChart } from '../../home/components/VelaChart';
import type { StrategyOverlayId, StrategyOverlayLayer } from '../../home/types';
import { SIGNAL_STRATEGIES } from '../../home/signal-display';
import type { BacktestDetail, ChartKline } from '../types';
import { addStrategyLines } from '../../home/strategy-overlays';
import { IndicatorCache } from '../../../services/strategy/indicatorCache';
import { FUTURES_PHASE_LABELS, type FuturesPhase } from '../../../services/strategy/futuresRegime';

export function FuturesReport({ detail, klines }: { detail: BacktestDetail; klines: ChartKline[] }) {
  const result = detail.result?.futures;
  const data = useMemo(() => klines.map(c => ({ ...c, timestamp: c.openTime, date: new Date(c.openTime).toISOString(),
    price: c.close, currency: 'USDT', isMock: false })), [klines]);
  const layers = useMemo<StrategyOverlayLayer[]>(() => {
    if (!result) return [];
    /** 使用報告實際策略，避免新增研究候選後仍被標成原有合約趨勢。 */
    const id = detail.strategyId in SIGNAL_STRATEGIES ? detail.strategyId as StrategyOverlayId : 'futures_trend_retest';
    const display = SIGNAL_STRATEGIES[id];
    const layers: StrategyOverlayLayer[] = [{ strategyId: id, strategyName: result.strategyName ?? display.name, shortName: display.name,
      color: display.color, icon: id === 'futures_big_fish' ? 'fish' : 'trend', lines: [],
      events: result.events.map(e => ({ ...e, label: e.type === 'ENTRY' ? (e.side === 'LONG' ? '開多' : '開空') : e.type === 'EXIT' ? (e.side === 'LONG' ? '平多' : '平空') : '取消／警示',
        icon: e.type === 'ENTRY' ? '▲' : '▼', reason: `${e.reason}${e.stopLossPrice != null ? `｜失效價 ${e.stopLossPrice.toPrecision(6)}` : ''}${e.targetPrice != null ? `｜目標 ${e.targetPrice.toPrecision(6)}` : ''}` })) }];
    if (id === 'futures_big_fish') addStrategyLines(layers, klines, new IndicatorCache(klines));
    return layers;
  }, [result, detail.strategyId, klines]);
  if (!result) return null;
  const diagnostics = result.diagnostics;
  return <section className="flex flex-col gap-4">
    {detail.strategyId === 'futures_big_fish' && <p role="status" className="border rounded p-3 text-xs">合約吃大魚為1H僅做多，Pine原始OR進場／紅色出場，另加合約硬停損。沒有固定2R、6小時退出或3%保本；本報告逐倉壓力模型不等於實際全倉帳戶績效，勝率尚未證明。</p>}
    {result.backtestOnly && <p role="status" className="border rounded p-3 text-xs">研究候選・僅供歷史回測，尚未通過跨期驗證。單一區間的高勝率不能代表未來表現。</p>}
    {diagnostics && <div className="border rounded p-4 text-xs space-y-2">
      <h3 className="font-bold">訊號流程・規則版本 {result.rulesVersion}</h3>
      <p>已評估 {diagnostics.evaluatedBars} 根收盤 1H・進場訊號 {diagnostics.signals} 次・成交 {diagnostics.filled} 次・取消 {diagnostics.cancelled} 次・等待下一根 {diagnostics.pending} 次</p>
      <p>{Object.entries(diagnostics.phases).map(([phase, count]) => `${FUTURES_PHASE_LABELS[phase as FuturesPhase]} ${count} 根`).join('・')}</p>
      <details><summary className="cursor-pointer">查看未進場與取消原因</summary>
        <ul className="list-disc pl-4 mt-2">{Object.entries(diagnostics.filters).sort((a, b) => b[1] - a[1]).map(([reason, count]) => <li key={reason}>{reason}・{count} 根空手 K 線</li>)}</ul>
        <ul className="list-disc pl-4 mt-2">{Object.entries(diagnostics.rejections).map(([reason, count]) => <li key={reason}>{reason}・{count} 次候選</li>)}</ul>
      </details>
    </div>}
    <div className="border rounded p-4 text-xs space-y-2">
      <h3 className="font-bold">{result.instrument === 'BYBIT_USDT_PERP' ? 'Bybit' : 'Bitget'} USDT 永續・逐倉{result.leveragePolicy === 'CAP' ? '槓桿上限' : '固定'} {result.leverage}x・{detail.strategyId === 'futures_big_fish' ? '1H吃大魚' : '1H／4H'}</h3>
      {result.leverageUsed && <p>實際研究成交使用 {result.leverageUsed.min}–{result.leverageUsed.max}x；按停損距離選擇倍數，名目倉位不隨槓桿增加。</p>}
      <p>資金費率淨現金流：{result.totalFundingPnl.toFixed(4)} USDT（已納入淨損益）</p>
      <p>{result.liquidationModel}；級距快照 {new Date(result.tiersObservedAt).toLocaleString('zh-TW')}</p>
      {!result.sampleSufficient && <p role="status">不足 30 筆成交，樣本不足，暫不排名。</p>}
      <ul className="list-disc pl-4">{result.assumptions.map(text => <li key={text}>{text}</li>)}</ul>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-xs border"><caption className="text-left font-bold mb-2">固定參數驗證與成本壓力</caption>
      <thead><tr>{['情境', '成交', '勝率', '淨期望／筆', '最大回撤'].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
      <tbody>{[{ label: '費用／滑價雙倍', ...result.stress }, result.baseline, ...result.segments].map((row, i) => <tr key={i} className="border-t">
        <td className="p-2">{row.label}</td><td>{'totalTrades' in row ? row.totalTrades : '—'}</td><td>{'winRatePct' in row && row.totalTrades ? `${row.winRatePct}%` : '—'}</td>
        <td>{'expectancy' in row ? row.expectancy : '—'}</td><td>{'maxDrawdownPct' in row ? `${row.maxDrawdownPct}%` : '—'}</td></tr>)}</tbody>
    </table></div>
    {result.baseline.diagnostics && <p className="text-xs">原有策略對照：進場訊號 {result.baseline.diagnostics.signals} 次・成交 {result.baseline.diagnostics.filled} 次・取消 {result.baseline.diagnostics.cancelled} 次</p>}
    <div className="grid grid-cols-2 gap-2">{result.sides.map(side => <div key={side.side} className="border p-3 text-xs">
      <strong>{side.side === 'LONG' ? '多單' : '空單'}</strong>・{side.totalTrades} 筆・勝率 {side.totalTrades ? `${side.winRatePct}%` : '—'}・淨期望 {side.expectancy} USDT／筆
    </div>)}</div>
    <div className="h-[960px] min-h-[800px] border bg-white p-2">
      <VelaChart market="CRYPTO" symbol={`${detail.symbol} 永續`} timeframe="60m" data={data} strategyLayers={layers} allStrategyLayers={layers} enabledStrategyLayerIds={layers.map(layer => layer.strategyId)} />
    </div>
    <div className="border p-3 text-xs max-h-72 overflow-y-auto"><h3 className="font-bold mb-2">回測歷史訊號與風控明細</h3>
      {[...result.events].reverse().slice(0, 100).map((e, i) => <p className="border-t py-2" key={i}>{new Date(e.timestamp).toLocaleString('zh-TW')}・{e.type === 'WARNING' ? '進場取消／警示' : e.type === 'ENTRY' ? (e.side === 'LONG' ? '開多' : '開空') : (e.side === 'LONG' ? '平多' : '平空')}・{e.reason}
        {e.stopLossPrice != null && `｜失效價 ${e.stopLossPrice.toPrecision(6)}`}{e.targetPrice != null && `｜目標 ${e.targetPrice.toPrecision(6)}`}</p>)}
    </div>
  </section>;
}
