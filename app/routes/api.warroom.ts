/**
 * 【詳細繁體中文註解】：戰情室 API — 加密貨幣永續合約即時訊號看板(僅供顯示,不下單)
 *
 * 回傳:大盤市場風控狀態(以 BTC 為代表)+ 監控幣種目前的合約進出場訊號。
 * 訊號來源:直接重用 strategy registry 的 supertrend_momentum 策略(與回測、live 引擎同一份邏輯),
 * 支援雙向(LONG/SHORT),適合「戰情室」這種需要明確方向性訊號的看板。
 *
 * 監控清單:使用獨立的 WARROOM_SYMBOLS(app/services/warroomUniverse.ts),
 * ⚠️ 刻意不與波段雷達的 45 檔共用清單 — 曾經共用過,波段雷達擴充時把戰情室也連帶
 * 擴大到 45 檔,直接打穿 Cloudflare Workers 50 次 subrequest 額度導致全部評估失敗。
 *
 * 資料來源:改用 marketData/binanceHistory 的多來源備援機制(Bybit/Gate.io/Binance.US),
 * 不再使用 binanceService.getKlines(該函式直連 api.binance.com 現在對 Cloudflare 回 403,
 * fallback 僅有 OKX 一條路,備援深度不足)。
 *
 * 前視偏差防範:fetchBinanceRange 只回傳「已收盤」K 線,故直接取最後一根評估與顯示,
 * 不需要像舊版那樣額外退一格避開進行中的 K 線。
 *
 * 併發控制:改用小批次(BATCH_SIZE)依序處理,不再對全部幣種一次 Promise.all —
 * 全部平行送出會讓同時飛行的 fetch 數超過 Cloudflare 的並發上限,觸發
 * "stalled response canceled" 的強制取消,反而讓原本會成功的請求也失敗。
 *
 * 倉位/爆倉價計算刻意不在後端做:margin(USDT)與槓桿倍數由使用者在前端調整,
 * 屬於單純乘除運算,前端即時算即可,不需每次都重新打 API。
 */

