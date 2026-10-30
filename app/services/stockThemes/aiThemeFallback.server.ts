/**
 * @file 當公開資料來源（證交所／Nasdaq）查無產業或題材時的 AI 補完服務。
 *
 * 【詳細繁體中文註解】：
 * 1. 職責與邊界：
 *    - 只針對查無產業名稱（industry === '未分類'）且人工名單未命中的股票，批次呼叫 AI 進行推估。
 *    - 嚴格限制批次上限（一次最多 8 檔），避免提示詞過長或占用過多 Worker 執行時間。
 * 2. 嚴格防呆與降級策略（Fallback）：
 *    - AI 回傳之題材 ID 必須存在於 THEME_BY_ID 字典，未列出的自創題材一律拋棄。
 *    - 任何 JSON 解析失敗、超時或 API 錯誤，一律以 console.warn 記錄並回傳空 Map，
 *      絕不阻斷日報主流程，維持日報順利發送。
 */

import { getAIResponse } from '../aiService';
import { THEME_DEFINITIONS, THEME_BY_ID } from './taxonomy';

export interface AiThemeInference {
  symbol: string;
  industry: string;
  themeIds: string[];
}

export async function inferMissingThemesWithAi(
  items: Array<{ symbol: string; name?: string }>,
  market: 'TW' | 'US',
  env: any = {},
): Promise<Map<string, AiThemeInference>> {
  const result = new Map<string, AiThemeInference>();
  if (!items || items.length === 0) return result;

  // 限制單次批次最多 8 檔，避免 Token 浪費與超時
  const batch = items.slice(0, 8);
  const themeCatalog = THEME_DEFINITIONS.map(t => `${t.id}: ${t.label} (${t.aiRelevance})`).join(', ');

  const prompt = `
你是一位資深證券分析師。請針對以下${market === 'TW' ? '台股' : '美股'}標的，判斷其「主要產業別」以及「是否有跟 AI 或當前熱門趨勢搭上邊」：

可選題材 ID 清單（只能從此清單挑選，若無相關請給空陣列 []）：
[${themeCatalog}]

待分析標的：
${JSON.stringify(batch.map(b => ({ symbol: b.symbol, name: b.name || b.symbol })), null, 2)}

請回傳 JSON 陣列，格式如下（不需任何 markdown 包裹）：
[
  {
    "symbol": "代號",
    "industry": "繁體中文主要產業（如：半導體業、電子零組件、航運、生技醫療）",
    "themeIds": ["命中題材ID"]
  }
]
`;

  try {
    const rawResponse = await getAIResponse(prompt, { responseMimeType: 'application/json' }, env);
    if (!rawResponse) return result;

    // 清理可能附帶的 code block 標記
    const cleanJson = rawResponse.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || !entry.symbol) continue;
        const validThemeIds = Array.isArray(entry.themeIds)
          ? entry.themeIds.filter((id: string) => THEME_BY_ID.has(id))
          : [];
        result.set(String(entry.symbol).trim().toUpperCase(), {
          symbol: String(entry.symbol).trim().toUpperCase(),
          industry: String(entry.industry || '').trim() || '未分類',
          themeIds: validThemeIds,
        });
      }
    }
  } catch (error) {
    console.warn(`[inferMissingThemesWithAi] AI 題材推估失敗，安全降級略過：`, String(error));
  }

  return result;
}
