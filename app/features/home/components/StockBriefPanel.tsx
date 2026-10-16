/** @component 首頁選股後的基本面與消息區；資料獨立讀取，來源失敗不阻塞 K 線與選股操作。 */
import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { useStockBrief } from '../use-stock-brief';
import { FinancialEvidenceCard, SourceHealth } from '../../stockResearch/EvidencePanel';
import type { BriefMarket, StockBrief } from '../../../services/stockBrief/types';

const valueText = (value: number | null | undefined, suffix = '') => value == null ? '未提供' : `${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}${suffix}`;
const dateText = (value: string) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

function BriefFacts({ data }: { data: StockBrief }) {
  const metrics = [
    ['本益比', valueText(data.valuation?.pe, ' 倍')], ['股價淨值比', valueText(data.valuation?.pb, ' 倍')],
    ['殖利率', valueText(data.valuation?.dividendYieldPct, '%')],
    ['月營收年增率', valueText(data.financials?.revenue?.yoyPct, '%')],
    ['累計 EPS', valueText(data.financials?.income?.cumulativeEpsTwd, ' 元')],
    ['累計營業利益率', valueText(data.financials?.income?.operatingMarginPct, '%')],
  ];
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">{data.market === 'TW' ? '官方基本面' : '基本面參考'}{data.isFund && ' · ETF／ETN'}</h3>
    {!data.isFund && <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">{metrics.map(([label, value]) => <div key={label} className="rounded border border-slate-700 bg-slate-950/30 p-3">
      <dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-base font-semibold text-slate-100">{value}</dd>
    </div>)}</dl>}
    {!data.isFund && <div className="space-y-1 text-xs text-slate-400">
      <p>估值日期：{data.valuation?.asOf ?? '來源未提供'}；營收月份：{data.financials?.revenue?.period ?? '未提供'}</p>
      {data.market === 'TW' && <p>財報期間：{data.financials?.income ? `${data.financials.income.year} 年初至第 ${data.financials.income.quarter} 季累計` : '未提供'}。EPS 單位為新台幣元，累計值不等於單季。</p>}
    </div>}
    {data.warnings.map(warning => <p key={warning} className="text-xs leading-relaxed text-amber-200/90">{warning}</p>)}
    {data.financials && <details className="text-sm"><summary className="cursor-pointer text-cyan-300 py-2">完整營運數據與缺漏說明</summary>
      <FinancialEvidenceCard financials={data.financials} />
    </details>}
  </div>;
}

function BriefNews({ data }: { data: StockBrief }) {
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">近期消息與公告 <span className="text-xs font-normal text-slate-400">{data.news.length} 則 · 發布時間為台北時間</span></h3>
    {data.news.length === 0 ? <p className="rounded border border-dashed border-slate-700 p-4 text-sm leading-relaxed text-slate-400">
      目前來源沒有提供近 30 天可確認與此標的相關的消息。你仍可從下方入口查詢；查無消息不代表沒有重大事件。
    </p> : <ul className="max-h-80 overflow-y-auto space-y-2 pr-1">{data.news.map(item => <li key={`${item.url}:${item.title}`} className="rounded border border-slate-700 p-3">
      <div className="mb-1 flex flex-wrap gap-2 text-xs text-slate-400"><span className={item.kind === 'announcement' ? 'text-cyan-300' : 'text-amber-300'}>{item.kind === 'announcement' ? '公司重大訊息' : '媒體報導'}</span><time dateTime={item.publishedAt}>{dateText(item.publishedAt)}</time></div>
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm leading-relaxed text-slate-100 hover:text-cyan-300 hover:underline">{item.title} <ExternalLink className="inline h-3 w-3" /></a>
      <p className="mt-1 text-xs text-slate-400">{item.publisher}{item.kind === 'announcement' && ' · 連結開啟官方公告資料集'}</p>
    </li>)}</ul>}
    <a href={data.market === 'TW' ? `https://tw.stock.yahoo.com/quote/${encodeURIComponent(data.symbol)}/news` : `https://finance.yahoo.com/quote/${encodeURIComponent(data.symbol)}/news/`}
      target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-300 underline">查看更多個股新聞 <ExternalLink size={12} /></a>
    <p className="text-xs text-slate-400">新聞僅列公開標題與來源，內容仍需核對原文；美股新聞可能包含同業比較。</p>
  </div>;
}

export function StockBriefPanel({ symbol, name, market, loggedIn }: { symbol: string; name: string; market: BriefMarket; loggedIn: boolean }) {
  const { data, error, loading, reload } = useStockBrief(symbol, market, loggedIn);
  return <section aria-label="基本面與近期消息" aria-busy={loading} className="rounded border border-slate-700 bg-[#0d1726] p-4 md:p-5 text-slate-100">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-bold"><BookOpen className="h-4 w-4 text-cyan-300" />基本面與近期消息 · {name} <span className="text-sm text-slate-400">{symbol}</span></h2>
        <p className="mt-1 text-xs text-slate-400">隨上方選股卡與左側股票切換；財務與消息供人工參考。</p></div>
      <div className="flex items-center gap-3 text-xs">
        <Link to={`/stock-analysis?symbol=${encodeURIComponent(symbol)}`} className="rounded border border-slate-600 px-3 py-2 hover:border-cyan-400">個股深度分析</Link>
        <button type="button" disabled={loading || !loggedIn} onClick={reload} className="inline-flex items-center gap-1 rounded border border-slate-600 px-3 py-2 disabled:opacity-40"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} />重新讀取</button>
      </div>
    </div>
    {!loggedIn ? <p className="text-sm text-slate-400"><Link to="/login" className="text-cyan-300 underline">登入</Link>後即可查看此股資料。</p> : loading ?
      <p role="status" className="py-6 text-sm text-slate-400">正在讀取 {symbol} 的財務資料與近期消息…</p> : error ?
      <p role="alert" className="rounded border border-rose-500/40 bg-rose-950/20 p-4 text-sm text-rose-300">{error}</p> : data && <>
        <div className="grid gap-5 xl:grid-cols-2"><BriefFacts data={data} /><BriefNews data={data} /></div>
        <div className="mt-4 space-y-2"><p className="text-xs text-slate-400">讀取時間：{dateText(data.fetchedAt)}；資料源快取最長 15 分鐘，發布時間及財報期間以各筆標示為準。</p>
          <SourceHealth sources={data.sources} />
        </div>
      </>}
  </section>;
}
