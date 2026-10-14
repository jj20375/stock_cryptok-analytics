import { cryptoAutoScanEnabled } from '../cryptoActivityPolicy';
/**
 * 【詳細繁體中文註解】：K 線快取每日增量更新
 *
 * 目的:讓 kline_cache 內「曾經被回測過的標的」自動保持最新,
 * 之後重跑回測時 prepare 幾乎不需再向外部 API 補資料。
 *
 * 策略:只更新快取中已存在的 (symbol, market, interval) 組合 —
 * 使用者沒回測過的標的不浪費額度;組合數以 MAX_COMBOS 上限保護,
 * 避免 Cloudflare Workers 排程請求的 subrequest 額度被吃光。
 *
 * 排程:由 worker.ts 掛在每日 06:00 UTC cron(與台股日報同時段,獨立 waitUntil)。
 *
 * 外部 API 副作用註記:加密貨幣走 Bybit 分頁抓取(HYPE 使用 Binance.US，每組最多 3 頁);
 * 美股/台股走 Yahoo 3 個月日線(每組 1 請求,台股自動補 .TW 後綴查詢)。
 * 單一組合失敗僅記 log,不中斷其他組合。
 */

import { drizzle } from 'drizzle-orm/d1';
import { ne, sql } from 'drizzle-orm';
import { klineCache } from '../../db/schema';
import { fetchBinanceRange, intervalToMs } from './binanceHistory';
import { fetchStockDailyHistory, toYahooSymbol } from './stockDailyHistory';
import { getLatestOpenTime, upsertKlines, type MarketType } from './klineStore';

// 單次排程最多更新的 (symbol, interval) 組合數:
// 加密每組最多 3 頁(3 subrequest)+ D1 batch,24 組約 <100 subrequest,額度安全
const MAX_COMBOS = 24;

/** 每日增量更新入口(由 cron 呼叫) */
export const runDailyKlineRefresh = async (env: any): Promise<void> => {
  console.log('🚀 [Kline Refresh] 開始每日 K 線快取增量更新...');
  const db = drizzle(env.DB);

  try {
    // 找出快取中所有既有組合(= 使用者回測過的標的)
    const combos = await db
      .selectDistinct({
        symbol: klineCache.symbol,
        market: klineCache.market,
        interval: klineCache.interval,
      })
      .from(klineCache)
      // 停用自動掃描時，虛擬幣快取改由手動分析更新，不能占用股票更新名額與排程請求。
      .where(cryptoAutoScanEnabled(env) ? undefined : ne(klineCache.market, 'CRYPTO'))
      .limit(MAX_COMBOS);

    if (combos.length === 0) {
      console.log('ℹ️ [Kline Refresh] 快取尚無資料,略過');
      return;
    }

    const now = Date.now();
    let updatedTotal = 0;

    for (const combo of combos) {
      try {
        const market = combo.market as MarketType;

        if (market === 'CRYPTO') {
          const intervalMs = intervalToMs(combo.interval);
          const latest = await getLatestOpenTime(db, combo.symbol, combo.interval);
          if (latest == null) continue;
          // 已是最新(缺口不足一根)就跳過,節省請求
          if (now - latest < intervalMs * 2) continue;

          const result = await fetchBinanceRange(
            combo.symbol,
            combo.interval,
            latest + intervalMs,
            now,
            3 // 每組最多 3 頁(3000 根);超過的部分留待下次排程或回測 prepare 補齊
          );
          if (result.candles.length > 0) {
            await upsertKlines(db, 'CRYPTO', combo.symbol, combo.interval, result.candles);
            updatedTotal += result.candles.length;
          }
        } else if ((market === 'US' || market === 'TW') && combo.interval === '1d') {
          // 美股/台股:抓最近 3 個月日線,INSERT OR IGNORE 冪等補上缺的交易日
          const { candles } = await fetchStockDailyHistory(toYahooSymbol(combo.symbol, market), '3mo');
          if (candles.length > 0) {
            await upsertKlines(db, market, combo.symbol, combo.interval, candles);
            updatedTotal += candles.length;
          }
        }
      } catch (error) {
        console.error(`❌ [Kline Refresh] ${combo.symbol} ${combo.interval} 更新失敗:`, error);
      }
    }

    console.log(`✅ [Kline Refresh] 完成,共處理 ${combos.length} 組、寫入 ${updatedTotal} 根`);
  } catch (error) {
    console.error('🔥 [Kline Refresh] 執行失敗:', error);
  }
};
