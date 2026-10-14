/** @component 本人合約自動化與訊號紀錄；正式委託、模擬委託及唯讀預覽清楚標記。 */
import { Link } from 'react-router';
import { AUTO_ORDER_LABELS } from '../../../services/cryptoFutures/automation';
import { useFuturesAutomation } from '../useFuturesAutomation';
import { FuturesAutomationForm } from './FuturesAutomationForm';
const time = (value: number | null) => value == null ? '尚未檢查' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
export function FuturesAutomationPanel() {
  const automation = useFuturesAutomation(), status = automation.status;
  return <section aria-label="合約自動化" className="space-y-4 rounded border border-cyan-800 bg-slate-900/80 p-4 text-sm text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Bitget 合約自動盯盤與交易</h2>
      <Link to="/settings" className="rounded border border-slate-600 px-3 py-2">設定 Bitget 合約 API</Link></div>
    <p className="text-slate-300">執行器每分鐘檢查已收盤1H。趨勢回踩／區間回收另看4H盤勢；吃大魚使用1H Pine條件，僅做多。訊號送至現有合約 Slack 頻道，通過風控後自動開多／開空；關閉頁面也會執行。</p>
    <p className="text-xs text-amber-300">依已儲存的 Demo／LIVE 環境執行。收盤後約一分鐘開始檢查是目標；行情、網路與排程可能延遲，超過五分鐘的進場不追補。本機執行須維持電腦與程序運作。</p>
    {!status ? <p role="status">讀取自動化設定…</p> : status.error ? <p role="alert" className="text-rose-300">{status.error}</p> : <>
      <div className="flex flex-wrap gap-3 text-xs"><span>儲存環境：{status.config.executionMode}</span>
        <span>全倉・{status.config.testMode ? `測試單名目上限 ${status.config.maxNotionalUsdt} USDT` : '依交易所 USDT 本金配置'}</span><span>單筆上限 {status.config.positionPct}%・最多 {status.config.maxOpenPositions} 筆</span><span>範圍：{status.config.universe === 'ALL' ? '全市場（成交額 ≥ 1,000 萬）' : status.config.symbols}</span><span>Slack：{status.slackReady ? '已設定' : '尚未設定'}</span>
        <strong className={status.config.enabled ? 'text-emerald-300' : 'text-slate-400'}>{status.config.enabled ? '自動化啟用' : '自動化停止'}</strong>
        <span>最後檢查：{time(status.checkedAt)}（台北時間）</span></div>
      {status.lastError && <p role="alert" className="rounded bg-rose-950/50 p-3 text-rose-200">{status.lastError}</p>}
      {/* 僅在儲存設定改變時重建表單與確認，狀態輪詢不清除尚未提交的輸入。 */}
      <div key={JSON.stringify(status.config)}><FuturesAutomationForm status={status} automation={automation} /></div>
      {automation.preview && <div role="status" className="space-y-2 rounded border border-slate-600 p-3">
        <p>{automation.preview.executionMode} 唯讀預覽・{automation.preview.symbol}・{time(automation.preview.signalAt)}・{automation.preview.reason}</p>
        {automation.preview.capitalUsdt != null && <p>交易所 USDT 本金：{automation.preview.capitalUsdt.toFixed(2)} USDT</p>}
        {automation.preview.quote && <p>預估名目 {automation.preview.quote.notionalUsdt.toFixed(2)} USDT{automation.preview.maxNotionalUsdt != null ? `／測試上限 ${automation.preview.maxNotionalUsdt} USDT` : ''}・數量 {automation.preview.quote.quantity}・全倉 {automation.preview.quote.leverage}x・保證金約 {automation.preview.quote.marginUsdt.toFixed(2)} USDT・停損 {automation.preview.quote.stopLossPrice}・目標 {automation.preview.quote.targetPrice ?? '—'}</p>}
        {(automation.preview.error || automation.preview.quote?.blockedReason) && <p className="text-amber-300">{automation.preview.error || automation.preview.quote?.blockedReason}</p>}
        <p className="text-xs text-slate-400">預覽未送單，也未啟用自動交易；沒有確認訊號時不建立委託。</p>
      </div>}
      <p className="text-xs text-slate-400">本金取本人 Bitget 合約帳戶 USDT 淨值；單筆名目上限 3～5%、同時最多 3 筆，停損計畫風險最多本金 0.25%。槓桿、每日虧損與每日次數仍受帳戶風控限制。停止後，已送出的委託仍可能成交，既有部位保留交易所停損與備援保護。</p>
      {!!Object.keys(status.checks).length && <details className="text-xs text-slate-300"><summary>各商品最近檢查原因</summary>
        {Object.entries(status.checks).map(([key, row]) => <p key={key}>{key.split(':').at(-1)}・{time(row.bar)}・{row.reason}</p>)}</details>}
      <div className="overflow-x-auto"><h3 className="mb-2 font-bold">最近確認訊號</h3>
        {!status.events.length ? <p className="text-slate-400">尚無確認訊號；沒有訊號時不送通知或開倉。</p> : <table className="w-full min-w-[680px] text-left text-xs"><thead><tr>
          {['台北時間／環境', '商品／方向', '參考價', '委託／成交', '通知'].map(label => <th className="border-b border-slate-700 p-2" key={label}>{label}</th>)}</tr></thead><tbody>
          {status.events.map(row => <tr key={row.id}><td className="p-2 align-top">{time(row.signalAt)}<br /><strong>{row.executionMode}</strong></td><td className="p-2 align-top">{row.symbol}<br />
            {{ OPEN_LONG: '做多進場', OPEN_SHORT: '做空進場', CLOSE_LONG: '多單出場', CLOSE_SHORT: '空單出場' }[row.intent] ?? row.intent}</td><td className="p-2 align-top tabular-nums">{row.price}</td>
            <td className="max-w-sm p-2">{AUTO_ORDER_LABELS[row.orderStatus] ?? row.orderStatus}<p className="mt-1 text-slate-400">{row.orderReason || row.reason}</p></td>
            <td className="p-2 align-top">{{ SENT: '已送達', PENDING: '待投遞', FAILED: '投遞失敗', EXPIRED: '已過期', CANCELED: '已停止' }[row.notificationStatus] ?? row.notificationStatus}</td></tr>)}</tbody></table>}
      </div>
    </>}
    {(automation.error || automation.message) && <p role={automation.error ? 'alert' : 'status'} className={automation.error ? 'text-rose-300' : 'text-emerald-300'}>{automation.error || automation.message}</p>}
  </section>;
}
