/** @file 免外部金鑰的台股題材與財報頁；站內登入後才執行公開來源讀取。 */
import { useState } from 'react';
import { Form, Link, redirect, useLoaderData, useNavigation, type LoaderFunctionArgs } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { FinancialEvidenceCard, ProgramEvidenceList, SourceHealth } from '../features/stockResearch/EvidencePanel';
import { fetchPublicResearch } from '../services/stockResearch/research.server';
import { getUserId } from '../utils/auth';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env ?? {};
  if (!await getUserId(request, env)) throw redirect('/login');
  const symbol = (new URL(request.url).searchParams.get('symbol') ?? '2330').trim().toUpperCase();
  if (!/^\d{4,6}(?:\.TW|\.TWO)?$/.test(symbol)) {
    return { research: null, symbol, error: '請輸入台股代號，例如 2330 或 3105.TWO。' };
  }
  return { research: await fetchPublicResearch(symbol), symbol, error: null };
}

export default function StockThemes() {
  const { research, symbol, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  const [relatedOnly, setRelatedOnly] = useState(false);
  const code = research?.financials?.code;
  const query = search.trim().toLowerCase();
  const programs = research?.programs.filter(program => (!relatedOnly || program.stocks.some(stock => stock.code === code)) &&
    `${program.title} ${program.themes.join(' ')} ${program.stocks.map(stock => `${stock.name} ${stock.code}`).join(' ')}`.toLowerCase().includes(query)) ?? [];
  const themes = [...new Set(research?.programs.flatMap(program => program.themes) ?? [])];

  return <AppLayout><main className="mx-auto max-w-7xl space-y-6 p-4 md:p-8" aria-busy={navigation.state !== 'idle'}>
    <header className="space-y-3">
      <p className="text-xs tracking-widest opacity-60">PUBLIC STOCK RESEARCH</p>
      <h1 className="text-3xl font-bold">題材與財報</h1>
      <p className="max-w-3xl text-sm leading-relaxed opacity-75">從公開節目標題發現研究線索，再核對上市／上櫃公司的官方營收與財報。標題分類及公司提及不代表實際受惠，也不構成進場訊號。</p>
      <Link className="inline-block text-sm underline" to="/tw-stock-radar">查看台股雷達的技術條件 →</Link>
    </header>
    <Form method="get" className="flex flex-wrap items-end gap-3">
      <label className="space-y-2 text-sm"><span className="block">台股代號</span>
        <input key={symbol} name="symbol" defaultValue={symbol} maxLength={10} required placeholder="2330 或 3105.TWO"
          className="rounded border border-current/30 bg-transparent px-3 py-2" /></label>
      <button disabled={navigation.state !== 'idle'} className="rounded border border-current px-4 py-2 text-sm disabled:opacity-50">
        {navigation.state === 'idle' ? '查詢官方財報' : '讀取中…'}</button>
    </Form>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {research && <>
      {research.financials && <FinancialEvidenceCard financials={research.financials} />}
      <section className="space-y-4">
        <div><h2 className="text-xl font-bold">近期節目題材線索</h2>
          <p className="mt-2 text-xs leading-relaxed opacity-65">僅收錄首頁可見、近 14 天且可辨識節目日期的單元；不是完整節目庫或市場熱度排行。兩字公司簡稱僅在名稱分隔明確時列入。</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => setSearch('')} className="rounded border border-current/25 px-3 py-1 text-xs">全部題材</button>
          {themes.map(theme => <button key={theme} onClick={() => setSearch(theme)} aria-pressed={search === theme}
            className={`rounded border border-current/25 px-3 py-1 text-xs ${search === theme ? 'font-bold underline' : ''}`}>{theme}</button>)}</div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm">搜尋題材或股票 <input value={search} onChange={event => setSearch(event.target.value)}
            className="ml-2 rounded border border-current/30 bg-transparent px-3 py-2" placeholder="例如 PCB、京元電子" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={relatedOnly} onChange={event => setRelatedOnly(event.target.checked)} />只看目前個股</label>
        </div>
        <p aria-live="polite" className="text-xs opacity-60">符合 {programs.length} 則公開單元</p>
        <ProgramEvidenceList programs={programs} />
      </section>
      <SourceHealth sources={research.sources} />
      <p className="text-xs leading-relaxed opacity-60">以 Asia/Taipei 顯示讀取時間。僅整理公開標題與官方數字，未分析影片內容；目前沒有歷史財報、現金流、估值或受惠關係驗證。請透過來源連結核對原始資訊。</p>
    </>}
  </main></AppLayout>;
}
