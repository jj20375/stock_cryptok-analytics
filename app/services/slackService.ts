/**
 * 【詳細繁體中文註解】：Slack 通知服務
 * 使用 Slack Web API (chat.postMessage) 發送訊息
 */
export async function sendSlackMessage(token: string, channel: string, text: string) {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: channel,
        text: text,
        // 可以加上 mrkdwn: true 來支援 Markdown 格式
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
