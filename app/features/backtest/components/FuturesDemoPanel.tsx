/** @component 手動 Demo 預覽與明確操作；從不自動送單，也沒有正式盤選項。 */
import { useEffect, useState } from 'react';
import { NumericInput } from '../../../components/NumericInput';
import { FUTURES_AUTO_STRATEGIES, FUTURES_PREVIEW_SYMBOLS } from '../../../services/cryptoFutures/automation';
import { numericFieldError } from '../../../utils/numericInput';
import type { futuresSnapshot } from '../../../services/cryptoFutures/snapshot.server';

type Preview = Awaited<ReturnType<typeof futuresSnapshot>> & { entriesEnabled: boolean };
export function FuturesDemoPanel() {
  const [symbol, setSymbol] = useState('BTCUSDT'), [strategyId, setStrategyId] = useState('futures_trend_retest');
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false), [feePct, setFeePct] = useState(0.06);
  const [cooldown, setCooldown] = useState(false);
  const invalidFee = !!numericFieldError(feePct, { min: 0, max: 1, step: 0.001 });
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function submit(action: 'preview' | 'execute' | 'close') {
    if (invalidFee) return;
    setBusy(true); setCooldown(true); setMessage('');
    try {
      const response = await fetch('/api/crypto-futures', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, symbol, strategyId, signalAt: preview?.signalAt, feeRate: feePct / 100 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失敗');
      if (action === 'preview') { setPreview(data); setConfirm(false); }
      else {
        const status: Record<string, string> = { SUBMITTED: '委託已接受', FILLED: '已成交', PARTIALLY_FILLED: '部分成交', FAILED: '操作未完成', UNKNOWN: '結果未知，等待對帳', REJECTED: '風控拒絕', IGNORED: '未送單' };
        setMessage(`${status[data.status] ?? '請查看委託紀錄'}・${data.reason ?? ''}。委託接受後仍需成交對帳。`); setPreview(null); setConfirm(false);
      }
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="border rounded p-4 text-sm space-y-3">
    <h2 className="font-bold">Bitget Demo・獨立最新收盤預覽</h2>
    <p className="text-xs">此區以自己的商品與策略預覽 BTC／ETH／SOL／ADA 的1H訊號；下方歷史回測使用回測設定與報告中的商品、策略、期間。</p>
    <div className="flex flex-wrap gap-3">
      <label>商品 <select value={symbol} disabled={busy} onChange={e => { setSymbol(e.target.value); setPreview(null); }} className="border p-2">{FUTURES_PREVIEW_SYMBOLS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>策略 <select value={strategyId} disabled={busy} onChange={e => { setStrategyId(e.target.value); setPreview(null); }} className="border p-2">{FUTURES_AUTO_STRATEGIES.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label>帳戶單邊費率 % <NumericInput label="帳戶單邊費率 %" min="0" max="1" step="0.001" value={feePct} onValueChange={setFeePct} className="border p-2 w-24" /></label>
      <button className="border rounded px-3 disabled:opacity-40" disabled={busy || cooldown || invalidFee} onClick={() => submit('preview')}>{busy ? '處理中…' : cooldown ? '操作間隔十秒' : '重新預覽'}</button>
    </div>
    {strategyId === 'futures_big_fish' && <p className="text-xs text-amber-300">此版為1H、僅做多；沿用ATR10／Supertrend4／MACD12/26/9，另加5%硬停損，沒有3%保本。截圖15分鐘的結果不能直接套用，勝率尚待驗證。</p>}
    <p className="text-xs">Demo 使用策略預設參數，槓桿與風控使用帳戶設定。只在你明確按鈕操作時呼叫 Demo；新倉依系統政策與帳戶授權，已有部位可平倉。</p>
    {preview && <div className="space-y-2 text-xs">
      <p>{preview.state.reason}・收盤 {new Date(preview.signalAt).toLocaleString('zh-TW')}・成交價 {preview.metadata.price}・標記價 {preview.metadata.markPrice}</p>
      <p>資金費率 {(preview.metadata.fundingRate * 100).toFixed(4)}%／{preview.metadata.fundingInterval} 小時・下次結算 {new Date(preview.metadata.nextFundingTime).toLocaleString('zh-TW')}</p>
      <p>{preview.action.type === 'HOLD' ? '尚無確認訊號' : preview.action.reason}</p>
      {preview.quote && <p>預估數量 {preview.quote.quantity} {preview.symbol.slice(0, -4)}・名目 {preview.quote.notionalUsdt.toFixed(2)} USDT・逐倉 {preview.quote.leverage}x（上限 {preview.quote.leverageCap}x）保證金 {preview.quote.marginUsdt.toFixed(2)} USDT・計畫風險 {preview.quote.riskUsdt.toFixed(2)} USDT・停損 {preview.quote.stopLossPrice.toPrecision(6)}・目標 {preview.quote.targetPrice?.toPrecision(6) ?? '—'}・模型強平 {preview.quote.liquidationPrice?.toPrecision(6) ?? '未驗證'}</p>}
      {(preview.quoteError || preview.quote?.blockedReason) && <p>{preview.quoteError || preview.quote?.blockedReason}</p>}
      {!preview.entriesEnabled && <p>新倉目前停用，研究功能可使用。</p>}
      <label className="flex gap-2"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />我確認這是 Bitget Demo 委託，使用目前預覽的策略與方向</label>
      {preview.action.type === 'ENTRY' && <button disabled={busy || cooldown || !confirm || !preview.entriesEnabled || !preview.quote || !!preview.quoteError || !!preview.quote.blockedReason} className="border rounded p-2 disabled:opacity-40" onClick={() => submit('execute')}>Demo {preview.action.side === 'LONG' ? '開多' : '開空'}</button>}
      {preview.position && <button disabled={busy || cooldown || !confirm} className="border rounded p-2 disabled:opacity-40" onClick={() => submit('close')}>Demo {preview.position.side === 'LONG' ? '平多' : '平空'}</button>}
    </div>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