import type { LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../utils/auth';
import { fetchBinanceRange, intervalToMs } from '../services/marketData/binanceHistory';
import { getStrategy } from '../services/strategy/registry';
import { IndicatorCache } from '../services/strategy/indicatorCache';
import type { Candle } from '../services/strategy/types';
import { evaluateCryptoMarketRegime } from '../services/cryptoMarketRegime';
import { fetchFundingRate } from '../services/futuresRisk';
import { WARROOM_SYMBOLS } from '../services/warroomUniverse';

// 戰情室固定使用 supertrend_momentum(唯一支援雙向 LONG/SHORT 的已註冊策略,符合「開合約」的方向性需求)
const WARROOM_STRATEGY_ID = 'supertrend_momentum';
const ALLOWED_INTERVALS = ['1h', '4h', '1d'];
// 每批同時處理的幣種數:12 幣 ÷ 4 = 3 批,每批 2 次 fetch(K 線+資金費率)= 8 個同時飛行的請求,
// 遠低於 Cloudflare 的並發上限,不會觸發 stalled response 強制取消
const BATCH_SIZE = 4;

// 策略出場規則的白話說明(供前端顯示「離場時機」;策略本身無倉位可評估,故用固定文案描述規則)
const EXIT_HINT: Record<string, string> = {
  supertrend_momentum: 'Supertrend 指標翻向時出場(多單翻空出場、空單翻多出場),或觸及下方停損價',
};

const jsonError = (message: string, status: number = 400) => Response.json({ error: message }, { status });

/** 依序處理陣列,每批最多 batchSize 筆同時執行,避免一次性 Promise.all 觸發並發上限 */
async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const userId = await getUserId(request, env);
  if (!userId) return jsonError('Unauthorized', 401);

  const url = new URL(request.url);
  const interval = url.searchParams.get('interval') || '4h';
  if (!ALLOWED_INTERVALS.includes(interval)) {
    return jsonError(`不支援的週期: ${interval}(僅支援 ${ALLOWED_INTERVALS.join('/')})`);
  }

  const strategy = getStrategy(WARROOM_STRATEGY_ID);
  if (!strategy) return jsonError('策略未註冊', 500);

  try {
    // 大盤風控狀態(以 BTC 為代表,整個戰情室共用一份,不逐幣重算避免重複打 API)
    const marketRegime = await evaluateCryptoMarketRegime('BTCUSDT');

    const intervalMs = intervalToMs(interval);
    const now = Date.now();
    /** 訊號只能使用所選週期的最新收盤；資料缺口交由既有行情服務切換備援。 */
    const lastClosedOpen = Math.floor(now / intervalMs) * intervalMs - intervalMs;
    // 抓最近 100 根(對應原本 getKlines 的 limit=100),足夠 supertrend_momentum 的暖機需求
    const startTime = now - 100 * intervalMs;

    const coinResults = await mapWithConcurrencyLimit(WARROOM_SYMBOLS, BATCH_SIZE, async (coin) => {
      try {
        const [klineResult, funding] = await Promise.all([
          fetchBinanceRange(coin.symbol, interval, startTime, now, 1, { minLatestOpenTime: lastClosedOpen, requireContiguous: true }),
          fetchFundingRate(coin.symbol),
        ]);

        const candles: Candle[] = klineResult.candles;
        if (candles.length < strategy.warmupBars + 2) {
          return { symbol: coin.symbol, name: coin.name, error: '歷史資料不足,暫時無法評估' };
        }

        // fetchBinanceRange 只回傳已收盤 K 線,最後一根即可直接評估與顯示,無需再退一格
        const evalIndex = candles.length - 1;
        const currentPrice = candles[evalIndex].close;
        const indicators = new IndicatorCache(candles);

        const action = strategy.evaluate({
          candles,
          index: evalIndex,
          indicators,
          position: null, // 戰情室為無狀態掃描,不追蹤實際持倉,單純評估「現在進場」是否成立
          params: { ...strategy.defaultParams },
        });

        const signal: 'LONG' | 'SHORT' | 'HOLD' =
          action.type === 'ENTRY' ? action.side : 'HOLD';
        const stopLossPct = action.type === 'ENTRY' ? action.stopLossPct ?? strategy.defaultParams.stopLossPct : null;
        const stopLossPrice =
          stopLossPct != null
            ? signal === 'LONG'
              ? currentPrice * (1 - stopLossPct / 100)
              : currentPrice * (1 + stopLossPct / 100)
            : null;

        return {
          symbol: coin.symbol,
          name: coin.name,
          price: currentPrice,
          source: klineResult.source,
          barTime: candles[evalIndex].openTime,
          changePct: (currentPrice / candles[evalIndex - 1].close - 1) * 100,
          closes: candles.slice(-24).map(candle => candle.close),
          signal,
          reason: action.type === 'ENTRY' ? action.reason : '目前訊號不明確,建議觀望',
          stopLossPct,
          stopLossPrice,
          exitHint: EXIT_HINT[WARROOM_STRATEGY_ID],
          fundingRate: funding?.fundingRate ?? null,
          nextFundingTime: funding?.nextFundingTime ?? null,
        };
      } catch (coinError) {
        console.error(`❌ [WarRoom] ${coin.symbol} 評估失敗:`, coinError);
        return { symbol: coin.symbol, name: coin.name, error: '資料查詢失敗,暫時無法評估' };
      }
    });

    return Response.json({
      updatedAt: new Date().toISOString(),
      interval,
      strategyName: strategy.name,
      marketRegime: {
        riskLevel: marketRegime.riskLevel,
        allowLong: marketRegime.allowLong,
        reason: marketRegime.reason,
      },
      coins: coinResults,
    });
  } catch (error) {
    console.error('🔥 [WarRoom API] 執行失敗:', error);
    return jsonError((error as Error).message, 500);
  }
}
