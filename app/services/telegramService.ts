/**
 * 負責處理 Telegram 訊息推播的服務
 */

export const sendTelegramMessage = async (botToken: string, chatId: string, message: string): Promise<boolean> => {
  try {
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
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

    const data = await response.json() as any;

    if (!response.ok || !data.ok) {
      console.error("Telegram API Error:", data);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
    return false;
  }
};
