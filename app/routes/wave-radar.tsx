import { Link, redirect, useLoaderData, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { drizzle } from 'drizzle-orm/d1';
import { count, isNull } from 'drizzle-orm';
import { AppLayout } from '../components/AppLayout';
import { getUserId } from '../utils/auth';
import { waveNotifications, waveRadar } from '../db/waveSchema';
import { WAVE_SYMBOLS, waveSource } from '../services/cryptoUniverse';
import { WAVE_INTERVAL_MS, WAVE_LABELS } from '../services/strategy/strategies/cryptoWave';
import type { WaveSnapshot } from '../services/waveRadar/state';

/** 登入才可查看全站共享行情；重新整理只讀資料庫，不觸發通知或下單。 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  if (!await getUserId(request, env)) throw redirect('/login');
  const db = drizzle(env.DB);
  const settings = { enabled: env.WAVE_RADAR_ENABLED === 'true', slack: !!(env.SLACK_API_TOKEN && env.SLACK_CHANNEL_ID) };
  try {
    const rows = await db.select().from(waveRadar);
    const [pending] = await db.select({ total: count() }).from(waveNotifications).where(isNull(waveNotifications.sentAt));
    return { ...settings, rows, pending: pending.total, error: null, now: Date.now() };
  } catch {
    return { ...settings, rows: [], pending: 0, error: '監控資料尚未就緒，請先套用資料庫更新並檢查連線。', now: Date.now() };
  }
}

export default function WaveRadarPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  return <AppLayout>
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      <header className="flex flex-wrap justify-between items-center gap-4">
        <div><h1 className="text-2xl font-bold">波段雷達・翻倍目標驗證</h1>
          <p className="text-sm mt-2 opacity-70">日線看方向，4 小時找突破；追蹤訊號，透過回測檢驗能否持有波段。</p></div>
        <button className="border border-current px-4 py-2 rounded" disabled={revalidator.state !== 'idle'} onClick={() => revalidator.revalidate()}>
          {revalidator.state === 'idle' ? '更新畫面' : '讀取中…'}
        </button>
      </header>
      <section className="bg-white/80 border border-black/20 rounded p-4 space-y-2 text-sm">
        <p><strong>驗證模式：</strong>現貨做多、下一根開盤模擬成交；單筆風險預設 1%、單幣部位上限 25%。</p>
        <p>資金翻倍代表帳戶報酬 +100%，不是幣價翻倍。每筆回測為獨立單幣資金，不能相加當成投資組合報酬。</p>
        <p>排程：{data.enabled ? '設定為每 15 分鐘掃描' : '尚未啟用'} ｜ Slack：{data.slack ? '已設定，實際送達以事件紀錄為準' : '尚未設定'} ｜ 待發通知：{data.pending}</p>
        <p className="opacity-60">先驗證多幣、多個行情區間與樣本外績效。此模式不會自動下單，也不保證翻倍。</p>
      </section>
      {data.error && <p role="alert" className="bg-amber-50 p-4 border border-amber-400">{data.error}</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {WAVE_SYMBOLS.map(coin => {
          const row = data.rows.find(item => item.symbol === coin.symbol);
          const snapshot: WaveSnapshot | null = row ? JSON.parse(row.snapshotJson) : null;
          const signal = snapshot?.signal;
          // 舊行情即使有訊號也不能用醒目「啟動」標籤冒充當前機會。
          const stale = !signal?.barTime || data.now - signal.barTime >= 2 * WAVE_INTERVAL_MS;
          const healthy = snapshot && !snapshot.error && !stale;
          const active = healthy && (signal?.phase === 'BREAKOUT' || signal?.phase === 'RETEST');
          return <article key={coin.symbol} className={`border rounded p-4 space-y-3 ${active ? 'border-emerald-700 bg-emerald-50' : 'border-black/20 bg-white/70'}`}>
            <div className="flex justify-between gap-2"><h2 className="font-bold">{coin.symbol.replace('USDT', '')} <span className="font-normal text-xs">{coin.name}</span></h2>
              <span className="text-xs">{healthy ? WAVE_LABELS[signal!.phase] : snapshot?.error ? '資料異常' : '等待更新'}</span></div>
            <p className="text-xs opacity-60">{waveSource(coin.symbol)}</p>
            <p className="text-sm min-h-10">{snapshot?.error || (stale ? '尚無最新已收盤行情，暫不判斷上漲機會。' : signal?.reason)}</p>
            {healthy && <dl className="text-sm grid grid-cols-2 gap-2">
              <dt>收盤 USDT</dt><dd>{signal!.price.toPrecision(6)}</dd>
              <dt>突破參考</dt><dd>{signal!.breakout?.toPrecision(6) ?? '—'}</dd>
              <dt>量能倍數</dt><dd>{signal!.volumeRatio?.toFixed(2) ?? '—'}</dd>
              <dt>追蹤失效參考</dt><dd>{snapshot.tracking?.stopPrice.toPrecision(6) ?? '—'}</dd>
            </dl>}
            {signal?.barTime ? <p className="text-xs opacity-60">K 線收盤：{new Date(signal.barTime + WAVE_INTERVAL_MS).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</p> : null}
            <Link className="inline-block underline text-sm font-semibold" to={`/backtest?market=CRYPTO&symbol=${coin.symbol}&strategyId=crypto_wave`}>驗證這個幣的波段策略 →</Link>
          </article>;
        })}
      </div>
    </div>
  </AppLayout>;
}
