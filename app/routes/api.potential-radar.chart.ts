/** @file 潛力幣右側圖表的只讀端點；驗證登入、快照與來源後才讀取外部行情。 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { LoaderFunctionArgs } from 'react-router';
import { potentialRadar } from '../db/potentialSchema';
import { fetchBinanceRange, intervalToMs } from '../services/marketData/binanceHistory';
import { parsePotentialChartRequest, POTENTIAL_CHART_WINDOWS } from '../services/potentialRadar/chartRequest';
import { fetchUniverse } from '../services/potentialRadar/market';
import type { RadarSnapshot } from '../services/potentialRadar/types';
import { getUserId } from '../utils/auth';

const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  /** 先驗證 session，避免未登入者把此端點當成任意外部行情代理。 */
  if (!await getUserId(request, env)) return jsonError('請先登入後再查看圖表。', 401);

  const chartRequest = parsePotentialChartRequest(new URL(request.url));
  if (!chartRequest) return jsonError('圖表查詢格式不正確。', 400);

  try {
    const row = await drizzle(env.DB).select().from(potentialRadar)
      .where(eq(potentialRadar.symbol, chartRequest.symbol)).get();
    const snapshot = row ? JSON.parse(row.snapshotJson) as RadarSnapshot : null;
    /** 舊快照的 source 依資料契約視為 Bybit；來源仍必須和當輪鎖定交易所相同，避免行情混用。 */
    const scanned = !!snapshot?.signal && (snapshot.signal.source ?? 'BYBIT_SPOT') === chartRequest.source;
    /**
     * 即時戰略 Dashboard 的即時補算結果不寫入 D1；此時改以「該交易所目前流動性合格的 USDT 現貨池」驗證，
     * 仍不接受任意交易對。只有 D1 無對應快照時才多打一次公開名單請求。
     */
    if (!scanned && !(await fetchUniverse(chartRequest.source).catch(() => []))
      .some(coin => coin.symbol === chartRequest.symbol)) {
      return jsonError('此標的目前沒有可用的雷達快照。', 404);
    }

    const intervalMs = intervalToMs(chartRequest.interval);
    const now = Date.now();
    /** 只要求已收盤最新一根；圖表長度由固定視窗限制，15 分線最長 960 根。 */
    const latestClosedOpen = Math.floor(now / intervalMs) * intervalMs - intervalMs;
    const startTime = latestClosedOpen - POTENTIAL_CHART_WINDOWS[chartRequest.interval] + intervalMs;
    const history = await fetchBinanceRange(
      chartRequest.symbol, chartRequest.interval, startTime, now, 1,
      { forcedSource: chartRequest.source, minLatestOpenTime: latestClosedOpen, requireContiguous: true },
    );
    if (history.candles.length < 20) return jsonError('此標的的歷史 K 線暫時不足。', 422);

    return Response.json({
      symbol: chartRequest.symbol,
      source: history.source,
      interval: chartRequest.interval,
      candles: history.candles,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[PotentialRadar Chart] 讀取失敗:', error);
    /** 外部來源錯誤不回傳細節，避免洩漏其 URL、狀態或內部資料庫資訊。 */
    return jsonError('圖表行情暫時無法取得，請稍後再試。', 502);
  }
}
