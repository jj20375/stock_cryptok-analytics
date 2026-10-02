import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users, paperTrades } from "../db/schema";
import { decryptData } from "../utils/encryption";
import { getKlines } from "./binanceService";
import { placeCryptoBuyOrder, placeCryptoSellOrder, getExchangeCryptoPrecision, type CryptoExchange } from "./cryptoOrderRouter";
import { sendSlackMessage, sendSlackPost } from "./slackService";
import { createUsStockDailyCard, type UsDailyMacro, type UsDailyStrategySection } from "./slack/usStockDailyCard";
import { evaluateCryptoStrategy, fetchStockData, evaluateTrendMomentumData, evaluateConsecutiveVolumeData, evaluateVolumeNoBreakoutData } from "./stockService";
import { getStrategy } from "./strategy/registry";
import { IndicatorCache } from "./strategy/indicatorCache";
import type { Candle, OpenPositionState } from "./strategy/types";
import { getAIResponse } from "./aiService";
import { evaluateCryptoMarketRegime } from "./cryptoMarketRegime";
import { calculateRiskBasedPosition } from "./positionSizing";
import { evaluateCapitalRisk } from "./riskGuard";
import { getMacroIndicators } from "./macroService";
import { getTWStockChips } from "./chipService";

// 【詳細繁體中文註解】：定義支援的幣種及其數量精確度（Decimals，經 Binance stepSize 實測換算）
const SYMBOL_PRECISION: Record<string, number> = {
  'BTCUSDT': 5,
  'ETHUSDT': 4,
  'SOLUSDT': 2,
  'ADAUSDT': 1,
  'DOGEUSDT': 0,
  'XRPUSDT': 1,
  'SUIUSDT': 1,
  'AVAXUSDT': 2,
  'ICPUSDT': 2,
  'ZECUSDT': 3,
  'ASTERUSDT': 2,
};

const SYMBOLS = Object.keys(SYMBOL_PRECISION);

