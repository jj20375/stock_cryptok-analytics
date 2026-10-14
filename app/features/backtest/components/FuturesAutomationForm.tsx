/** @component Demo／LIVE 各自確認，名目上限不乘槓桿；儲存啟用會使後端依訊號自動交易。 */
import { useState } from 'react';
import { NumericInput } from '../../../components/NumericInput';
import { AUTO_UNIVERSE_ALL, FUTURES_AUTO_STRATEGIES, type AutomationInput, type AutomationStatus } from '../../../services/cryptoFutures/automation';
import type { useFuturesAutomation } from '../useFuturesAutomation';
const inputClass = 'w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100';
export function FuturesAutomationForm({ status, automation }: { status: AutomationStatus; automation: ReturnType<typeof useFuturesAutomation> }) {
  const [mode, setMode] = useState(status.config.executionMode), [confirmed, setConfirmed] = useState(false);
  const [testMode, setTestMode] = useState(status.config.testMode);
  /** 全市場模式不填商品，由後端每輪依 Bitget 成交額門檻產生清單。 */
  const [universe, setUniverse] = useState(status.config.universe);
  const live = mode === 'LIVE', policy = status.policies[mode];
  const read = (element: HTMLFormElement): AutomationInput => {
    const form = new FormData(element);
    return { enabled: form.get('enabled') === 'on', executionMode: mode, testMode, maxNotionalUsdt: Number(form.get('maxNotionalUsdt') ?? status.config.maxNotionalUsdt),
      positionPct: Number(form.get('positionPct')), maxOpenPositions: Number(form.get('maxOpenPositions')),
      universe, symbols: universe === 'ALL' ? AUTO_UNIVERSE_ALL : String(form.get('symbols')), strategyId: String(form.get('strategyId')), feePct: Number(form.get('feePct')) };
  };
  return <form onSubmit={event => { event.preventDefault(); automation.save(read(event.currentTarget), confirmed); }} className="space-y-3">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label>交易環境<select name="executionMode" value={mode} onChange={event => { setMode(event.target.value as AutomationInput['executionMode']); setConfirmed(false); }} className={inputClass}>
        <option value="DEMO">Demo 模擬資金</option><option value="LIVE">LIVE 正式合約・真實資金</option></select></label>
      <label>交易額度<select name="testMode" value={testMode ? 'test' : 'account'} onChange={event => { setTestMode(event.target.value === 'test'); setConfirmed(false); }} className={inputClass}>
        <option value="test">測試單・名目最高 30 USDT</option><option value="account">依帳戶本金配置・無固定 30U 限制</option></select></label>
      <label>單筆倉位上限（本金 %）<NumericInput name="positionPct" label="單筆倉位本金百分比" min="3" max="5" step="0.1" defaultValue={status.config.positionPct} className={inputClass} />
        <small className="text-slate-400">3～5%；以槓桿後名目部位計，停損風控可能再縮小。</small></label>
      <label>同時持倉上限<NumericInput name="maxOpenPositions" label="自動化同時持倉上限" min="1" max="3" step="1" defaultValue={status.config.maxOpenPositions} className={inputClass} />
        <small className="text-slate-400">最多 3 筆；待成交與結果未知也占用名額。</small></label>
      {testMode && <label>測試單名目上限（USDT）<NumericInput name="maxNotionalUsdt" label="測試單名目上限" min="5" max="30" step="0.01" defaultValue={status.config.maxNotionalUsdt} className={inputClass} />
        <small className="text-slate-400">5～30 USDT，僅限測試模式；槓桿不乘到測試額度。</small></label>}
      <label>合約範圍<select name="universe" value={universe} onChange={event => { setUniverse(event.target.value as AutomationInput['universe']); setConfirmed(false); }} className={inputClass}>
        <option value="LIST">指定商品（最多五個）</option><option value="ALL">全部 Bitget USDT 永續</option></select>
        <small className="text-slate-400">全市場：24H 成交額 ≥ 1,000 萬 USDT 的合約，含股票、黃金等 RWA；清單每小時隨成交額更新。</small></label>
      {universe === 'LIST' && <label>合約商品<input name="symbols" defaultValue={status.config.universe === 'LIST' ? status.config.symbols : 'BTCUSDT, ETHUSDT'} maxLength={150} required className={inputClass} />
        <small className="text-slate-400">最多五個 USDT 合約，例如 BTCUSDT, ETHUSDT, ADAUSDT。</small></label>}
      <label>帳戶單邊費率 %<NumericInput name="feePct" label="自動化帳戶單邊費率" min="0" max="1" step="0.001" defaultValue={status.config.feePct} className={inputClass} /></label>
    </div>
    <label className="block">自動化策略<select name="strategyId" defaultValue={status.config.strategyId} className={inputClass}>
      {FUTURES_AUTO_STRATEGIES.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select>
      <small className="text-slate-400">固定使用策略預設參數；吃大魚為1H且僅做多，含5%硬停損、沒有3%保本；RSI2 研究候選仍僅供回測。</small></label>
    {live && <p className="rounded border border-rose-700 bg-rose-950/40 p-3 text-rose-200">LIVE 會建立真實合約委託。須在設定頁填妥「正式合約專用憑證」、選擇 LIVE 並開啟實戰授權；一般 Bitget API 欄位不會自動搬入此功能。</p>}
    <p className="text-xs text-slate-300">{mode} API：{(live ? status.hasLive : status.hasDemo) ? '已綁定' : '尚未綁定'}・執行器：{policy.enabled ? '已開放' : '尚未開放'}{live ? `・本人實戰設定：${status.liveAuthorized ? '已開放' : '尚未開放'}` : ''}</p>
    {policy.reason && <p role="status" className="rounded bg-amber-950/40 p-3 text-amber-200">{policy.reason}</p>}
    <label className="flex gap-2"><input name="enabled" type="checkbox" defaultChecked={status.config.enabled} />啟用自動通知與 {mode} 交易</label>
    <label className="flex gap-2"><input name="confirmed" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
      {live ? `我確認使用真實資金，授權${universe === 'ALL' ? '全市場合約' : '以上商品'}與策略依上述全倉資金配置與風控自動開多／開空` : `我確認使用 Demo 模擬資金，授權${universe === 'ALL' ? '全市場合約' : '以上商品'}與策略自動開倉`}</label>
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={automation.busy} className="rounded bg-cyan-700 px-4 py-2 font-bold disabled:opacity-50">儲存設定</button>
      <button type="button" onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) automation.previewSettings(read(form)); }} disabled={automation.busy}
        className="rounded border border-slate-600 px-3 py-2 disabled:opacity-50">預覽目前設定（不送單）</button>
      <button type="button" onClick={() => automation.check(mode)} disabled={automation.busy || !(live ? status.hasLive : status.hasDemo)}
        className="rounded border border-slate-600 px-3 py-2 disabled:opacity-50">檢查 {mode} 帳戶（唯讀）</button>
      <button type="button" onClick={automation.stop} disabled={automation.busy} className="rounded border border-rose-700 px-3 py-2 text-rose-200 disabled:opacity-50">停止自動新倉</button>
    </div>
    <p className="text-xs text-slate-400">全倉保證金・本金取交易所實有 USDT 淨值，可用資金不足時拒單。測試單另按最新行情與滑價預留估算名目上限。市價成交可能有額外滑價；對帳確認超額時會要求退出。低於交易所最小數量則拒單，不會為了湊單放大倉位。交易所已有同幣種部位（含手動單）時跳過該幣；其他幣種的手動部位不影響自動化，系統也不會平倉或停損你的手動部位。</p>
  </form>;
}
