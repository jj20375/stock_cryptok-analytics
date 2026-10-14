/** @file 台股 15 分線當沖 Top 10；登入後只讀行情與研究，不建立真實委託。 */
import { useEffect, useState } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { DaytradeRankingTable, daytradeTime } from '../features/twDaytrade/RankingTable';
import { DaytradeStockDiagnostics } from '../features/twDaytrade/StockDiagnostics';
import { loadTwDaytrade } from '../services/twDaytrade/loader.server';
import { DAYTRADE_RULES } from '../services/twDaytrade/types';
import { isFreshDaytradeBar } from '../services/twDaytrade/candles';

export const loader = loadTwDaytrade;

export default function TwDaytradePage() {
  const { scan, error } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [now, setNow] = useState(scan?.completedAt ?? 0);
  useEffect(() => {
    setNow(Date.now());
    /** 每分鐘更新新鮮度，僅在新 15 分段且頁面可見時重抓；休市不持續大量呼叫 Yahoo。 */
    const timer = setInterval(() => {
      const time = Date.now(); setNow(time);
      const taipei = new Date(time + 8 * 3_600_000), minute = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
      if (document.visibilityState === 'visible' && revalidator.state === 'idle' && scan && minute >= 555 && minute <= 780 &&
        Math.floor(time / DAYTRADE_RULES.intervalMs) > Math.floor(scan.scannedAt / DAYTRADE_RULES.intervalMs)) revalidator.revalidate();
    }, 60_000);
    return () => clearInterval(timer);
  }, [scan, revalidator.state, revalidator.revalidate]);
  /** 畫面時間會繼續推進；舊掃描不能因留在分頁而一直顯示為有效進場。 */
  const candidates = scan?.candidates.filter(row => isFreshDaytradeBar({ closeTime: row.stock.closedAt,
    openTime: row.stock.closedAt - DAYTRADE_RULES.intervalMs }, now)) ?? [];
  return <AppLayout><div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div>
      <p className="mb-2 text-xs tracking-widest opacity-60">TAIWAN · 15 MIN · LONG ONLY</p>
      <h1 className="text-3xl font-bold">台股當沖 Top 10</h1>
      <p className="mt-3 text-sm opacity-70">股價 {DAYTRADE_RULES.maxPrice} 元以下 · 七策略篩選 · 只做多 · 依近期扣成本後勝率排序</p>
    </div><button disabled={revalidator.state !== 'idle'} onClick={() => revalidator.revalidate()} className="rounded border border-current/30 px-4 py-2 text-sm">
      {revalidator.state === 'idle' ? '重新掃描' : '抓取 15 分行情與回測中…'}</button></header>
    <section className="space-y-2 rounded-xl border border-current/15 p-5 text-sm">
      <p><strong>價格範圍：</strong>最新已收盤股價 {DAYTRADE_RULES.minPrice} 至 {DAYTRADE_RULES.maxPrice} 元（含 {DAYTRADE_RULES.maxPrice} 元）；初篩與回測進場均套用相同限制，開盤跳空超過上限就取消進場。</p>
      <p><strong>策略：</strong>吃大魚 2.0、極值反彈、趨勢追蹤、連續爆量、收斂突破、區間回歸；量增未破用於排除做多風險。日線策略的每一期在本頁皆為 15 分 K，屬未驗證的週期移植，原系統日線設定不變。</p>
      <p><strong>回測：</strong>Yahoo 60d 可取得的已收盤行情（實際起訖見明細），下一根開盤進場；13:00 後不開新倉、13:15 開盤平倉。缺根交易日不重放。每股模擬，不計整張最低手續費與成交排隊或漲跌停成交限制。</p>
      <p><strong>成本：</strong>雙邊手續費各 0.1425%、滑價各 0.05%、賣出股票當沖稅 0.15%。當沖資格與適用稅率須向券商確認。
        <a href="https://www.twse.com.tw/zh/about/company/guide.html" target="_blank" rel="noreferrer" className="ml-2 underline">證交所稅率說明</a></p>
      <p><strong>入榜：</strong>歷史至少 10 筆、時間較後 30% 完整交易日驗證至少 5 筆，兩區間平均淨報酬皆須大於零；目前候選另須有新做多訊號、未過進場時間、20 分鐘內已收盤資料且沒有量增未破警示。</p>
      <p className="opacity-65">這是掃描池內的歷史研究排名，並非全市場最高勝率或未來獲利機率。固定原策略參數，未進行參數尋優；同時比較多檔多策略仍有選擇偏誤。Yahoo 公開行情可能延遲，最新價格與預估停損僅供參考。</p>
      <Link to="/tw-stock-radar" className="inline-block underline">回到台股潛力雷達</Link>
    </section>
    {error && <p role="alert" className="rounded border border-red-400 p-4">{error}</p>}
    {scan && <>
      <p className="text-xs opacity-65">掃描 {daytradeTime(scan.scannedAt)}（台北） · 完成 {scan.scanned}／{scan.selected} 檔 · {scan.universeSource}
        {scan.priceExcluded > 0 && ` · 價格超出範圍排除 ${scan.priceExcluded} 檔`}
        · 有效候選 {candidates.length} 檔，少於 10 檔不補榜</p>
      <section className="space-y-3"><h2 className="text-xl font-bold">目前符合訊號的前 10 名</h2><DaytradeRankingTable rows={candidates} current /></section>
      <section className="space-y-3"><h2 className="text-xl font-bold">歷史研究前 10 名</h2>
        <p className="text-sm opacity-65">通過回測門檻；休市、延遲或沒有新訊號的股票仍只供研究。</p><DaytradeRankingTable rows={scan.research} current={false} /></section>
      {scan.errors.length > 0 && <details className="rounded-xl border border-amber-500/40 p-4 text-sm"><summary className="cursor-pointer">行情未完成（{scan.errors.length} 檔）</summary>
        <ul className="mt-3 space-y-2">{scan.errors.map(item => <li key={item.symbol}>{item.symbol}：{item.message}</li>)}</ul></details>}
      <DaytradeStockDiagnostics stocks={scan.stocks} />
    </>}
  </div></AppLayout>;
}
