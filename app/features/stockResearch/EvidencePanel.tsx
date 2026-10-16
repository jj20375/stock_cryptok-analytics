/** @file 題材與財報證據卡；官方數字、標題線索及資料缺口分開呈現。 */
import { Link } from 'react-router';
import type { ProgramTopic, PublicSourceStatus, StockFinancialEvidence } from '../../services/stockResearch/types';

const numberText = (value: number | null, suffix = '') => value === null ? '未提供' : `${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}${suffix}`;

export function SourceHealth({ sources }: { sources: PublicSourceStatus[] }) {
  return <details className="rounded border border-current/20 p-3 text-xs">
    <summary className="cursor-pointer">資料來源狀態（{sources.filter(source => source.status === 'ok').length}/{sources.length} 可讀取）</summary>
    <ul className="mt-3 space-y-2">{sources.map(source => <li key={source.url}>
      <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
      <span className="ml-2">{source.status === 'ok' ? '已讀取' : source.message}</span>
      <span className="ml-2 opacity-60">讀取時間 {new Date(source.fetchedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</span>
    </li>)}</ul>
  </details>;
}

export function FinancialEvidenceCard({ financials }: { financials: StockFinancialEvidence }) {
  const { revenue, income } = financials;
  const symbol = `${financials.code}${financials.market === 'TPEX' ? '.TWO' : financials.market === 'TWSE' ? '.TW' : ''}`;
  const metrics = [
    ['月營收（新台幣千元）', numberText(revenue?.revenueThousandTwd ?? null)],
    ['月營收年增率', numberText(revenue?.yoyPct ?? null, '%')],
    ['月營收月增率', numberText(revenue?.momPct ?? null, '%')],
    ['累計營收年增率', numberText(revenue?.cumulativeYoyPct ?? null, '%')],
    ['累計 EPS（新台幣元）', numberText(income?.cumulativeEpsTwd ?? null)],
    ['累計毛利率', numberText(income?.grossMarginPct ?? null, '%')],
    ['累計營業利益率', numberText(income?.operatingMarginPct ?? null, '%')],
  ];
  return <section className="rounded border border-current/25 p-5 space-y-4">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h2 className="text-xl font-bold">{financials.name} · {financials.code}</h2>
        <p className="mt-1 text-xs opacity-65">{financials.market === 'TWSE' ? '上市' : financials.market === 'TPEX' ? '上櫃' : '市場尚未確認'} · 官方營運數字</p></div>
      <Link className="self-start rounded border border-current/30 px-3 py-2 text-sm" to={`/stock-analysis?symbol=${encodeURIComponent(symbol)}`}>查看個股分析 →</Link>
    </div>
    <p className="text-sm">營收月份：{revenue?.period ?? '未提供'}<br />
      財報期間：{income ? `${income.year} 年初至第 ${income.quarter} 季累計` : '未提供'}</p>
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">{metrics.map(([label, value]) => <div key={label}>
      <dt className="text-xs opacity-60">{label}</dt><dd className="mt-1 font-mono text-lg font-semibold">{value}</dd>
    </div>)}</dl>
    <div className="text-xs leading-relaxed opacity-70">
      <p>營收出表日期：{revenue?.exportedAt ?? '未提供'}；財報出表日期：{income?.exportedAt ?? '未提供'}。出表日期不是公司原始公告日期。</p>
      <p>本版財報涵蓋一般業；累計 EPS 不等於單季或全年 EPS，單一快照不足以判斷成長趨勢、估值或進場時機。</p>
    </div>
    {financials.warnings.length > 0 && <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">{financials.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    <SourceHealth sources={financials.sources} />
  </section>;
}

export function ProgramEvidenceList({ programs }: { programs: ProgramTopic[] }) {
  if (!programs.length) return <p className="rounded border border-dashed border-current/25 p-6 text-sm opacity-70">目前沒有符合的公開標題；不代表公司沒有題材或利多。</p>;
  return <div className="grid gap-4 md:grid-cols-2">{programs.map(program => <article key={program.id} className="rounded border border-current/25 p-5 space-y-3">
    <p className="text-xs opacity-60">錢線百分百 · 節目日期 {program.programDate}</p>
    <h3 className="font-semibold leading-relaxed"><a className="hover:underline" href={program.url} target="_blank" rel="noreferrer">{program.title}</a></h3>
    <div className="flex flex-wrap gap-2">{(program.themes.length ? program.themes : ['綜合市場']).map(theme => <span key={theme} className="rounded bg-current/5 px-2 py-1 text-xs">{theme}</span>)}</div>
    <p className="text-xs opacity-60">標題明確提及的台股（不代表受惠或推薦）</p>
    {program.stocks.length ? <div className="flex flex-wrap gap-2">{program.stocks.map(stock => <Link key={stock.symbol}
      className="rounded border border-current/30 px-2 py-1 text-sm hover:underline" to={`/stock-themes?symbol=${encodeURIComponent(stock.symbol)}`}>
      {stock.name} {stock.code} →</Link>)}</div> : <p className="text-xs opacity-65">未辨識到明確個股，不自行補列概念股。</p>}
    <a className="inline-block text-xs underline" href={program.videoUrl} target="_blank" rel="noreferrer">前往官方影片 ↗</a>
  </article>)}</div>;
}