const truncateText = (text: string, maxLength = 120) => {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

type DailyStrategyMode = "trend" | "consecutive_volume" | "volume_no_break";

type DailyModeCandidate = {
  symbol: string;
  name: string;
  score: number;
  reason: string;
  trend: "up" | "down";
};

const DAILY_MODE_META: Record<DailyStrategyMode, {
  title: string;
  description: string;
  trendHint: string;
}> = {
  trend: {
    title: "多空趨勢強勢追蹤",
    description: "結合 RSI、MACD、KD 與均線位置，找出趨勢向上且仍保有回調切入空間的標的。",
    trendHint: "偏向順勢、找回調",
  },
  consecutive_volume: {
    title: "量能連續兩期以上放大",
    description: "鎖定成交量連續放大，代表資金持續關注與可能的主力吸籌。",
    trendHint: "偏向量能持續堆疊",
  },
  volume_no_break: {
    title: "量增但未突破前高",
    description: "觀察爆量後仍受前高壓制的標的，辨識洗盤、箱型與出貨壓力。",
    trendHint: "偏向區間整理與壓力觀察",
  },
};

const resolveSlackChannel = (env: any) => {
  return env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
};

/** 虛擬幣進出場與 AI 訊號改走獨立頻道；不 fallback 到股市日報頻道。 */
const resolveCryptoEntrySlackChannel = (env: any) => {
  return env.CRYPTO_ENTRY_SLACK_CHANNEL_ID || process.env.CRYPTO_ENTRY_SLACK_CHANNEL_ID;
};

const formatTopCandidates = (candidates: DailyModeCandidate[], emptyText: string) => {
  if (candidates.length === 0) return `> ${emptyText}`;

  return candidates.slice(0, 5).map((candidate, index) => {
    const trendLabel = candidate.trend === "up" ? "偏多" : "偏空";
    return `> ${index + 1}. *${candidate.name}* (${candidate.symbol}) ｜ 分數 *${candidate.score}* ｜ ${trendLabel}\n>   └ ${candidate.reason}`;
  }).join("\n");
};

const buildModeInsight = async (
  env: any,
  marketLabel: string,
  mode: DailyStrategyMode,
  candidates: DailyModeCandidate[]
) => {
  const meta = DAILY_MODE_META[mode];
  if (candidates.length === 0) {
    return "暫無明確候選，維持觀察即可。";
  }

  try {
    const prompt = `
你是一位資深${marketLabel}日報分析師。請針對「${meta.title}」這個策略模式，整理下面這批候選標的的共通點與風險。

市場：${marketLabel}
策略重點：${meta.description}
候選標的：
${JSON.stringify(candidates.slice(0, 5).map(item => ({
  symbol: item.symbol,
  name: item.name,
  score: item.score,
  reason: item.reason,
})), null, 2)}

請用繁體中文輸出 2 句短評：
1. 第一句總結這批標的最核心的共同特徵。
2. 第二句說明最值得追蹤的確認條件或風險。
字數控制在 120 字內，不要使用條列。
`;

    const aiText = await getAIResponse(prompt, {}, env);
    return truncateText(aiText?.trim() || "", 140) || "暫無明確候選，維持觀察即可。";
  } catch (error) {
    console.error(`❌ [Daily Mode Insight] ${mode} AI 摘要失敗:`, error);
    return "AI 摘要暫時無法產出，先以候選清單為主。";
  }
};

const scanDailyModes = async (symbols: any[], market: "TW" | "US") => {
  const scanLimit = Math.min(symbols.length, 15);
  const buckets: Record<DailyStrategyMode, DailyModeCandidate[]> = {
    trend: [],
    consecutive_volume: [],
    volume_no_break: [],
  };

  console.log(`🔍 [${market}] 開始掃描前 ${scanLimit} 檔候選，彙整 3 種模式...`);

  for (const stock of symbols.slice(0, scanLimit)) {
    try {
      const { data } = await fetchStockData(stock.symbol, 60, "1d");
      if (data.length < 20) continue;

      const trend = evaluateTrendMomentumData(data);
      const consecutiveVolume = evaluateConsecutiveVolumeData(data, 1.5);
      const volumeNoBreakout = evaluateVolumeNoBreakoutData(data, 1.5);

      let chipAddonReason = "";
      let chipScoreAdj = 0;

      // 【詳細繁體中文註解】
      // 若為台股市場，在技術分析觸發後進一步撈取證交所籌碼資料，進行綜合評估與評分加減
      if (market === "TW") {
        const chips = await getTWStockChips(stock.symbol);
        if (chips) {
          const fBuyK = Math.round(chips.foreignBuySell / 1000); // 換算成張數 (1張=1000股)
          const tBuyK = Math.round(chips.trustBuySell / 1000);
          
          if (chips.trustBuySell > 0 && chips.foreignBuySell > 0) {
            chipScoreAdj += 15;
            chipAddonReason = `【土洋共識】外資+${fBuyK}張、投信+${tBuyK}張`;
          } else if (chips.trustBuySell > 0) {
            chipScoreAdj += 10;
            chipAddonReason = `【投信鎖碼】投信+${tBuyK}張`;
          } else if (chips.foreignBuySell > 0) {
            chipScoreAdj += 5;
            chipAddonReason = `【外資買超】外資+${fBuyK}張`;
          }

          if (chips.shortMarginRatio > 25) {
            chipScoreAdj += 10;
            chipAddonReason += (chipAddonReason ? " ｜ " : "") + `【軋空潛力】券資比 ${chips.shortMarginRatio}%`;
          }

          if (chips.marginBalance > 20000 && chips.shortMarginRatio < 2) {
            // 融資餘額極高且券資比低，代表浮額重、融資摸底，扣分並警示
            chipScoreAdj -= 10;
            chipAddonReason += (chipAddonReason ? " ｜ " : "") + `【籌碼散亂】融資餘額 ${chips.marginBalance.toLocaleString()}張`;
          }
        }
      }

      if (trend.isTriggered) {
        buckets.trend.push({
          symbol: stock.symbol,
          name: stock.name,
          score: Math.min(100, Math.max(0, trend.score + chipScoreAdj)),
          reason: trend.reasons.join("、") + (chipAddonReason ? ` (${chipAddonReason})` : ""),
          trend: trend.trend,
        });
      }

      if (consecutiveVolume.isTriggered) {
        buckets.consecutive_volume.push({
          symbol: stock.symbol,
          name: stock.name,
          score: Math.min(100, Math.max(0, 50 + consecutiveVolume.consecutiveDays * 15 + chipScoreAdj)),
          reason: consecutiveVolume.reasons.join("、") + (chipAddonReason ? ` (${chipAddonReason})` : ""),
          trend: "up",
        });
      }

      if (volumeNoBreakout.isTriggered) {
        buckets.volume_no_break.push({
          symbol: stock.symbol,
          name: stock.name,
          score: Math.min(100, Math.max(0, 75 + chipScoreAdj)),
          reason: volumeNoBreakout.reasons.join("、") + (chipAddonReason ? ` (${chipAddonReason})` : ""),
          trend: "down",
        });
      }
    } catch (error) {
      console.error(`❌ [${market} Scan] ${stock.symbol} 掃描失敗:`, error);
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }

  (Object.keys(buckets) as DailyStrategyMode[]).forEach(mode => {
    buckets[mode] = buckets[mode]
      .sort((a, b) => b.score - a.score || b.symbol.localeCompare(a.symbol));
  });

  return buckets;
};

export const runStrategyEngine = async (env: any) => {
  console.log("🚀 [Strategy Engine] 開始執行 crypto 定時策略檢查...");
  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;

  try {
    const allUsers = await db.select().from(users).all();
    // 【詳細繁體中文註解】：依使用者偏好的交易所篩選具備完整金鑰的使用者。
    // BITGET 額外需要 passphrase(Bitget 簽名機制的第三把鑰匙,Binance 沒有)。
    const targetUsers = allUsers.filter(u => {
      const exchange = (u.preferredExchange || 'BINANCE') as CryptoExchange;
      if (exchange === 'BITGET') {
        return !!u.bitgetApiKey && !!u.bitgetApiSecret && !!u.bitgetPassphrase;
      }
      return !!u.binanceApiKey && !!u.binanceApiSecret;
    });

    for (const user of targetUsers) {
      const userTimeframe = user.strategyTimeframe || '15m';
      let userTrades = await db.select()
        .from(paperTrades)
        .where(eq(paperTrades.userId, user.id))
        .all();

      // 【詳細繁體中文註解】：主策略改由 strategy registry 取得(與回測引擎共用同一份 evaluate),
      // 確保「回測驗證的邏輯」與「實際下單的邏輯」永遠一致,不再各寫一套。
      const strategy = getStrategy("rsi_mean_reversion");
      if (!strategy) {
        console.error("🔥 [Strategy Engine] registry 缺少 rsi_mean_reversion 策略,跳過本輪");
        continue;
      }

      for (const symbol of SYMBOLS) {
        try {
          const klines = await getKlines(symbol, userTimeframe as any, 100);
          if (klines.length < strategy.warmupBars + 2) continue;

          // 轉為策略抽象層的 Candle 格式
          const candles: Candle[] = klines.map(k => ({
            openTime: k.openTime,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
          }));

          // 重要行為變更(與回測對齊):以「最後一根已收盤 K 線」評估訊號,
          // 不再使用進行中的 K 線 — 訊號時點會比舊版晚一根,但可與回測結果精確對帳。
          const evalIndex = candles.length - 2;
          // 停損與即時出場仍使用「當下最新價」(進行中 K 線收盤價),保持風控即時性
          const currentPrice = candles[candles.length - 1].close;
          const indicators = new IndicatorCache(candles);

          const openTrade = userTrades.find(trade => trade.symbol === symbol && trade.status === "OPEN");
          const stopLossPrice = openTrade?.stopLossPrice ? parseFloat(openTrade.stopLossPrice) : null;
          const hitStopLoss = !!stopLossPrice && currentPrice <= stopLossPrice;

          // 以目前持倉狀態組出策略上下文(有倉 → 評估出場;空手 → 評估進場)
          const positionState: OpenPositionState | null = openTrade
            ? {
                side: "LONG",
                entryPrice: parseFloat(openTrade.entryPrice),
                quantity: parseFloat(openTrade.amount),
                stopLossPrice,
                entryTime: new Date(openTrade.createdAt).getTime(),
              }
            : null;

          const action = strategy.evaluate({
            candles,
            index: evalIndex,
            indicators,
            position: positionState,
            params: { ...strategy.defaultParams },
          });

          const isEntrySignal = !openTrade && action.type === "ENTRY" && action.side === "LONG";
          // 出場:策略訊號出場(均線回歸)或觸及停損(停損由引擎以最新價即時判斷)
          const isExitSignal = !!openTrade && (action.type === "EXIT" || hitStopLoss);

          // 【詳細繁體中文註解】：依使用者偏好交易所解密對應金鑰組(Bitget 多一把 passphrase)
          const exchange = (user.preferredExchange || 'BINANCE') as CryptoExchange;
          const credentials = exchange === 'BITGET'
            ? {
                apiKey: await decryptData(user.bitgetApiKey!, masterKey),
                apiSecret: await decryptData(user.bitgetApiSecret!, masterKey),
                passphrase: await decryptData(user.bitgetPassphrase!, masterKey),
              }
            : {
                apiKey: await decryptData(user.binanceApiKey!, masterKey),
                apiSecret: await decryptData(user.binanceApiSecret!, masterKey),
              };

          const isLive = user.tradingMode === "LIVE";
          const precision = getExchangeCryptoPrecision(exchange, symbol, SYMBOL_PRECISION);

          // 取得 Slack 設定 (支援虛擬幣專用頻道分流)
          const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
          const slackChannel = resolveCryptoEntrySlackChannel(env);

          if (!openTrade && isEntrySignal) {
            const cryptoRegime = await evaluateCryptoMarketRegime(symbol);
            const riskDecision = evaluateCapitalRisk({
              cryptoRegime,
              isEntrySignal,
              isLive,
              symbol,
              trades: userTrades,
              user,
            });

            if (!riskDecision.allowTrade) {
              console.warn(`🛡️ [Risk Guard] ${symbol} 已阻擋開倉: ${riskDecision.reason}`);
              if (slackToken && slackChannel) {
                const msg = `*🛡️ [本金保護] 已阻擋虛擬幣開倉*\n\n` +
                  `• 商品：*${symbol}*\n` +
                  `• 風險等級：*${riskDecision.riskLevel}*\n` +
                  `• 原因：${riskDecision.reason}\n` +
                  `• 今日損益：${riskDecision.stats.dailyPnL.toFixed(2)} USDT\n` +
                  `• 持倉數：${riskDecision.stats.openPositions}/${riskDecision.settings.maxOpenPositions}`;
                await sendSlackMessage(slackToken, slackChannel, msg);
              }
              continue;
            }

            const position = calculateRiskBasedPosition({
              capitalBaseUsdt: riskDecision.settings.capitalBaseUsdt,
              currentPrice,
              maxPositionSizePct: riskDecision.riskLevel === "MEDIUM"
                ? riskDecision.settings.maxPositionSizePct * 0.5
                : riskDecision.settings.maxPositionSizePct,
              maxRiskPerTradePct: riskDecision.riskLevel === "MEDIUM"
                ? riskDecision.settings.maxRiskPerTradePct * 0.5
                : riskDecision.settings.maxRiskPerTradePct,
              precision,
              stopLossPct: riskDecision.settings.riskStopLossPct,
            });

            if (position.reason) {
              console.warn(`🛡️ [Position Sizing] ${symbol} 已阻擋開倉: ${position.reason}`);
              continue;
            }

            const orderSuccess = await placeCryptoBuyOrder(
              exchange,
              symbol,
              position.quantity,
              currentPrice,
              isLive,
              credentials
            );

            if (orderSuccess) {
              const tradeValues = {
                userId: user.id,
                symbol: symbol,
                side: "BUY",
                status: "OPEN",
                mode: isLive ? "LIVE" : "PAPER",
                exchange,
                entryPrice: currentPrice.toString(),
                stopLossPrice: position.stopLossPrice.toString(),
                amount: position.quantity.toString(),
                reason: `[${strategy.id}/${userTimeframe}/${exchange}] ${action.type === "ENTRY" ? action.reason : ""}, Risk: ${riskDecision.riskLevel}, SL: ${position.stopLossPrice.toFixed(4)}`
              };

              await db.insert(paperTrades).values({
                ...tradeValues,
              }).run();
              userTrades.push({
                ...tradeValues,
                id: -Date.now(),
                exitPrice: null,
                pnl: null,
                createdAt: new Date().toISOString(),
                closedAt: null,
              } as any);

              // 改發送到 Slack
              if (slackToken && slackChannel) {
                const msg = `*🚨 [虛擬幣] 風控後抄底觸發*\n\n` +
                  `✅ *[${isLive ? "🔥 實戰" : "🧪 模擬"} · ${exchange}]* 已買入\n` +
                  `• 商品：*${symbol}*\n` +
                  `• 價格：*$${currentPrice}*\n` +
                  `• 倉位：*${position.notionalUsdt.toFixed(2)} USDT* (${position.quantity})\n` +
                  `• 預估單筆風險：*${position.riskUsdt.toFixed(2)} USDT*\n` +
                  `• 停損價：*$${position.stopLossPrice.toFixed(4)}*\n` +
                  `• 風控：${riskDecision.reason}\n` +
                  `• 理由：${action.type === "ENTRY" ? action.reason : ""}(${userTimeframe},已收盤 K 線判定)`;
                await sendSlackMessage(slackToken, slackChannel, msg);
              }
            }
          }

          if (openTrade && isExitSignal) {
            const sellQuantity = parseFloat(openTrade.amount);
            const tradeIsLive = openTrade.mode === "LIVE";
            // 【詳細繁體中文註解】：平倉必須用「開倉當時記錄的交易所」,而非使用者當下的偏好設定 —
            // 避免持倉期間切換偏好交易所後,把賣單誤送到從未真正持倉的交易所。
            const tradeExchange = (openTrade.exchange || 'BINANCE') as CryptoExchange;
            let tradeCredentials = credentials;
            if (tradeExchange !== exchange) {
              // 開倉當時用的交易所金鑰,和使用者目前偏好的交易所不同 → 需另外解密對應金鑰組
              const hasKeys = tradeExchange === 'BITGET'
                ? !!user.bitgetApiKey && !!user.bitgetApiSecret && !!user.bitgetPassphrase
                : !!user.binanceApiKey && !!user.binanceApiSecret;

              if (!hasKeys) {
                console.warn(`⚠️ [Strategy Engine] ${symbol} 開倉於 ${tradeExchange},但使用者已移除該交易所金鑰,無法送出平倉單`);
                continue;
              }

              tradeCredentials = tradeExchange === 'BITGET'
                ? {
                    apiKey: await decryptData(user.bitgetApiKey!, masterKey),
                    apiSecret: await decryptData(user.bitgetApiSecret!, masterKey),
                    passphrase: await decryptData(user.bitgetPassphrase!, masterKey),
                  }
                : {
                    apiKey: await decryptData(user.binanceApiKey!, masterKey),
                    apiSecret: await decryptData(user.binanceApiSecret!, masterKey),
                  };
            }

            const orderSuccess = await placeCryptoSellOrder(
              tradeExchange,
              symbol,
              sellQuantity,
              tradeIsLive,
              tradeCredentials
            );

            if (orderSuccess) {
              const entryPrice = parseFloat(openTrade.entryPrice);
              const pnl = (currentPrice - entryPrice) * sellQuantity;
              await db.update(paperTrades)
                .set({ status: "CLOSED", exitPrice: currentPrice.toString(), pnl: pnl.toFixed(2), closedAt: new Date().toISOString() })
                .where(eq(paperTrades.id, openTrade.id)).run();
              userTrades = userTrades.map(trade =>
                trade.id === openTrade.id
                  ? { ...trade, status: "CLOSED", exitPrice: currentPrice.toString(), pnl: pnl.toFixed(2), closedAt: new Date().toISOString() }
                  : trade
              );

              // 改發送到 Slack
              if (slackToken && slackChannel) {
                const pnlEmoji = pnl >= 0 ? "💰" : "📉";
                const exitReason = hitStopLoss ? "停損保護出場" : "均線回歸平倉";
                const msg = `*${pnlEmoji} [虛擬幣] ${exitReason}*\n\n✅ 已賣出 *${symbol}*\n• 績效：*${pnl.toFixed(2)} USDT*\n• 出場價：$${currentPrice}`;
                await sendSlackMessage(slackToken, slackChannel, msg);
              }
            }
          }
        } catch (symbolErr) {}
      }
    }
  } catch (error) {
    console.error("🔥 [Strategy Engine] 執行失敗:", error);
  }

  // --- 主流幣 AI 趨勢掃描 (做多/做空) ---
  try {
    console.log("🔍 [Crypto AI Scan] 開始掃描主流幣趨勢...");
    // 【詳細繁體中文註解】：擴展後的監控清單，包含 ADA, ZEC, SUI, ASTR
    const cryptoSymbols = [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 
      'ADAUSDT', 'ZECUSDT', 'SUIUSDT', 'ASTRUSDT'
    ];
    const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
    const slackChannel = resolveCryptoEntrySlackChannel(env);

    for (const symbol of cryptoSymbols) {
      const analysis = await evaluateCryptoStrategy(symbol, '4h');
      
      // 只有當出現明確訊號 (LONG/SHORT) 時才發送
      if (analysis.signal !== 'HOLD' && slackToken && slackChannel) {
        const signalColor = analysis.signal === 'LONG' ? '🟢 [做多 Long]' : '🔴 [做空 Short]';
        const prompt = `
          你是一位專業的虛擬幣交易大師。目前 ${symbol} 在 4 小時線出現了 ${analysis.signal} 訊號。
          技術指標如下：
          - 當前價格: ${analysis.price}
          - 觸發理由: ${analysis.reason}
          - RSI: ${analysis.indicators.rsi}
          - MACD 柱狀圖: ${analysis.indicators.macdHist}
          - 趨勢狀態: ${analysis.indicators.trend}

          請根據以上數據，提供一段簡短的「大師點評」(100字內)，包含：
          1. 建議的進場區間
          2. 止損價位 (SL)
          3. 短線目標價位 (TP)
          4. 一句話風險提醒
        `;

        const aiAdvice = await getAIResponse(prompt, {}, env);
        
        const slackMsg = `*${signalColor} 虛擬幣 AI 趨勢預警*\n\n` +
          `💰 商品：*${symbol}*\n` +
          `📈 訊號：*${analysis.signal}*\n` +
          `📍 現價：$${analysis.price}\n` +
          `📝 理由：${analysis.reason}\n\n` +
          `💡 *AI 大師點評：*\n${aiAdvice}\n\n` +
          `_⚠️ 虛擬幣波動大，請務必嚴格執行止損。_`;

        await sendSlackMessage(slackToken, slackChannel, slackMsg);
        console.log(`✅ [Crypto AI Scan] 已發送 ${symbol} 訊號至 Slack`);
      }
    }
  } catch (error) {
    console.error("🔥 [Crypto AI Scan] 執行失敗:", error);
  }

};

/**
 * 【詳細繁體中文註解】：抓取美股熱門標的 (最活躍與漲幅領先)
 */
export const fetchUSMarketMovers = async (): Promise<any[]> => {
  try {
    const urls = [
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=most_actives",
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers"
    ];
    
    let allSymbols: any[] = [];
    for (const url of urls) {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.ok) {
        const json: any = await res.json();
        const quotes = json.finance?.result?.[0]?.quotes || [];
        allSymbols = [...allSymbols, ...quotes];
      }
    }

    const seen = new Set();
    return allSymbols
      .filter(q => {
        if (!q.symbol || seen.has(q.symbol)) return false;
        seen.add(q.symbol);
        return true;
      })
      .map(q => ({
        symbol: q.symbol,
        name: q.shortName || q.symbol,
        price: q.regularMarketPrice,
        changePercent: q.regularMarketChangePercent,
        volume: q.regularMarketVolume
      }))
      .sort((a, b) => b.volume - a.volume);
  } catch (error) {
    console.error("❌ [fetchUSMarketMovers] 失敗:", error);
    return [];
  }
};

/**
 * 【詳細繁體中文註解】：執行每日股票日報 (支援 TW/US 與 分階段執行)
 * @param market 市場類型 ("TW" | "US")
 * @param type 報告類型 ("market" 市場摘要 | "strategy" 深度掃描)
 */
export const runStockDailyStrategy = async (env: any, market: "TW" | "US" = "TW", type: "market" | "strategy" = "market") => {
  console.log(`🚀 [Daily Report] 開始執行 - 市場: ${market}, 階段: ${type}`);
  const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
  const slackChannel = resolveSlackChannel(env);
  if (!slackToken || !slackChannel) return;

  try {
    let symbols: any[] = [];
    
    if (market === "TW") {
      const twseUrl = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALL&_=${Date.now()}`;
      const response = await fetch(twseUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      const data: any = await response.json();
      const raw = data.tables?.find((t: any) => t.title?.includes("每日收盤行情"))?.data || data.data9 || data.data8 || [];
      symbols = raw.filter((row: any) => row[0]?.length >= 4 && row[0]?.length <= 6)
        .map((row: any) => {
          const price = parseFloat(row[8]?.replace(/,/g, "") || "0");
          const changeDiff = parseFloat(row[10]?.replace(/,/g, "") || "0");
          const signStr = row[9] || "";
          const sign = signStr.includes('plus') || signStr.includes('+') || signStr.includes('▲') ? 1 : 
                      (signStr.includes('minus') || signStr.includes('-') || signStr.includes('▼') ? -1 : 0);
          return {
            symbol: row[0] + ".TW",
            name: row[1],
            volume: parseInt(row[2]?.replace(/,/g, "") || "0"),
            price,
            changePercent: parseFloat((((price - (sign * changeDiff)) > 0 ? (sign * changeDiff / (price - (sign * changeDiff))) : 0) * 100).toFixed(2))
          };
        }).sort((a: any, b: any) => b.volume - a.volume);
    } else {
      symbols = await fetchUSMarketMovers();
    }

    if (symbols.length === 0) return;

    const dateStr = new Date().toLocaleDateString('zh-TW');
    const marketLabel = market === "TW" ? "台股" : "美股";
    const topGainers = [...symbols].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
    const mostActive = [...symbols].sort((a, b) => b.volume - a.volume).slice(0, 5);
    let slackMsg = `*📅 ${marketLabel}${type === "market" ? "市場日報" : "AI 三模式策略日報"} (${dateStr})*\n`;
    let macroCard: UsDailyMacro | null = null;
    let strategyCardSections: UsDailyStrategySection[] = [];

    // 【詳細繁體中文註解】：引入全域總經債券參考風向球
    try {
      const macro = await getMacroIndicators();
      if (macro) {
        macroCard = {
          riskState: macro.regime.riskState,
          reason: macro.regime.reason,
          us10y: `${macro.us10y.value.toFixed(3)}% · ${macro.us10y.trend}`,
          dxy: `${macro.dxy.value.toFixed(3)} · ${macro.dxy.trend}`,
          vix: `${macro.vix.value.toFixed(2)} · ${macro.vix.trend}`,
          yieldSpread: `${macro.spreads.yieldSpread10Y3M.toFixed(3)}%${macro.spreads.yieldSpread10Y3M < 0 ? " · 殖利率倒掛" : ""}`,
        };
        slackMsg += `\n*🌍 全球總經債券風向球 (${macro.regime.riskState})*\n`;
        slackMsg += `> 美債 10Y 殖利率: *${macro.us10y.value.toFixed(3)}%* (10日均線: ${macro.us10y.ma10.toFixed(3)}% 趨勢: ${macro.us10y.trend})\n`;
        slackMsg += `> 美元指數 (DXY): *${macro.dxy.value.toFixed(3)}* (10日均線: ${macro.dxy.ma10.toFixed(3)} 趨勢: ${macro.dxy.trend})\n`;
        slackMsg += `> VIX 恐慌指數: *${macro.vix.value.toFixed(2)}* (10日均線: ${macro.vix.ma10.toFixed(2)} 趨勢: ${macro.vix.trend})\n`;
        slackMsg += `> 美債 10Y-3M 利差: *${macro.spreads.yieldSpread10Y3M.toFixed(3)}%* ${macro.spreads.yieldSpread10Y3M < 0 ? "⚠️ [殖利率倒掛]" : ""}\n`;
        slackMsg += `> 宏觀風控狀態: _${macro.regime.reason}_\n`;
        slackMsg += `-------------------------------------------\n`;
      }
    } catch (err) {
      console.error("[StrategyEngine] 整合總經日報失敗:", err);
    }

    if (type === "market") {
      slackMsg += `\n*1) 盤面概覽*\n`;
      slackMsg += `> 漲幅領先：*${topGainers[0]?.name || "N/A"}* (${topGainers[0]?.symbol || "-"})\n`;
      slackMsg += `> 交投活躍：*${mostActive[0]?.name || "N/A"}* (${mostActive[0]?.symbol || "-"})\n`;

      slackMsg += `\n*2) 漲幅領先 Top 5*\n`;
      topGainers.forEach((s, i) => 
        slackMsg += `> ${i+1}. *${s.name}* (${s.symbol})  漲幅: *+${s.changePercent}%*\n`
      );

      slackMsg += `\n*3) 交投活躍 Top 5*\n`;
      mostActive.forEach((s, i) => 
        slackMsg += `> ${i+1}. *${s.name}* (${s.symbol})  量: ${s.volume.toLocaleString()}\n`
      );
    } else {
      const modeBuckets = await scanDailyModes(symbols, market);
      const trendInsight = await buildModeInsight(env, marketLabel, "trend", modeBuckets.trend);
      const consecutiveInsight = await buildModeInsight(env, marketLabel, "consecutive_volume", modeBuckets.consecutive_volume);
      const volumeNoBreakInsight = await buildModeInsight(env, marketLabel, "volume_no_break", modeBuckets.volume_no_break);
      strategyCardSections = [
        { title: DAILY_MODE_META.trend.title, trendHint: DAILY_MODE_META.trend.trendHint,
          insight: trendInsight, candidates: modeBuckets.trend },
        { title: DAILY_MODE_META.consecutive_volume.title, trendHint: DAILY_MODE_META.consecutive_volume.trendHint,
          insight: consecutiveInsight, candidates: modeBuckets.consecutive_volume },
        { title: DAILY_MODE_META.volume_no_break.title, trendHint: DAILY_MODE_META.volume_no_break.trendHint,
          insight: volumeNoBreakInsight, candidates: modeBuckets.volume_no_break },
      ];

      slackMsg += `\n*1) 盤面概覽*\n`;
      slackMsg += `> 漲幅領先：*${topGainers[0]?.name || "N/A"}* (${topGainers[0]?.symbol || "-"})\n`;
      slackMsg += `> 交投活躍：*${mostActive[0]?.name || "N/A"}* (${mostActive[0]?.symbol || "-"})\n`;

      slackMsg += `\n*2) ${DAILY_MODE_META.trend.title}*\n`;
      slackMsg += `${formatTopCandidates(modeBuckets.trend, "暫無符合的趨勢型候選")}\n`;
      slackMsg += `> AI 觀察：${trendInsight}\n`;
      slackMsg += `> 策略特性：${DAILY_MODE_META.trend.trendHint}\n`;

      slackMsg += `\n*3) ${DAILY_MODE_META.consecutive_volume.title}*\n`;
      slackMsg += `${formatTopCandidates(modeBuckets.consecutive_volume, "暫無連續爆量候選")}\n`;
      slackMsg += `> AI 觀察：${consecutiveInsight}\n`;
      slackMsg += `> 策略特性：${DAILY_MODE_META.consecutive_volume.trendHint}\n`;

      slackMsg += `\n*4) ${DAILY_MODE_META.volume_no_break.title}*\n`;
      slackMsg += `${formatTopCandidates(modeBuckets.volume_no_break, "暫無量增未破前高候選")}\n`;
      slackMsg += `> AI 觀察：${volumeNoBreakInsight}\n`;
      slackMsg += `> 策略特性：${DAILY_MODE_META.volume_no_break.trendHint}\n`;
    }

    if (slackMsg) {
      slackMsg += `\n_💡 投資有風險，僅供參考。_`;
      if (market === "US") {
        /** 美股日報以 Block Kit 分區顯示；fallback text 保留手機推播摘要，發送目的地仍是原股票日報頻道。 */
        await sendSlackPost(slackToken, slackChannel, createUsStockDailyCard({
          date: dateStr, type, topGainers, mostActive, macro: macroCard, strategySections: strategyCardSections,
        }));
      } else {
        await sendSlackMessage(slackToken, slackChannel, slackMsg);
      }
    }
  } catch (error) {
    console.error(`🔥 [runStockDailyStrategy] ${market} 執行失敗:`, error);
  }
};
