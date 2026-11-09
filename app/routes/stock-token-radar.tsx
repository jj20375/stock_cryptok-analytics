/** @file Bitget 美股現貨代幣清單；進場參考、失效、目標與排除原因分開呈現，不提供下單。 */
import { Fragment, useEffect } from 'react';
import { Form, Link, useActionData, useLoaderData, useNavigation, useRevalidator } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { loadStockTokenRadar, scanStockTokenRadar } from '../services/stockTokenRadar/loader.server';
import type { StockTokenCandidate } from '../services/stockTokenRadar/types';

export const loader = loadStockTokenRadar;
export const action = scanStockTokenRadar;
export const meta = () => [{ title: 'Bitget 美股代幣進場雷達' }];
const price = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 6 });
const time = (value: number) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const labels = { ENTRY: '進場候選', WAIT: '等待條件', EXCLUDED: '風控排除', INSUFFICIENT: '資料不足', STALE: '訊號逾期／休市', ERROR: '行情失敗' };

function CandidateCard({ candidate, active }: { candidate: StockTokenCandidate; active: boolean }) {
  const { plan, quote } = candidate;
  return <article className={`rounded border p-4 ${active ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-700 bg-slate-900'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="font-bold">{candidate.baseCoin} <span className="text-xs font-normal text-slate-400">{candidate.symbol}</span></h2>
        <p className="mt-1 text-xs text-slate-400">{candidate.name}</p></div>
      <span className={`text-xs ${active ? 'text-emerald-300' : 'text-amber-300'}`}>{candidate.status === 'ENTRY' && !active ? '已逾期，請重新掃描' : labels[candidate.status]}</span>
    </div>
    <p className="mt-3 text-sm leading-relaxed">{candidate.reasons.join('；')}</p>
    {plan && <>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-slate-400">進場參考區間（USDT）</dt><dd className="mt-1 font-semibold">{price(plan.entryLow)}～{price(plan.entryHigh)}</dd></div>
        <div><dt className="text-xs text-slate-400">掃描時買一價（USDT）</dt><dd className="mt-1">{quote ? price(quote.ask) : '—'}</dd></div>
        <div><dt className="text-xs text-slate-400">失效價／目標價（USDT）</dt><dd className="mt-1">{price(plan.stopPrice)}／{price(plan.targetPrice)}</dd></div>
        <div><dt className="text-xs text-slate-400">風險／估算淨報酬風險比</dt><dd className="mt-1">{plan.riskPct.toFixed(2)}%／{plan.netRewardRisk.toFixed(2)}R</dd></div>
      </dl>
      <p className="mt-3 text-xs text-slate-400">1h 收盤 {time(plan.closedAt)} · 有效截止 {time(plan.expiresAt)}（台北）</p>
    </>}
    {quote && <p className="mt-3 text-xs leading-relaxed text-slate-400">Bitget 平台24h額 {(quote.platformTurnover / 10_000).toFixed(1)} 萬 USDT · 一般24h額 {(quote.turnover / 10_000).toFixed(1)} 萬 USDT · 價差 {quote.spreadPct.toFixed(3)}%<br />報價時間 {time(quote.timestamp)}（台北）</p>}
    <a href={`https://www.bitget.com/spot/${encodeURIComponent(candidate.symbol)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-cyan-300 underline">查看 Bitget 商品</a>
  </article>;
}

export default function StockTokenRadarPage() {
  const data = useLoaderData<typeof loader>(), actionData = useActionData<typeof action>();
  const navigation = useNavigation(), revalidator = useRevalidator();
  const report = data.report;
  /** 每分鐘只重讀 D1，以清除過期候選；真正外部掃描每五分鐘由共享排程執行。 */
  useEffect(() => { const timer = setInterval(() => revalidator.revalidate(), 60_000); return () => clearInterval(timer); }, [revalidator]);
  const fresh = !!report && !report.error && data.now - report.completedAt < 10 * 60_000;
  const active = (candidate: StockTokenCandidate) => fresh && candidate.status === 'ENTRY' && !!candidate.plan && data.now < candidate.plan.expiresAt;
  const entries = report?.candidates.filter(active) ?? [];
  const waiting = report?.candidates.filter(candidate => !active(candidate)) ?? [];
  const busy = navigation.state !== 'idle';
  return <AppLayout><div className="mx-auto max-w-7xl space-y-5 p-4 text-slate-100 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
      <div><h1 className="text-xl font-bold">Bitget 美股代幣進場雷達</h1><p className="mt-1 text-xs text-slate-400">現貨 rToken · 4h 多頭確認＋1h 突破／回踩 · 每5分鐘掃描</p></div>
      <div className="flex gap-3 text-sm"><Link to="/us-stock-radar" className="self-center text-cyan-300">美股原股雷達</Link>
        <Form method="post"><button disabled={busy} className="rounded bg-emerald-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">{busy ? '掃描中…' : '立即掃描'}</button></Form></div>
    </header>
    <p className="text-sm text-slate-300">自動掃描 {data.enabled ? '已開啟' : '未開啟'} · 美股 Slack {data.slackConfigured ? '已設定（僅合格新訊號）' : '未設定 US_STOCK_SLACK_CHANNEL_ID'}；手動掃描有四分鐘冷卻。</p>
    {(data.error || report?.error || report?.notificationError) && <p role="alert" className="rounded border border-rose-600 bg-rose-950/30 p-3 text-sm text-rose-200">{data.error || report?.error || report?.notificationError}</p>}
    {actionData && <p role="status" className="text-sm text-amber-300">{actionData.message}</p>}
    {report && <div className="rounded border border-slate-700 p-4 text-sm leading-relaxed text-slate-300">
      最近掃描 {time(report.completedAt)}（台北） · 已上架 {report.total} 檔 · 流動性合格 {report.eligible} 檔 · 本輪分析 {report.selected} 檔 · 行情失敗 {report.failed} 檔
      <p className="mt-1">合格清單依平台成交額取前20檔分析；本輪進場候選 {entries.length} 檔。{!fresh && '報告已逾期或失敗，請重新掃描。'}</p>
      <p className="mt-1 text-xs text-slate-400">{Object.entries(report.exclusions).map(([reason, count]) => `${reason}：${count}檔`).join(' · ')}</p>
    </div>}
    <section aria-label="美股代幣進場候選" className="space-y-3"><h2 className="font-bold text-emerald-300">進場候選清單</h2>
      {entries.length ? <div className="grid gap-3 lg:grid-cols-2">{entries.map(candidate => <Fragment key={candidate.symbol}><CandidateCard candidate={candidate} active /></Fragment>)}</div>
        : <p className="rounded border border-slate-700 p-6 text-sm text-slate-400">{report ? '本輪沒有仍在有效期內的進場候選；等待下一根確認，不強行挑選。' : '尚無掃描報告。可按「立即掃描」或等待排程。'}</p>}
    </section>
    {!!waiting.length && <details className="space-y-3"><summary className="cursor-pointer text-sm text-slate-300">查看等待、排除或過期標的（{waiting.length}）</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">{waiting.map(candidate => <Fragment key={candidate.symbol}><CandidateCard candidate={candidate} active={false} /></Fragment>)}</div></details>}
    <p className="text-xs leading-relaxed text-slate-400">門檻：Bitget 平台24h成交額 ≥10萬 USDT、雙邊價差 ≤0.3%、報價不超過2分鐘；RSI14介於50～72；失效距離0.5%～5%；目標2R，估算單邊0.1%費用後至少1.5R。訊號收盤後20分鐘失效。報價為掃描時快照，成交前需重查；失效價不代表已掛停損。代幣與原股可能有價差，未驗證策略勝率。</p>
  </div></AppLayout>;
}
