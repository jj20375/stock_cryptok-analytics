/**
 * @file 股票產業與 AI／趨勢題材的整合解析服務。
 *
 * 【詳細繁體中文註解】：
 * 1. 核心職責：
 *    - 整合證交所 / Nasdaq 公開產業資料庫、人工題材字典與 AI 補完服務。
 *    - 為台股或美股標的批次產出完整的「產業別 ＋ AI／熱門趨勢標籤」。
 * 2. 顯示徽章規範（formatThemeBadge）：
 *    - 🤖 AI 核心：`[產業別 ｜ 🤖 AI 核心 · 題材名稱]`
 *    - 🔌 AI 供應鏈：`[產業別 ｜ 🔌 AI 供應鏈 · 題材名稱]`
 *    - 🔥 熱門趨勢：`[產業別 ｜ 🔥 熱門趨勢 · 題材名稱]`
 *    - 🏭 傳統產業：`[產業別 ｜ 🏭 傳統產業]`
 * 3. 族群風向摘要（summarizeThemeDistribution）：
 *    - 自動統計整批股票在 AI 核心、供應鏈、趨勢與傳統產業的分佈，供日報開頭快速掌握盤面資金偏好。
 */

import { getIndustryMap } from './industrySources.server';
import { classifyStockTheme, normalizeThemeSymbol, type StockThemeProfile } from './classifier';
import { inferMissingThemesWithAi } from './aiThemeFallback.server';
import { AI_RELEVANCE_LABEL } from './taxonomy';

export interface StockIdentifier {
  symbol: string;
  name?: string;
}

/**
 * 批次解析標的的產業與 AI／趨勢題材
 */
export async function resolveStockThemes(
  items: StockIdentifier[],
  market: 'TW' | 'US',
  env: any = {},
): Promise<Map<string, StockThemeProfile>> {
  const resultMap = new Map<string, StockThemeProfile>();
  if (!items || items.length === 0) return resultMap;

  // 1. 取得市場產業對照表（TWSE 或 Nasdaq，有記憶體快取）
  const industryMap = await getIndustryMap(market);

  const pendingAiList: StockIdentifier[] = [];

  // 2. 第一階段：本機字典與資料庫分類
  for (const item of items) {
    const rawSymbol = item.symbol.trim();
    const cleanKey = normalizeThemeSymbol(market, rawSymbol);
    const indRec = industryMap.get(cleanKey);

    const initialProfile = classifyStockTheme({
      market,
      symbol: rawSymbol,
      name: item.name || rawSymbol,
      industry: indRec?.industry ?? null,
      rawIndustry: indRec?.rawIndustry ?? null,
      industrySource: indRec ? (market === 'TW' ? 'TWSE' : 'NASDAQ') : 'UNKNOWN',
    });

    resultMap.set(rawSymbol, initialProfile);

    // 若完全查無產業名稱且未命中任何題材，收集起來準備送 AI 補完
    if (initialProfile.industry === '未分類' && initialProfile.themeIds.length === 0) {
      pendingAiList.push(item);
    }
  }

  // 3. 第二階段：對未分類標的進行受控 AI 補完（若有未分類標的）
  if (pendingAiList.length > 0) {
    try {
      const aiInferences = await inferMissingThemesWithAi(pendingAiList, market, env);
      for (const item of pendingAiList) {
        const rawSymbol = item.symbol.trim();
        const aiInfo = aiInferences.get(rawSymbol.toUpperCase()) || aiInferences.get(normalizeThemeSymbol(market, rawSymbol));
        if (aiInfo) {
          const reClassified = classifyStockTheme({
            market,
            symbol: rawSymbol,
            name: item.name || rawSymbol,
            industry: aiInfo.industry !== '未分類' ? aiInfo.industry : null,
            industrySource: 'AI',
            extraThemeIds: aiInfo.themeIds,
          });
          resultMap.set(rawSymbol, reClassified);
        }
      }
    } catch (err) {
      console.warn('[resolveStockThemes] AI 補完階段發生非預期錯誤，維持現有結果：', err);
    }
  }

  return resultMap;
}

/**
 * 格式化單一標的之產業與 AI／趨勢題材徽章
 * 例：`[半導體業 ｜ 🤖 AI 核心 · AI 晶片/晶圓代工]`
 */
export function formatThemeBadge(profile?: StockThemeProfile | null): string {
  if (!profile) return '【未分類】';

  const industryName = profile.industry || '未分類';
  const relevanceLabel = AI_RELEVANCE_LABEL[profile.aiRelevance];

  if (profile.themeLabels.length > 0) {
    const primaryTheme = profile.themeLabels[0];
    return `【${industryName} ｜ ${relevanceLabel} · ${primaryTheme}】`;
  }

  return `【${industryName} ｜ ${relevanceLabel}】`;
}

/**
 * 統計一組候選標的的產業與題材風向摘要，供日報 Slack 開頭顯示
 */
export function summarizeThemeDistribution(profiles: StockThemeProfile[]): string {
  if (!profiles || profiles.length === 0) return '';

  const core: string[] = [];
  const related: string[] = [];
  const trend: string[] = [];
  const traditional: string[] = [];

  for (const p of profiles) {
    const displayName = p.name ? `${p.name}` : p.symbol;
    if (p.aiRelevance === 'CORE') core.push(displayName);
    else if (p.aiRelevance === 'RELATED') related.push(displayName);
    else if (p.aiRelevance === 'TREND') trend.push(displayName);
    else traditional.push(displayName);
  }

  const parts: string[] = [];
  if (core.length > 0) parts.push(`🤖 AI 核心 (${core.slice(0, 3).join('、')}${core.length > 3 ? '等' : ''})`);
  if (related.length > 0) parts.push(`🔌 AI 供應鏈 (${related.slice(0, 3).join('、')}${related.length > 3 ? '等' : ''})`);
  if (trend.length > 0) parts.push(`🔥 熱門趨勢 (${trend.slice(0, 3).join('、')}${trend.length > 3 ? '等' : ''})`);
  if (traditional.length > 0 && parts.length === 0) parts.push(`🏭 傳統產業 (${traditional.slice(0, 3).join('、')}${traditional.length > 3 ? '等' : ''})`);

  return parts.join(' ｜ ');
}
