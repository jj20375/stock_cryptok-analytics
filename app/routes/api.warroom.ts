/**
 * 【詳細繁體中文註解】：戰情室 API — 加密貨幣永續合約即時訊號看板(僅供顯示,不下單)
 *
 * 回傳:大盤市場風控狀態(以 BTC 為代表)+ 監控的 11 檔幣種目前的合約進出場訊號。
 * 訊號來源:直接重用 strategy registry 的 supertrend_momentum 策略(與回測、live 引擎同一份邏輯),
 * 支援雙向(LONG/SHORT),適合「戰情室」這種需要明確方向性訊號的看板。
 *
 * 前視偏差防範:與 live 引擎相同做法 — 以「最後一根已收盤 K 線」評估(index = candles.length - 2),
 * 不使用進行中的 K 線,避免訊號隨每次刷新而抖動。
 *
 * 倉位/爆倉價計算刻意不在後端做:margin(USDT)與槓桿倍數由使用者在前端調整,
 * 屬於單純乘除運算,前端即時算即可,不需每次都重新打 API。
 *
 * 外部 API 副作用註記:每檔幣種各打一次 K 線 + 一次資金費率查詢(共 22 次公開 API 呼叫),
 * 大盤風控另打 3 次(BTC 1h/4h + macro);單一幣種失敗只跳過該幣種,不中斷整體回應。
 */

import type { LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../utils/auth';
import { getKlines } from '../services/binanceService';
import { getStrategy } from '../services/strategy/registry';
import { IndicatorCache } from '../services/strategy/indicatorCache';
import type { Candle } from '../services/strategy/types';
import { evaluateCryptoMarketRegime } from '../services/cryptoMarketRegime';
import { fetchFundingRate } from '../services/futuresRisk';
import { CRYPTO_SYMBOLS } from '../features/backtest/constants';

// 戰情室固定使用 supertrend_momentum(唯一支援雙向 LONG/SHORT 的已註冊策略,符合「開合約」的方向性需求)
const WARROOM_STRATEGY_ID = 'supertrend_momentum';
const ALLOWED_INTERVALS = ['1h', '4h', '1d'];

// 策略出場規則的白話說明(供前端顯示「離場時機」;策略本身無倉位可評估,故用固定文案描述規則)
const EXIT_HINT: Record<string, string> = {
  supertrend_momentum: 'Supertrend 指標翻向時出場(多單翻空出場、空單翻多出場),或觸及下方停損價',
};

const jsonError = (message: string, status: number = 400) => Response.json({ error: message }, { status });

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

    const coinResults = await Promise.all(
      CRYPTO_SYMBOLS.map(async (coin) => {
        try {
          const [klines, funding] = await Promise.all([
            getKlines(coin.symbol, interval as any, 100),
            fetchFundingRate(coin.symbol),
          ]);

          if (klines.length < strategy.warmupBars + 2) {
            return { symbol: coin.symbol, name: coin.name, error: '歷史資料不足,暫時無法評估' };
          }

          const candles: Candle[] = klines.map((k) => ({
            openTime: k.openTime,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
          }));

          // 用最後一根已收盤 K 線評估(index = len-2),避免用進行中的 K 線造成訊號抖動
          const evalIndex = candles.length - 2;
          const currentPrice = candles[candles.length - 1].close;
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
      })
    );

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
