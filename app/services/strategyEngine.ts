import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { users, paperTrades } from "../db/schema";
import { decryptData } from "../utils/encryption";
import { getKlines, placeTestOrder } from "./binanceService";
import { sendTelegramMessage } from "./telegramService";
import { sendSlackMessage } from "./slackService";
import { calculateRSI, calculateMA, evaluateDailyVolumeSurge, evaluateBigFishStrategy, evaluatePerfectOrder, evaluateCryptoStrategy, evaluateVolumeNoPriceRise } from "./stockService";
import { getAIResponse } from "./aiService";

// 每次模擬下單的 USDT 金額
const SIMULATED_USDT_AMOUNT = 100;

// 【詳細繁體中文註解】：定義支援的幣種及其數量精確度（Decimals）
const SYMBOL_PRECISION: Record<string, number> = {
  'BTCUSDT': 5,
  'ETHUSDT': 4,
  'SOLUSDT': 2,
  'ADAUSDT': 1,
  'DOGEUSDT': 0,
  'XRPUSDT': 1,
  'SUIUSDT': 1,
  'AVAXUSDT': 2,
};

const SYMBOLS = Object.keys(SYMBOL_PRECISION);

export const runStrategyEngine = async (env: any) => {
  console.log("🚀 [Strategy Engine] 開始執行定時策略檢查...");
  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;

  try {
    const allUsers = await db.select().from(users).all();
    const targetUsers = allUsers.filter(u => !!u.binanceApiKey && !!u.binanceApiSecret);
    
    for (const user of targetUsers) {
      const userTimeframe = user.strategyTimeframe || '15m';
      for (const symbol of SYMBOLS) {
        try {
          const klines = await getKlines(symbol, userTimeframe as any, 100);
          if (klines.length < 20) continue;

          const prices = klines.map(k => k.close);
          const currentPrice = prices[prices.length - 1];
          const rsiList = calculateRSI(prices, 14);
          const ma20List = calculateMA(prices, 20);
          const currentRSI = rsiList[rsiList.length - 1];
          const currentMA20 = ma20List[ma20List.length - 1];

          const isEntrySignal = currentRSI < 20 && currentPrice < currentMA20 * 0.90;
          const isExitSignal = currentPrice >= currentMA20;

          const openTrade = await db.select()
            .from(paperTrades)
            .where(and(
              eq(paperTrades.userId, user.id),
              eq(paperTrades.symbol, symbol),
              eq(paperTrades.status, "OPEN")
            ))
            .get();

          const apiKey = await decryptData(user.binanceApiKey!, masterKey);
          const apiSecret = await decryptData(user.binanceApiSecret!, masterKey);
          const telegramToken = user.telegramBotToken ? await decryptData(user.telegramBotToken, masterKey) : null;
          const telegramChatId = user.telegramChatId ? await decryptData(user.telegramChatId, masterKey) : null;

          const isLive = user.tradingMode === "LIVE";
          const precision = SYMBOL_PRECISION[symbol] || 2;
          const tradeQuantity = parseFloat((SIMULATED_USDT_AMOUNT / currentPrice).toFixed(precision));

          // 取得 Slack 設定 (支援虛擬幣專用頻道分流)
          const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
          const slackChannel = env.SLACK_CRYPTO_CHANNEL_ID || env.SLACK_CHANNEL_ID || process.env.SLACK_CRYPTO_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

          if (!openTrade && isEntrySignal) {
            let orderSuccess = false;
            if (isLive) {
              const { placeRealOrder } = await import('./binanceService');
              orderSuccess = await placeRealOrder(symbol, "BUY", tradeQuantity, apiKey, apiSecret);
            } else {
              orderSuccess = await placeTestOrder(symbol, "BUY", tradeQuantity, apiKey, apiSecret);
            }
            
            if (orderSuccess) {
              await db.insert(paperTrades).values({
                userId: user.id,
                symbol: symbol,
                side: "BUY",
                status: "OPEN",
                mode: isLive ? "LIVE" : "PAPER",
                entryPrice: currentPrice.toString(),
                amount: tradeQuantity.toString(),
                reason: `RSI(${userTimeframe}): ${currentRSI.toFixed(2)}, MA20: ${currentMA20.toFixed(2)}`
              }).run();

              // 改發送到 Slack
              if (slackToken && slackChannel) {
                const msg = `*🚨 [虛擬幣] 極度恐慌抄底觸發*\n\n✅ *[${isLive ? "🔥 實戰" : "🧪 模擬"}]* 已買入\n• 商品：*${symbol}*\n• 價格：*$${currentPrice}*\n• 理由：${userTimeframe} RSI 超賣 (${currentRSI.toFixed(2)})`;
                await sendSlackMessage(slackToken, slackChannel, msg);
              }
            }
          }

          if (openTrade && isExitSignal) {
            const sellQuantity = parseFloat(openTrade.amount);
            let orderSuccess = false;
            const tradeIsLive = openTrade.mode === "LIVE";

            if (tradeIsLive) {
              const { placeRealOrder } = await import('./binanceService');
              orderSuccess = await placeRealOrder(symbol, "SELL", sellQuantity, apiKey, apiSecret);
            } else {
              orderSuccess = await placeTestOrder(symbol, "SELL", sellQuantity, apiKey, apiSecret);
            }

            if (orderSuccess) {
              const entryPrice = parseFloat(openTrade.entryPrice);
              const pnl = (currentPrice - entryPrice) * sellQuantity;
              await db.update(paperTrades)
                .set({ status: "CLOSED", exitPrice: currentPrice.toString(), pnl: pnl.toFixed(2), closedAt: new Date().toISOString() })
                .where(eq(paperTrades.id, openTrade.id)).run();

              // 改發送到 Slack
              if (slackToken && slackChannel) {
                const pnlEmoji = pnl >= 0 ? "💰" : "📉";
                const msg = `*${pnlEmoji} [虛擬幣] 均線回歸平倉*\n\n✅ 已賣出 *${symbol}*\n• 績效：*${pnl.toFixed(2)} USDT*\n• 出場價：$${currentPrice}`;
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
    const slackChannel = env.SLACK_CRYPTO_CHANNEL_ID || env.SLACK_CHANNEL_ID || process.env.SLACK_CRYPTO_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

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

  // --- 日報任務分流 (台北時間) ---
  try {
    const now = new Date();
    const taipeiFormatter = new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    
    const parts = taipeiFormatter.formatToParts(now);
    const hours = parseInt(parts.find(p => p.type === "hour")?.value || "0");
    const minutes = parseInt(parts.find(p => p.type === "minute")?.value || "0");
    
    console.log(`🕒 [Time Check] 台北時間: ${hours}:${minutes}`);

    // 【台股】
    if (hours === 15 && minutes === 0) {
      await runStockDailyStrategy(env, "TW", "market");
    } else if (hours === 15 && minutes === 15) {
      await runStockDailyStrategy(env, "TW", "strategy");
    }
    
    // 【美股】
    if (hours === 4 && minutes === 30) {
      await runStockDailyStrategy(env, "US", "market");
    } else if (hours === 4 && minutes === 45) {
      await runStockDailyStrategy(env, "US", "strategy");
    }

  } catch (error) {
    console.error("🔥 [Strategy Engine] 日報分流執行失敗:", error);
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
  const slackChannel = env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
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
    let slackMsg = "";

    if (type === "market") {
      slackMsg += `*📅 ${marketLabel}市場每日摘要 (${dateStr})*\n\n`;
      slackMsg += `*🔥 漲幅領先 (Top Gainers)*\n`;
      [...symbols].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5).forEach((s, i) => 
        slackMsg += `> ${i+1}. *${s.name}* (${s.symbol})  漲幅: *+${s.changePercent}%*\n`
      );
      slackMsg += `\n*📊 交投活躍 (Most Active)*\n`;
      symbols.slice(0, 5).forEach((s, i) => 
        slackMsg += `> ${i+1}. *${s.name}* (${s.symbol})  量: ${s.volume.toLocaleString()}\n`
      );
    } else {
      // 深度策略掃描 (限制數量以符合 50 次子請求限制)
      const scanLimit = 15; 
      const surgeStocks = [];
      const bigFishSignals = [];
      const perfectOrderStocks = [];
      const volumeUpPriceFlatStocks = [];

      console.log(`🔍 [${marketLabel} Scan] 正在掃描前 ${scanLimit} 檔...`);
      for (const s of symbols.slice(0, scanLimit)) {
        try {
          const [surge, bigFish, perfect, volFlat] = await Promise.all([
            evaluateDailyVolumeSurge(s.symbol),
            evaluateBigFishStrategy(s.symbol, '1h'),
            evaluatePerfectOrder(s.symbol),
            evaluateVolumeNoPriceRise(s.symbol)
          ]);

          if (surge.isSurge) surgeStocks.push({ ...s, multiple: surge.multiple });
          if (bigFish.isEntry) bigFishSignals.push({ ...s, reason: bigFish.reason, price: bigFish.price });
          if (perfect.isPerfect) perfectOrderStocks.push({ ...s });
          if (volFlat.isTriggered) volumeUpPriceFlatStocks.push({ ...s, multiple: volFlat.multiple });
          
          // 稍微停頓
          await new Promise(r => setTimeout(r, 50));
        } catch (err) {
          console.error(`❌ [Scan Error] ${s.symbol}:`, err);
        }
      }

      slackMsg += `*🐳 ${marketLabel}策略深度分析 (${dateStr})*\n\n`;
      
      slackMsg += `*🐳 吃大魚訊號 (1H)*\n`;
      bigFishSignals.length > 0 
        ? bigFishSignals.forEach(s => slackMsg += `> 💎 ${s.name} - ${s.reason}\n`) 
        : slackMsg += `> 暫無顯著訊號\n`;
      
      slackMsg += `\n*🚀 強勢爆量股*\n`;
      surgeStocks.length > 0 
        ? surgeStocks.sort((a, b) => b.multiple - a.multiple).slice(0, 8).forEach(s => slackMsg += `> 📈 ${s.name} - 爆量 *${s.multiple.toFixed(1)}* 倍\n`) 
        : slackMsg += `> 暫無顯著標的\n`;

      slackMsg += `\n*🧱 量增價平 (主力蓄勢股)*\n`;
      volumeUpPriceFlatStocks.length > 0 
        ? volumeUpPriceFlatStocks.sort((a, b) => b.multiple - a.multiple).slice(0, 8).forEach(s => slackMsg += `> 🧱 ${s.name} - 量增 *${s.multiple.toFixed(1)}* 倍\n`) 
        : slackMsg += `> 暫無顯著標的\n`;
    }

    if (slackMsg) {
      slackMsg += `\n_💡 投資有風險，僅供參考。_`;
      await sendSlackMessage(slackToken, slackChannel, slackMsg);
    }
  } catch (error) {
    console.error(`🔥 [runStockDailyStrategy] ${market} 執行失敗:`, error);
  }
};
