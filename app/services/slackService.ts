/**
 * 【詳細繁體中文註解】：Slack 通知服務
 * 使用 Slack Web API (chat.postMessage) 發送訊息
 */
export interface SlackPostPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

/** Block Kit 與純文字共用同一個發送入口；fallback text 確保手機通知仍能顯示摘要。 */
export async function sendSlackPost(token: string, channel: string, payload: SlackPostPayload) {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      // 背景通知必須有界限，避免 Slack 卡住占用 Worker 執行時間。
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: channel,
        ...payload,
        mrkdwn: true,
      }),
    });

    const data: any = await response.json();
    if (!data.ok) {
      console.error("❌ Slack API Error:", data.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to send Slack message:", error);
    return false;
  }
}

/** 保留既有純文字呼叫介面，避免其他通知服務因卡片改版受到影響。 */
export async function sendSlackMessage(token: string, channel: string, text: string) {
  return sendSlackPost(token, channel, { text });
}
