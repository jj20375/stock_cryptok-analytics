/** @file 精簡的虛擬幣 Slack Block Kit 卡片與 D1 相容序列化；不處理頻道或網路副作用。 */

export interface SlackPostPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

export interface CryptoSignalCardInput {
  icon: string;
  title: string;
  signal: string;
  price: string;
  closedAt: string;
  closedLabel?: string;
  invalidation: string;
  strength: string;
  risk: string;
  source: string;
}

const PREFIX = 'slack-card:v1:';
const truncate = (value: string, maximum: number) => value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
/** Slack mrkdwn 的三個特殊字元必須跳脫；所有內容雖由策略產生，仍統一處理避免代號破壞版面。 */
const escapeMrkdwn = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function createCryptoSignalCard(input: CryptoSignalCardInput): SlackPostPayload {
  const title = truncate(`${input.icon} ${input.title}`, 145);
  const fallback = `${title}｜${input.signal}｜進場參考 ${input.price}｜失效 ${input.invalidation}`;
  return {
    text: fallback,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*訊號*\n${escapeMrkdwn(input.signal)}` },
        { type: 'mrkdwn', text: `*進場參考價*\n${escapeMrkdwn(input.price)}` },
        { type: 'mrkdwn', text: `*${escapeMrkdwn(input.closedLabel ?? '15 分收盤')}*\n${escapeMrkdwn(input.closedAt)}` },
        { type: 'mrkdwn', text: `*失效參考*\n${escapeMrkdwn(input.invalidation)}` },
      ] },
      { type: 'section', text: { type: 'mrkdwn', text: `*重點*  ${escapeMrkdwn(truncate(input.strength, 500))}\n*風險*  ${escapeMrkdwn(truncate(input.risk, 350))}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `${escapeMrkdwn(input.source)}｜已收盤公開行情觀察｜非下單指令` }] },
    ],
  };
}

/** D1 既有 message 欄位可同時保存新版卡片與舊純文字，無需破壞性 migration。 */
export const serializeSlackCard = (payload: SlackPostPayload) => `${PREFIX}${JSON.stringify(payload)}`;

/** 舊佇列訊息照純文字補送；新版卡片的延遲標示同時出現在 fallback 與可見區塊。 */
export function slackPostFromStored(message: string, delayedText = ''): SlackPostPayload {
  /** 舊版長文字只取前四個非空段落，避免切換新頻道後補送舊卡造成洗版。 */
  if (!message.startsWith(PREFIX)) {
    const compact = message.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4).join('\n');
    return { text: `${delayedText}${truncate(compact, 700)}` };
  }
  try {
    const payload = JSON.parse(message.slice(PREFIX.length)) as SlackPostPayload;
    if (!payload.text || !Array.isArray(payload.blocks)) throw new Error('invalid card');
    if (!delayedText) return payload;
    return { ...payload, text: `${delayedText}${payload.text}`, blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `⚠️ *${delayedText.trim()}*` } }, ...payload.blocks,
    ] };
  } catch {
    return { text: `${delayedText}${message}` };
  }
}
