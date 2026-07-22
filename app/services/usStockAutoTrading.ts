/**
 * 【詳細繁體中文註解】：虛擬幣概念美股 — Bitget 股票代幣(rToken)自動下單
 *
 * 定位:美股自動化的「方案 B(真實自動下單)」,獨立於 usCryptoSignalService.ts(維持該檔案
 * 訊號通知行為完全不變)。只有使用者明確開啟 stockAutoTradingEnabled 且填妥 Bitget 三把金鑰
 * (apiKey/apiSecret/passphrase)才會進入本流程,預設關閉。
 *
 * 交易標的:CRYPTO_STOCKS 觀察清單,透過 Bitget 股票代幣(如 COIN → RCOINUSDT)下單 —
 * Bitget 是本系統唯一支援股票代幣交易的交易所,無論使用者的 preferredExchange 設定為何,
 * 股票自動交易一律使用 Bitget。
 *
 * 策略範圍:刻意只用 rsi_mean_reversion 單一策略(與加密貨幣 runStrategyEngine 的實際下單
 * 邏輯一致 — 該引擎的 supertrend_momentum 同樣只做訊號通知、不追蹤持倉)。
 * 若同時讓兩種策略對同一檔標的做倉位管理,會有「誰先開倉、誰能出場」的歸屬問題,
 * 因此本檔案不採用 usCryptoSignalService.ts 的雙策略白名單,只用單一策略避免衝突。
 *
 * 持倉管理:比照 strategyEngine.runStrategyEngine 的模式 — 查詢 paper_trades(market='US')
 * 是否已有該標的的 OPEN 部位,有則評估出場、無則評估進場,一檔標的同時只能有一筆持倉。
 *
 * 風控:沿用既有 riskGuard.evaluateCapitalRisk(不傳 cryptoRegime,加密貨幣崩盤守衛
 * 自動略過不套用)與 positionSizing.calculateRiskBasedPosition,风控統計僅計入 market='US' 的交易,
 * 與加密貨幣交易分開計算每日虧損/交易次數上限,避免兩邊互相排擠額度。
 *
 * 排程:由 worker.ts 掛在既有美股策略日報 cron(45 20 * * * UTC),與 usCryptoSignalService
 * 各自獨立 waitUntil,互不影響。
 */

import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { users, paperTrades } from '../db/schema';
import { decryptData } from '../utils/encryption';
import { fetchStockDailyHistory } from './marketData/stockDailyHistory';
import { getStrategy } from './strategy/registry';
import { IndicatorCache } from './strategy/indicatorCache';
import type { Candle, OpenPositionState } from './strategy/types';
import { placeBitgetMarketBuy, placeBitgetMarketSell, toBitgetStockSymbol, BITGET_STOCK_TOKEN_PRECISION } from './bitgetService';
import { calculateRiskBasedPosition } from './positionSizing';
import { evaluateCapitalRisk } from './riskGuard';
import { sendSlackMessage } from './slackService';
import { CRYPTO_STOCKS } from '../features/backtest/constants';

// 【詳細繁體中文註解】：只用單一策略,避免多策略對同一標的的倉位歸屬衝突(見檔頭說明)
const STOCK_AUTO_TRADING_STRATEGY_ID = 'rsi_mean_reversion';

