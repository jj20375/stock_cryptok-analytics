/** @file 潛力幣名單頁：讀取共享快照、篩選與定期重新整理；不直接抓行情、不下單。 */
import { useEffect, useState } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { loadPotentialRadar } from '../services/potentialRadar/loader.server';
import { isRadarCandidate, isTrendConfirmedCandidate, QUARTER_MS } from '../services/potentialRadar/types';
import { formatTime, ObservationTable, RadarCard, snapshotFresh } from '../features/potentialRadar/RadarCards';
import { nextScanAt, scanDueAt, snapshotState, UPDATE_LABELS } from '../features/potentialRadar/freshness';
import { PotentialChartDrawer } from '../features/potentialRadar/PotentialChartDrawer';
import { PerformancePanel } from '../features/potentialRadar/PerformancePanel';
import type { RadarSnapshot } from '../services/potentialRadar/types';

/** 不依賴伺服器與瀏覽器可能不同的 localeCompare，避免含非拉丁幣名時 SSR 首次排序不一致。 */
const compareRadarSnapshot = (left: RadarSnapshot, right: RadarSnapshot) => {
  const confirmationDifference = Number(right.signal!.trendConfirmation?.confirmed) - Number(left.signal!.trendConfirmation?.confirmed);
  if (confirmationDifference !== 0) return confirmationDifference;
  const scoreDifference = right.signal!.score - left.signal!.score;
  if (scoreDifference !== 0) return scoreDifference;
  return left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0;
};

export const loader = loadPotentialRadar;

