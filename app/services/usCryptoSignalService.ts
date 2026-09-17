/**
 * 【詳細繁體中文註解】：虛擬幣概念美股 — 每日收盤訊號掃描與 Slack 推播
 *
 * 定位:美股自動化的「方案 A(僅訊號通知)」—
 * 系統不代為下單,只在收盤後掃描觀察清單,對出現進場訊號的標的推播 Slack,
 * 內含建議倉位(重用 positionSizing 風險式計算)與停損價,由使用者自行決定是否手動下單。
 *
 * 排程:由 worker.ts 的合併美股日報 cron 在 UTC 20:45（台北 04:45）分流執行。
 *
 * 策略來源:與回測共用同一份 strategy registry(rsiMeanReversion / supertrendMomentum),
 * 以「最後一根已收盤日 K」評估 — 與回測引擎的判定邏輯完全一致,
 * 因此 Slack 訊號可直接與回測結果對帳。
 *
 * 外部 API 副作用註記:每個標的向 Yahoo 抓一次 2 年日線(單一 HTTP 請求);
 * 單一標的失敗只略過該標的,不中斷整體掃描。
 * Slack 發送失敗僅記 log,不影響其他標的。
 */

import { sendSlackMessage } from './slackService';
import { fetchStockDailyHistory } from './marketData/stockDailyHistory';
import { getStrategy } from './strategy/registry';
import type { StrategyModule } from './strategy/types';
import { IndicatorCache } from './strategy/indicatorCache';
import { calculateRiskBasedPosition } from './positionSizing';
import { CRYPTO_STOCKS } from '../features/backtest/constants';

// 建議倉位的假設本金(USD):訊號為頻道廣播、非個人化,以名目本金換算建議倉位,
// 訊息中會註明假設,使用者依自身本金等比例縮放
const NOMINAL_CAPITAL_USD = 10000;
// 單筆風險 %:與系統風控預設一致的保守值
const RISK_PER_TRADE_PCT = 1;
// 最大倉位 %(單一標的)
const MAX_POSITION_PCT = 20;

// 【詳細繁體中文註解】：本推播明確白名單只跑「加密貨幣相關」的兩個策略,
// 刻意不用 listStrategiesByMarket('US') 泛用查詢 — 後續在 registry 新增的一般台股/美股策略
// (趨勢追蹤/連續爆量/量增未破/日線量增)僅供回測系統使用,不應該未經確認就自動混入既有的
// 虛擬幣概念美股 Slack 推播,以免不小心擴大這支排程的實際行為範圍。
const RELEVANT_STRATEGY_IDS = ['rsi_mean_reversion', 'supertrend_momentum'];

/** 掃描全部虛擬幣概念美股並推播進場訊號 */
export const runUsCryptoStockSignals = async (env: any): Promise<void> => {
  console.log('🚀 [US Crypto Signals] 開始掃描虛擬幣概念美股訊號...');
  const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
  const slackChannel = env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
  if (!slackToken || !slackChannel) {
    console.warn('⚠️ [US Crypto Signals] 未設定 Slack,略過推播');
    return;
  }

  // 只取白名單內、支援美股與日線的策略(與回測同一份 registry,判定邏輯一致)
  const strategies = RELEVANT_STRATEGY_IDS
    .map((id) => getStrategy(id))
    .filter((s): s is StrategyModule => !!s && s.markets.includes('US') && s.supportedIntervals.includes('1d'));

  const signalMessages: string[] = [];

  for (const stock of CRYPTO_STOCKS) {
    try {
      // fetchStockDailyHistory 已排除未定版的當日 K 線,最後一根即「最後已收盤」的日 K
      const { candles } = await fetchStockDailyHistory(stock.symbol, '2y');
      if (candles.length < 80) continue; // 資料不足暖機,略過(新上市標的)

      const indicators = new IndicatorCache(candles);
      const lastIndex = candles.length - 1;
      const lastClose = candles[lastIndex].close;

      for (const strategy of strategies) {
        if (candles.length < strategy.warmupBars + 10) continue;

        // 以空手視角評估「是否出現進場訊號」(訊號通知為無狀態掃描,不追蹤持倉)
        const action = strategy.evaluate({
          candles,
          index: lastIndex,
          indicators,
          position: null,
          params: { ...strategy.defaultParams },
        });

        if (action.type !== 'ENTRY') continue;
        // 現貨/現股操作者無法做空,SHORT 訊號僅作觀察提示不建議倉位
        const isLong = action.side === 'LONG';

        const stopLossPct = action.stopLossPct ?? 5;
        const sizing = calculateRiskBasedPosition({
          capitalBaseUsdt: NOMINAL_CAPITAL_USD,
          currentPrice: lastClose,
          maxPositionSizePct: MAX_POSITION_PCT,
          maxRiskPerTradePct: RISK_PER_TRADE_PCT,
          precision: stock.precision,
          stopLossPct,
        });

        const directionLabel = isLong ? '🟢 做多' : '🔴 轉弱(僅供觀察,現股不可做空)';
        let message =
          `• *${stock.name}* (${stock.symbol}) ｜ ${directionLabel}\n` +
          `>   策略:${strategy.name}\n` +
          `>   收盤價:$${lastClose.toFixed(2)} ｜ 停損價:$${(isLong ? lastClose * (1 - stopLossPct / 100) : lastClose * (1 + stopLossPct / 100)).toFixed(2)} (${stopLossPct}%)\n` +
          `>   理由:${action.reason}`;

        if (isLong && sizing.quantity > 0) {
          message += `\n>   建議倉位:${sizing.quantity} 股(約 $${sizing.notionalUsdt.toFixed(0)},假設本金 $${NOMINAL_CAPITAL_USD}、單筆風險 ${RISK_PER_TRADE_PCT}%)`;
        }
        signalMessages.push(message);
      }
    } catch (error) {
      console.error(`❌ [US Crypto Signals] ${stock.symbol} 掃描失敗:`, error);
    }
  }

  if (signalMessages.length === 0) {
    console.log('ℹ️ [US Crypto Signals] 今日無進場訊號');
    return;
  }

  const dateStr = new Date().toLocaleDateString('zh-TW');
  const slackMsg =
    `*🪙 虛擬幣概念美股 收盤訊號 (${dateStr})*\n\n` +
    signalMessages.join('\n\n') +
    `\n\n_⚠️ 訊號由回測驗證中的策略產生,倉位為假設本金換算,請依自身資金與風險承受度調整。投資有風險,本訊息不構成投資建議。_`;

  try {
    await sendSlackMessage(slackToken, slackChannel, slackMsg);
    console.log(`✅ [US Crypto Signals] 已推播 ${signalMessages.length} 則訊號`);
  } catch (error) {
    console.error('🔥 [US Crypto Signals] Slack 推播失敗:', error);
  }
};
