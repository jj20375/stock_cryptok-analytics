import { type LoaderFunctionArgs } from "react-router";
import { sendSlackMessage } from "../services/slackService";

/**
 * 【詳細繁體中文註解】：Slack 整合測試接口 (升級版)
 * 支援測試預設頻道與虛擬幣專用頻道
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type"); // 'crypto' or null

  try {
    const env = (context.cloudflare as any)?.env || process.env;
    const slackToken = env.SLACK_API_TOKEN || process.env.SLACK_API_TOKEN;
    
    // 根據參數決定頻道 ID
    let slackChannel = env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
    let channelName = "預設頻道";

    if (type === "crypto") {
      slackChannel = env.SLACK_CRYPTO_CHANNEL_ID || process.env.SLACK_CRYPTO_CHANNEL_ID || slackChannel;
      channelName = "虛擬幣專用頻道";
    }

    if (!slackToken || !slackChannel) {
      return Response.json({ 
        error: "環境變數未設定", 
        details: `請確保設定了 SLACK_API_TOKEN 與對應的頻道 ID`,
        debug: { hasToken: !!slackToken, hasChannel: !!slackChannel, channelName }
      }, { status: 500 });
    }

    const testMessage = `🛠️ *Slack ${channelName} 整合測試成功！*\n\n這是來自您的股市系統的自動測試訊息。\n測試類型：*${type === 'crypto' ? '虛擬幣訊號分流' : '一般報表'}*\n目前時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`;

    const success = await sendSlackMessage(slackToken, slackChannel, testMessage);

    if (success) {
      return Response.json({ 
        message: `測試訊息已成功發送至 [${channelName}]！`,
        channelId: slackChannel
      });
    } else {
      return Response.json({ error: "訊息發送失敗，請檢查 Token 與頻道 ID 是否正確，且機器人是否已加入該頻道。" }, { status: 500 });
    }
  } catch (error: any) {
    return Response.json({ error: "執行過程中發生錯誤", message: error.message }, { status: 500 });
  }
}