export default function PotentialRadarPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  /** 預設顯示完整市場觀察，讓「有行情但未達門檻」與資料故障能明確區分。 */
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  /** 被選取的快照只控制抽屜，不修改掃描結果或觸發新一輪雷達計算。 */
  const [chartSnapshot, setChartSnapshot] = useState<RadarSnapshot | null>(null);
  /** SSR 以 loader 時間初始化，避免 hydration 差異；更新時同步過期標示。 */
  const [now, setNow] = useState(data.now);
  useEffect(() => { setNow(data.now); }, [data.now]);
  /** 新鮮度時鐘獨立於資料讀取，避免每次重繪重設更新計時器。 */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  /** 每分鐘讀取 DB；背景分頁暫停請求以節省流量。 */
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && revalidator.state === 'idle') revalidator.revalidate();
    }, 60_000);
    return () => clearInterval(timer);
  }, [revalidator.revalidate, revalidator.state]);
  const fresh = data.snapshots.filter(snapshot => snapshotFresh(snapshot, now));
  const candidates = fresh.filter(snapshot => isRadarCandidate(snapshot.signal!));
  /** 舊版快照的空值是尚未計算；吃大魚空榜不能誤報為條件未成立。 */
  const bigFishPending = fresh.some(snapshot => !snapshot.signal!.bigFish);
  const shown = fresh.filter(snapshot => {
    if (!snapshot.symbol.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'candidates') return isRadarCandidate(snapshot.signal!);
    if (filter === 'confirmed') return isTrendConfirmedCandidate(snapshot.signal!);
    if (filter === 'bigFish') return snapshot.signal!.bigFish?.entry === true;
    return snapshot.signal!.phase === filter;
  }).sort(compareRadarSnapshot).slice(0, 20);
  const classified = data.snapshots.map(snapshot => ({ snapshot, state: snapshotState(snapshot, now, data.run) }));
  /** 儀表板只把本輪真正失敗列為異常；歷史退榜追蹤與舊錯誤不污染目前健康狀態。 */
  const errors = classified.filter(item => item.state === 'ERROR' &&
    (!data.run || item.snapshot.checkedAt >= data.run.startedAt));
  const pending = classified.filter(item => item.state !== 'ERROR' && item.state !== 'FRESH');
  const runStale = !data.run || Math.floor(data.run.startedAt / QUARTER_MS) !== Math.floor(now / QUARTER_MS);
  return <AppLayout><div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
    <header className="flex flex-wrap justify-between items-start gap-4">
      <div><p className="text-xs tracking-widest opacity-60 mb-2">CRYPTO WATCHLIST</p><h1 className="text-3xl font-bold">潛力幣雷達</h1>
        <p className="text-sm mt-3 opacity-75">15 分提早發現 · 1 小時確認動能 · 4 小時判斷趨勢</p></div>
      <div className="flex items-center gap-4 text-sm"><Link to="/wave-radar" className="underline">波段雷達</Link>
        <button className="border border-current rounded px-4 py-2" disabled={revalidator.state !== 'idle'} onClick={() => revalidator.revalidate()}>
          {revalidator.state === 'idle' ? '更新畫面' : '讀取中…'}</button></div>
    </header>
    <section className="rounded-xl border border-black/15 bg-white/70 p-4 text-sm space-y-2">
      <p><strong>觀察用途：</strong>分數代表量價條件符合程度，不是暴漲機率。只用已收盤 K 線，不會自動下單。</p>
      <p><strong>吃大魚 2.0：</strong>15 分 MACD（12／26／9）金叉且收盤 &gt; EMA200 × 0.98，或 Supertrend（ATR 10、係數 4）翻綠，即標示進場。通過流動性與過熱檢查後可獨立列入優先觀察，量價分數維持原算法。</p>
      <p><strong>趨勢共振：</strong>4 小時 MA20 回踩後收盤轉強，加上已收盤日線 MA7 向上時標示已確認，並優先排序；不足八根完整日線時只顯示資料不足，不會判成反向。</p>
      <p><strong>永續籌碼：</strong>前三個優先候選會再讀取 Gate OI、資金費率、多空比與清算量，分類為健康趨勢、軋空、多頭擁擠、新增空單或去槓桿；只作訊號品質提示，不改寫原始進場條件。</p>
      <p className="opacity-70">ST 紅色時顯示多單出場條件；原碼未實作「獲利 3% 後保本」。吃大魚分類包含遭風控排除的原始觸發；不同交易所與歷史長度可能使訊號有別於 TradingView。</p>
      <p>範圍：Bybit／Gate 可交易 USDT 現貨，整輪鎖定同一來源。先按成交額、價差篩選，再檢查深度；每輪精算最多 12 檔新候選、1 檔歷史追蹤及前三名候選的 Gate 永續籌碼。</p>
      <p>排程：{data.enabled ? '每小時 02、17、32、47 分執行' : '尚未啟用'} · 畫面每分鐘更新 · 非全市場即時掃描</p>
      <p className="opacity-70">波動與量能門檻仍待驗證；下方條件績效是近期描述性統計，不等同已驗證勝率。新幣不足約四天歷史時暫不評分。</p>
    </section>
    {(data.error || data.run?.error) && <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-4">{data.error || data.run?.error}</p>}
    {!data.enabled && <p className="text-sm text-amber-800">掃描尚未啟用，畫面可能只有歷史資料。</p>}
    {runStale && data.enabled && <p role="status" className="text-sm text-amber-800">
      {now < scanDueAt(now) ? `新一根 15 分 K 線已收盤，預計 ${formatTime(scanDueAt(now))}（台北）開始掃描。` :
        now <= scanDueAt(now) + 300_000 ? '本輪已到排程時間，等待掃描結果；畫面每分鐘更新。' : '本輪更新延遲，請查看掃描摘要或資料錯誤。'}
      {' '}上一輪資料保留於待更新清單，舊訊號不列榜。
    </p>}
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[['當前候選', candidates.length], ['最新有效掃描', fresh.length], ['流動性合格池', data.run?.eligible ?? '—'], ['資料異常', errors.length]].map(([label, value]) =>
        <div key={label} className="rounded-xl bg-white/60 border border-black/10 p-4"><p className="text-xs opacity-65">{label}</p><strong className="text-2xl block mt-2">{value}</strong></div>)}
    </section>
    {data.run && <p className="text-xs opacity-60">最近完成 {formatTime(data.run.completedAt)}（台北）· 下次排程 {formatTime(nextScanAt(now))} · 本輪耗時 {Math.max(0, Math.round((data.run.completedAt - data.run.startedAt) / 1000))} 秒 · 選取 {data.run.selected} 檔，完成 {data.run.scanned} 檔，失敗 {data.run.failed} 檔</p>}
    {!runStale && fresh.length > 0 && candidates.length === 0 && <p role="status" className="rounded border border-emerald-400/50 bg-emerald-50/70 p-3 text-sm text-emerald-900">
      本輪已正常更新 {fresh.length} 檔，目前沒有標的通過候選門檻；這代表條件未觸發，不是掃描卡住。
    </p>}
    <div className="flex flex-wrap justify-between gap-4">
      <div className="flex flex-wrap gap-2" aria-label="名單分類">{[['all', '全部已掃描'], ['candidates', '優先觀察'], ['confirmed', '趨勢共振'], ['bigFish', '吃大魚進場'], ['WATCH', '提前關注'], ['BREAKOUT', '剛啟動'], ['RETEST', '回踩續強'], ['EXTENDED', '漲幅過熱']].map(([value, label]) =>
        <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-full border border-black/20 px-3 py-2 text-sm ${filter === value ? 'bg-[#141414] text-white' : 'bg-white/50'}`}>{label}</button>)}</div>
      <input aria-label="搜尋幣種" placeholder="搜尋幣種，例如 SOL" value={search} onChange={event => setSearch(event.target.value)} className="border border-black/20 bg-white/70 rounded px-3 py-2 text-sm" />
    </div>
    {shown.length ? <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{shown.map(snapshot => <li key={snapshot.symbol}><RadarCard snapshot={snapshot} onOpenChart={setChartSnapshot}
      observation={data.observations.find(observation => observation.symbol === snapshot.symbol)} /></li>)}</ul> :
      <div className="border border-dashed border-black/25 rounded-xl p-10 text-center"><h2 className="font-semibold">目前沒有符合此分類的最新標的</h2><p className="text-sm opacity-65 mt-2">{runStale ? '本輪掃描尚未完成，上一輪行情可在下方待更新清單查看。' :
        filter === 'bigFish' && bigFishPending ? '部分行情尚未計算吃大魚訊號，等待新版排程掃描；空榜不代表所有幣種均未觸發。' : '目前篩選下沒有符合條件的標的，等待下一輪量價變化。'}</p></div>}
    {pending.length > 0 && <details className="rounded border border-black/15 p-4 text-sm"><summary className="cursor-pointer">待更新與輪替掃描（{pending.length} 檔）</summary>
      <ul className="mt-3 space-y-2">{pending.map(({ snapshot, state }) => <li key={snapshot.symbol}>{snapshot.symbol}：{UPDATE_LABELS[state as keyof typeof UPDATE_LABELS]}
        {/* TRACKING（已離開合格池）時 signal 為 null，不能沿用 signal! 斷言，否則 SSR 會直接拋錯 */}
        {snapshot.signal && ` · 上次收盤 ${formatTime(snapshot.signal.barTime + QUARTER_MS)}`} · 最後檢查 {formatTime(snapshot.checkedAt)}</li>)}</ul></details>}
    {errors.length > 0 && <details className="rounded border border-red-500/40 p-4 text-sm"><summary className="cursor-pointer">資料抓取異常（{errors.length} 檔）</summary>
      <ul className="mt-3 space-y-2">{errors.map(({ snapshot }) => <li key={snapshot.symbol}>{snapshot.symbol}：{snapshot.error || '尚未取得有效行情'} · 最後檢查 {formatTime(snapshot.checkedAt)}</li>)}</ul></details>}
    <PerformancePanel observations={data.observations} />
    <section className="rounded-xl border border-black/15 bg-white/70 p-5 space-y-4"><h2 className="text-xl font-bold">入選後追蹤</h2>
      <ObservationTable observations={data.observations} now={now} /></section>
    <PotentialChartDrawer snapshot={chartSnapshot} onClose={() => setChartSnapshot(null)} />
  </div></AppLayout>;
}
