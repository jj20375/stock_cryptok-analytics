import { ActionFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { getUserId } from "../utils/auth";
import { decryptData } from "../utils/encryption";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const userId = await getUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = context.cloudflare.env as any;
  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !user.telegramBotToken || !user.telegramChatId) {
    return Response.json({ error: "請先填寫並儲存 Telegram Bot Token 與 Chat ID" }, { status: 400 });
  }

  try {
    // 解密 Token 與 Chat ID
    const botToken = await decryptData(user.telegramBotToken, masterKey);
    const chatId = await decryptData(user.telegramChatId, masterKey);

    // 呼叫 Telegram API 發送測試訊息
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const message = "✅ *台美股短線系統*\n\n太棒了！您的 Telegram 通知綁定已成功！\n未來系統將會把自動化交易的訊號與結果傳送到這裡。";

    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      console.error("Telegram API Error:", data);
      return Response.json({ error: `傳送失敗：${data.description || "請檢查 Token 或 Chat ID 是否正確"}` }, { status: 400 });
    }

    return Response.json({ success: true, message: "測試訊息已成功發送至您的 Telegram！" }, { status: 200 });
  } catch (error: any) {
    console.error("Test Telegram Error:", error);
    return Response.json({ error: "伺服器內部錯誤，無法解密或連線至 Telegram" }, { status: 500 });
  }
}