/** 逐使用者掃描虛擬幣概念美股,對已開啟自動交易的使用者透過 Bitget 執行真實下單 */
export const runStockAutoTrading = async (env: any): Promise<void> => {
  console.log('🚀 [Stock Auto Trading] 開始執行美股代幣自動交易檢查...');
  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;
  const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
  const slackChannel = env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

  const strategy = getStrategy(STOCK_AUTO_TRADING_STRATEGY_ID);
  if (!strategy) {
    console.error(`🔥 [Stock Auto Trading] registry 缺少 ${STOCK_AUTO_TRADING_STRATEGY_ID} 策略,略過本輪`);
    return;
  }

  try {
    const allUsers = await db.select().from(users).all();
    // 只處理明確開啟自動交易、且 Bitget 三把金鑰齊全的使用者(預設關閉,不會意外啟用)
    const targetUsers = allUsers.filter(
      (u) => u.stockAutoTradingEnabled && !!u.bitgetApiKey && !!u.bitgetApiSecret && !!u.bitgetPassphrase
    );

    if (targetUsers.length === 0) {
      console.log('ℹ️ [Stock Auto Trading] 無使用者開啟自動交易,略過本輪');
      return;
    }

    for (const user of targetUsers) {
      const bgKey = await decryptData(user.bitgetApiKey!, masterKey);
      const bgSecret = await decryptData(user.bitgetApiSecret!, masterKey);
      const bgPassphrase = await decryptData(user.bitgetPassphrase!, masterKey);
      const isLive = user.tradingMode === 'LIVE';

      // 只取 market='US' 的交易紀錄,風控統計(日虧損/交易次數)與加密貨幣分開計算
      let userTrades = await db
        .select()
        .from(paperTrades)
        .where(and(eq(paperTrades.userId, user.id), eq(paperTrades.market, 'US')))
        .all();

      for (const stock of CRYPTO_STOCKS) {
        try {
          const { candles: rawCandles } = await fetchStockDailyHistory(stock.symbol, '2y');
          if (rawCandles.length < strategy.warmupBars + 10) continue;

          const candles: Candle[] = rawCandles;
          const indicators = new IndicatorCache(candles);
          const lastIndex = candles.length - 1;
          const currentPrice = candles[lastIndex].close;
          const bitgetSymbol = toBitgetStockSymbol(stock.symbol);

          const openTrade = userTrades.find((t) => t.symbol === bitgetSymbol && t.status === 'OPEN');
          const stopLossPrice = openTrade?.stopLossPrice ? parseFloat(openTrade.stopLossPrice) : null;
          const hitStopLoss = !!stopLossPrice && currentPrice <= stopLossPrice;

          const positionState: OpenPositionState | null = openTrade
            ? {
                side: 'LONG',
                entryPrice: parseFloat(openTrade.entryPrice),
                quantity: parseFloat(openTrade.amount),
                stopLossPrice,
                entryTime: new Date(openTrade.createdAt).getTime(),
              }
            : null;

          const action = strategy.evaluate({
            candles,
            index: lastIndex,
            indicators,
            position: positionState,
            params: { ...strategy.defaultParams },
          });

          const isEntrySignal = !openTrade && action.type === 'ENTRY' && action.side === 'LONG';
          const isExitSignal = !!openTrade && (action.type === 'EXIT' || hitStopLoss);

          // --- 進場 ---
          if (isEntrySignal) {
            const riskDecision = evaluateCapitalRisk({
              // 不傳 cryptoRegime:股票代幣不套用加密貨幣崩盤守衛
              isEntrySignal,
              isLive,
              symbol: bitgetSymbol,
              trades: userTrades,
              user,
            });

            if (!riskDecision.allowTrade) {
              console.warn(`🛡️ [Stock Risk Guard] ${stock.symbol} 已阻擋開倉: ${riskDecision.reason}`);
              continue;
            }

            const position = calculateRiskBasedPosition({
              capitalBaseUsdt: riskDecision.settings.capitalBaseUsdt,
              currentPrice,
              maxPositionSizePct: riskDecision.settings.maxPositionSizePct,
              maxRiskPerTradePct: riskDecision.settings.maxRiskPerTradePct,
              precision: BITGET_STOCK_TOKEN_PRECISION,
              stopLossPct: riskDecision.settings.riskStopLossPct,
              // 股票代幣最小下單額通常高於加密貨幣,以 Bitget rToken 常見門檻 10 USDT 為預設
              minNotionalUsdt: 10,
            });

            if (position.reason) {
              console.warn(`🛡️ [Stock Position Sizing] ${stock.symbol} 已阻擋開倉: ${position.reason}`);
              continue;
            }

            // PAPER 模式無測試下單端點,直接視為模擬成功;LIVE 才真的呼叫 Bitget
            const orderSuccess = isLive
              ? await placeBitgetMarketBuy(bitgetSymbol, position.notionalUsdt, bgKey, bgSecret, bgPassphrase)
              : true;

            if (orderSuccess) {
              const tradeValues = {
                userId: user.id,
                market: 'US',
                exchange: 'BITGET',
                symbol: bitgetSymbol,
                side: 'BUY',
                status: 'OPEN',
                mode: isLive ? 'LIVE' : 'PAPER',
                entryPrice: currentPrice.toString(),
                stopLossPrice: position.stopLossPrice.toString(),
                amount: position.quantity.toString(),
                reason: `[${strategy.id}/1d] ${action.type === 'ENTRY' ? action.reason : ''}, Risk: ${riskDecision.riskLevel}, SL: ${position.stopLossPrice.toFixed(4)}`,
              };

              await db.insert(paperTrades).values(tradeValues).run();
              userTrades.push({
                ...tradeValues,
                id: -Date.now(),
                exitPrice: null,
                pnl: null,
                createdAt: new Date().toISOString(),
                closedAt: null,
              } as any);

              if (slackToken && slackChannel) {
                const msg =
                  `*🪙 [美股代幣自動交易] 風控後買進觸發*\n\n` +
                  `✅ *[${isLive ? '🔥 實戰' : '🧪 模擬'} · BITGET]* 已買入\n` +
                  `• 商品：*${stock.name} (${bitgetSymbol})*\n` +
                  `• 價格：*$${currentPrice.toFixed(2)}*\n` +
                  `• 倉位：*${position.notionalUsdt.toFixed(2)} USDT* (${position.quantity} 股)\n` +
                  `• 預估單筆風險：*${position.riskUsdt.toFixed(2)} USDT*\n` +
                  `• 停損價：*$${position.stopLossPrice.toFixed(2)}*\n` +
                  `• 理由：${action.type === 'ENTRY' ? action.reason : ''}(日線,已收盤判定)\n` +
                  `_⚠️ 股票代幣為 Bitget 合成商品,價格緊貼真實股價但非交易所直接撮合,盤中流動性可能與真實股市不同。_`;
                await sendSlackMessage(slackToken, slackChannel, msg);
              }
            } else {
              console.warn(`⚠️ [Stock Auto Trading] ${bitgetSymbol} 下單失敗(可能休市或流動性不足),已略過`);
            }
          }

          // --- 出場 ---
          if (isExitSignal) {
            const sellQuantity = parseFloat(openTrade!.amount);
            const tradeIsLive = openTrade!.mode === 'LIVE';

            const orderSuccess = tradeIsLive
              ? await placeBitgetMarketSell(bitgetSymbol, sellQuantity, bgKey, bgSecret, bgPassphrase)
              : true;

            if (orderSuccess) {
              const entryPrice = parseFloat(openTrade!.entryPrice);
              const pnl = (currentPrice - entryPrice) * sellQuantity;
              await db
                .update(paperTrades)
                .set({
                  status: 'CLOSED',
                  exitPrice: currentPrice.toString(),
                  pnl: pnl.toFixed(2),
                  closedAt: new Date().toISOString(),
                })
                .where(eq(paperTrades.id, openTrade!.id))
                .run();
              userTrades = userTrades.map((t) =>
                t.id === openTrade!.id
                  ? { ...t, status: 'CLOSED', exitPrice: currentPrice.toString(), pnl: pnl.toFixed(2), closedAt: new Date().toISOString() }
                  : t
              );

              if (slackToken && slackChannel) {
                const pnlEmoji = pnl >= 0 ? '💰' : '📉';
                const exitReason = hitStopLoss ? '停損保護出場' : '均線回歸平倉';
                const msg =
                  `*${pnlEmoji} [美股代幣自動交易] ${exitReason}*\n\n` +
                  `✅ 已賣出 *${stock.name} (${bitgetSymbol})*\n` +
                  `• 績效：*${pnl.toFixed(2)} USDT*\n` +
                  `• 出場價：$${currentPrice.toFixed(2)}`;
                await sendSlackMessage(slackToken, slackChannel, msg);
              }
            } else {
              console.warn(`⚠️ [Stock Auto Trading] ${bitgetSymbol} 平倉失敗(可能休市或流動性不足),下輪再嘗試`);
            }
          }
        } catch (stockError) {
          console.error(`❌ [Stock Auto Trading] ${stock.symbol} 處理失敗:`, stockError);
        }
      }
    }

    console.log(`✅ [Stock Auto Trading] 本輪完成,共處理 ${targetUsers.length} 位使用者`);
  } catch (error) {
    console.error('🔥 [Stock Auto Trading] 執行失敗:', error);
  }
};
