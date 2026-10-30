/**
 * @file 股票產業與 AI／趨勢題材的純函式分類器；輸入已取得的產業資訊，不呼叫網路。
 *
 * 【詳細繁體中文註解】：分類優先序
 * 1. 人工維護名單（最可信）：代號直接命中 THEME_DEFINITIONS 的 twSymbols / usSymbols。
 * 2. 關鍵字（次之）：只在人工名單完全沒命中時，才比對「產業名稱＋公司名稱」，避免一般公司被誤貼多個題材。
 * 3. 若兩者都沒有命中，題材為空、AI 關聯等級為 NONE（傳統產業）。
 * AI 推估（第三層資料來源）由 aiThemeFallback.server.ts 負責，這裡只做規則判定，方便單元測試。
 */
import { AI_RELEVANCE_RANK, THEME_BY_ID, THEME_DEFINITIONS, type AiRelevance } from './taxonomy';

/** 產業資訊的來源：證交所官方、Nasdaq 公開篩選器、AI 推估，或完全查無。 */
export type IndustrySource = 'TWSE' | 'NASDAQ' | 'AI' | 'UNKNOWN';

export interface StockThemeProfile {
  symbol: string;
  name: string;
  /** 繁體中文產業名稱；查無時為「未分類」。 */
  industry: string;
  industrySource: IndustrySource;
  /** 命中的題材 id（依 AI 關聯等級由高到低排序）。 */
  themeIds: string[];
  /** 命中的題材顯示名稱，與 themeIds 一一對應。 */
  themeLabels: string[];
  /** 所有命中題材中最高的 AI 關聯等級。 */
  aiRelevance: AiRelevance;
}

export interface ClassifyInput {
  market: 'TW' | 'US';
  symbol: string;
  name: string;
  /** 已翻成繁體中文的產業名稱；查無時傳 null。 */
  industry: string | null;
  /** 原始英文產業描述（Nasdaq Industry），只用於關鍵字比對，不直接顯示。 */
  rawIndustry?: string | null;
  industrySource: IndustrySource;
  /** AI 推估額外提供的題材 id；會再經 THEME_BY_ID 驗證，無效 id 直接丟棄。 */
  extraThemeIds?: string[];
}

/** 台股代號去掉 .TW／.TWO；美股統一大寫並移除 .-/ 等分隔符號，方便與名單比對。 */
export const normalizeThemeSymbol = (market: 'TW' | 'US', symbol: string) => market === 'TW'
  ? symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/, '')
  : symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export function classifyStockTheme(input: ClassifyInput): StockThemeProfile {
  const code = normalizeThemeSymbol(input.market, input.symbol);
  const hits = new Set<string>();

  // 第一層：人工維護名單。
  for (const theme of THEME_DEFINITIONS) {
    const list = input.market === 'TW' ? theme.twSymbols : theme.usSymbols;
    if (list.includes(code)) hits.add(theme.id);
  }

  // 第二層：人工名單完全沒命中時才比對關鍵字；產業名稱優先，公司名稱為輔。
  if (hits.size === 0) {
    const haystacks = [input.industry ?? '', input.rawIndustry ?? '', input.name ?? ''].filter(Boolean);
    for (const theme of THEME_DEFINITIONS) {
      if (theme.keywords.some(pattern => haystacks.some(text => pattern.test(text)))) hits.add(theme.id);
    }
  }

  // 第三層：AI 推估的題材，必須存在於字典中才採用。
  for (const id of input.extraThemeIds ?? []) {
    if (THEME_BY_ID.has(id)) hits.add(id);
  }

  // 若同時命中「一般半導體」與更精確的 AI 半導體題材，移除一般半導體避免重複標示。
  if (hits.size > 1) hits.delete('SEMI_GENERAL');

  const themes = [...hits]
    .map(id => THEME_BY_ID.get(id)!)
    .sort((a, b) => AI_RELEVANCE_RANK[b.aiRelevance] - AI_RELEVANCE_RANK[a.aiRelevance]);
  const aiRelevance = themes.reduce<AiRelevance>(
    (best, theme) => AI_RELEVANCE_RANK[theme.aiRelevance] > AI_RELEVANCE_RANK[best] ? theme.aiRelevance : best,
    'NONE',
  );

  return {
    symbol: input.symbol,
    name: input.name,
    industry: input.industry?.trim() || '未分類',
    industrySource: input.industry?.trim() ? input.industrySource : 'UNKNOWN',
    themeIds: themes.map(theme => theme.id),
    themeLabels: themes.map(theme => theme.label),
    aiRelevance,
  };
}
