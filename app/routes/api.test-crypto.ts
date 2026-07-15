import { type LoaderFunctionArgs } from "react-router";
import { evaluateCryptoStrategy } from "../services/stockService";
import { getAIResponse } from "../services/aiService";
import { sendSlackMessage } from "../services/slackService";
import { getUserId } from "../utils/auth";

/**
 * 【詳細繁體中文註解】：測試虛擬幣 AI 策略
 * 訪問此路由可手動觸發一次主流幣的趨勢掃描與 AI 分析
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;

    // 安全審查：限制必須登入後才能觸發
    const userId = await getUserId(request, env);
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol") || "BTCUSDT";
    
    console.log(`🧪 [Test Crypto] 開始測試 ${symbol}...`);

    const analysis = await evaluateCryptoStrategy(symbol, '4h');
    const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
    const slackChannel = env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

    if (analysis.signal === 'HOLD') {
      return Response.json({ 
        message: `${symbol} 目前無明確訊號 (HOLD)`,
        indicators: analysis.indicators 
      });
    }

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
    
    const slackMsg = `*🧪 [手動測試] ${signalColor} 虛擬幣 AI 趨勢預警*\n\n` +
      `💰 商品：*${symbol}*\n` +
      `📈 訊號：*${analysis.signal}*\n` +
      `📍 現價：$${analysis.price}\n` +
      `📝 理由：${analysis.reason}\n\n` +
      `💡 *AI 大師點評：*\n${aiAdvice}\n\n` +
      `_⚠️ 測試訊息，請勿直接作為交易依據。_`;

    if (slackToken && slackChannel) {
      await sendSlackMessage(slackToken, slackChannel, slackMsg);
    }

    return Response.json({ 
      message: "測試成功！訊號已發送至 Slack",
      signal: analysis.signal,
      aiAdvice: aiAdvice
    });

  } catch (error: any) {
    return Response.json({ error: "測試失敗", message: error.message }, { status: 500 });
  }
}
