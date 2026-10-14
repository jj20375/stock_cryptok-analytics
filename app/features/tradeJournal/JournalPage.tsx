/** @file 帳戶與區間分開選擇；同步只讀交易所，AI 週報由使用者按鈕觸發。 */
import { useState } from 'react';
import { Link, useRevalidator, useSearchParams } from 'react-router';
import { AppLayout } from '../../components/AppLayout';
import type { journalPageData } from '../../services/bitgetLedger/repository.server';
import { JournalPerformance, money } from './JournalPerformance';
import { JournalChart } from './JournalChart';
import { SessionDetail } from './SessionDetail';
type PageData = Awaited<ReturnType<typeof journalPageData>> & { setupError: string | null };
const date = (time: number | null) => time ? new Date(time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚未取得';
const statuses: Record<string, string> = { live: '已接受', new: '已接受', partially_filled: '部分成交', filled: '已成交', canceled: '已取消', cancelled: '已取消', SUBMITTED: '已接受，待對帳', FILLED: '已成交', PARTIALLY_FILLED: '部分成交' };
export function JournalPage({ data }: { data: PageData }) {
  const [params, setParams] = useSearchParams(), revalidator = useRevalidator();
  const [environment, setEnvironment] = useState<'DEMO' | 'LIVE'>('DEMO');
  const [historyDays, setHistoryDays] = useState(30), [dialect, setDialect] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failure, setFailure] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const journal = data.journal;
  const account = data.accounts.find(row => row.id === data.selected);
  const visibleSessions = journal?.sessions.filter(row => sourceFilter === 'ALL' || row.source === sourceFilter) ?? [];
  const selected = visibleSessions.find(row => row.id === sessionId) ?? visibleSessions[0];
  async function operate(operation: 'sync' | 'review') {
    setBusy(true); setMessage(''); setFailure(false);
    try {
      const response = await fetch('/trade-journal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, accountId: data.selected, environment, days: historyDays, dialect: dialect || undefined }) });
      const payload = await response.json() as { error?: string; message?: string; accountId?: string };
      if (!response.ok) throw new Error(payload.error ?? '操作未完成');
      setMessage(payload.message ?? '週報已產生');
      if (payload.accountId && payload.accountId !== data.selected) {
        setParams(previous => { const next = new URLSearchParams(previous); next.set('account', payload.accountId!); return next; });
      }
      revalidator.revalidate();
    } catch (error) { setFailure(true); setMessage(error instanceof Error ? error.message : '操作未完成'); }
    finally { setBusy(false); }
  }
  return <AppLayout><main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="border-b border-gray-300 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div>
        <h1 className="font-serif text-3xl italic">Bitget 交易復盤</h1>
        <p className="mt-2 text-sm text-gray-600">實際成交、費用、倉位與淨績效。日期顯示台北時間，統計日界線採 UTC。</p>
      </div><Link to="/settings" className="rounded-lg border px-4 py-2 text-sm">設定合約憑證</Link></div>
    </header>
    {data.setupError && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{data.setupError}</p>}
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4" aria-label="帳本同步">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">讀取環境<select className="ml-2 rounded border p-2" value={environment} onChange={event => setEnvironment(event.target.value as 'DEMO' | 'LIVE')}><option>DEMO</option><option>LIVE</option></select></label>
        <label className="text-sm">歷史匯入<select className="ml-2 rounded border p-2" value={historyDays} onChange={event => setHistoryDays(Number(event.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={89}>89 天</option></select></label>
        <label className="text-sm">帳戶種類<select className="ml-2 rounded border p-2" value={dialect} onChange={event => setDialect(event.target.value)}><option value="">自動／沿用</option><option value="UTA_V3">UTA</option><option value="CLASSIC_V2">Classic</option></select></label>
        <button type="button" disabled={busy || Boolean(data.setupError)} onClick={() => void operate('sync')} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? '處理中…' : '同步／繼續匯入'}</button>
      </div>
      <p className="text-xs text-gray-500">首次同步後，每五分鐘排程分批更新已登記帳戶。歷史匯入一次最多三頁，可以按「繼續匯入」加快進度。</p>
      {message && <p role={failure ? 'alert' : 'status'} className={`text-sm ${failure ? 'text-rose-700' : 'text-blue-700'}`}>{message}</p>}
      {!!data.accounts.length && <div className="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
        <label className="text-sm">查看帳戶<select aria-label="查看帳戶" className="ml-2 max-w-64 rounded border p-2" value={data.selected ?? ''} onChange={event => { setSessionId(null); setParams(previous => { const next = new URLSearchParams(previous); next.set('account', event.target.value); return next; }); }}>
          {data.accounts.map(row => <option key={row.id} value={row.id}>{row.environment} · {row.id.slice(0, 8)}</option>)}
        </select></label>
        <label className="text-sm">統計區間<select aria-label="統計區間" className="ml-2 rounded border p-2" value={params.get('days') || '30'} onChange={event => setParams(previous => { const next = new URLSearchParams(previous); next.set('days', event.target.value); return next; })}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={89}>近 89 天</option></select></label>
        <button type="button" disabled={revalidator.state !== 'idle'} onClick={() => revalidator.revalidate()} className="rounded border px-3 py-2 text-xs">更新畫面</button>
      </div>}
      {account && <div className="text-xs text-gray-600">{account.dialect || '未確認帳戶種類'} · 最後取得 {date(account.lastSyncedAt)} · 完整覆蓋 {date(account.coveredFrom)} → {date(account.coveredTo)}
        {account.importing && <span className="ml-2 text-amber-700">分頁匯入中</span>}
        {account.error && <p className="mt-2 text-rose-700">{account.error}</p>}
      </div>}
    </section>
    {!journal && !data.setupError && <div className="rounded-xl border border-dashed p-10 text-center text-gray-500">填妥合約憑證後同步，開始建立實際成交帳本。</div>}
    {journal && <>
      {(journal.truncated || journal.mismatchCount > 0 || journal.unallocatedFundingCount > 0) && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        {journal.truncated && '帳本超出單次資料上限，績效尚未完整。'} 持倉快照差異 {journal.mismatchCount} 筆；未能歸屬倉位的資金費率 {journal.unallocatedFundingCount} 筆。
      </p>}
      <JournalPerformance metrics={journal.metrics} />
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-medium">倉位日誌 <span className="text-xs text-gray-500">最近區間，最多 200 個倉位</span></h2>
        <label className="text-xs text-gray-600">日誌來源（上方績效仍為全帳戶）<select className="ml-2 rounded border p-2" value={sourceFilter} onChange={event => { setSourceFilter(event.target.value); setSessionId(null); }}><option value="ALL">全部</option>{[...new Set(journal.sessions.map(row => row.source))].map(source => <option key={source} value={source}>{source}</option>)}</select></label>
        <div className="max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="sticky top-0 bg-gray-50 text-xs text-gray-500"><tr>{['商品／方向', '進場時間', '來源', '狀態', '淨損益 USDT', '對帳'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
          {visibleSessions.map(row => <tr key={row.id} className={selected?.id === row.id ? 'bg-blue-50' : 'border-t border-gray-100'}>
            <td className="p-3"><button type="button" className="font-medium text-blue-700 underline" onClick={() => setSessionId(row.id)}>{row.symbol} {row.side === 'long' ? '多' : '空'}</button></td>
            <td className="p-3">{date(row.openTime)}</td><td className="p-3 max-w-44 truncate" title={row.strategy}>{row.strategy}</td><td className="p-3">{row.status === 'OPEN' ? '持倉中' : '已平倉'}</td><td className="p-3 font-mono">{money(row.netPnl)}</td><td className="p-3">{row.issues.length ? '資料待補' : '完整'}</td>
          </tr>)}
        </tbody></table>{!visibleSessions.length && <p className="p-6 text-center text-gray-500">此區間／來源尚無成交倉位。</p>}</div>
      </section>
      {selected && data.selected && <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-medium">{selected.symbol} · {selected.side === 'long' ? '多單' : '空單'}復盤</h2>
        <JournalChart accountId={data.selected} session={selected} /><SessionDetail session={selected} />
      </section>}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-medium">交易所委託 <span className="text-xs text-gray-500">最新 100 筆</span></h2>
        <div className="max-h-72 overflow-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead><tr>{['商品', '委託 ID', '狀態', '已成交／委託量', '均價'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{journal.orders.map(order => <tr key={order.exchangeId} className="border-t border-gray-100"><td className="p-2">{order.symbol}</td><td className="p-2 font-mono">{order.exchangeId}</td><td className="p-2">{statuses[order.status] ?? order.status}</td><td className="p-2">{order.filledQuantity} / {order.quantity}</td><td className="p-2">{order.averagePrice ?? '未成交'}</td></tr>)}</tbody></table></div>
      </section>
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">Gemini 本週至今復盤</h2><button type="button" disabled={busy} onClick={() => void operate('review')} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">產生／更新週報</button></div>
        <p className="text-xs text-gray-500">以 UTC 週一至產生時間彙總，每帳戶十分鐘最多產生一次。</p>
        {journal.report ? <><p className="text-xs text-gray-500">產生時間 {date(journal.report.createdAt)}{journal.report.dataVersion !== journal.version && ' · 成交資料已更新，可重新產生'}</p><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{journal.report.content}</pre></> : <p className="text-sm text-gray-500">同步本週成交後，可產生費用、執行偏差及風控觀察週報。</p>}
      </section>
    </>}
  </main></AppLayout>;
}
