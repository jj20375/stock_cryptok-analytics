/**
 * @file 第 14 關：Gemini AI 輿情、社群真偽與刷量結構裁判（替代原文 grok.py + prompts.py）。
 * 為什麼這樣做：
 * 1. 只有通過前 13 道免費硬指標（約 8% 倖存者）才會進入此檔案呼叫 Gemini，將 AI 成本壓到最低。
 * 2. 由於 Gemini 無法直接讀取 X 站內毫秒級未索引推文，本模組結合 DexScreener 提供的社群連結（X/TG/官網）、
 *    平均單筆成交額（識破微額刷量機器人）、付費 Boost 與 Rugcheck 次級警告組合，交由 Gemini 進行綜合防詐裁決。
 * 3. 若本機開發環境無法連線至 Gemini API，自動切換至本地量化社群與刷量結構終審 Fallback，確保系統穩定運作。
 */
import { getGeminiResponse } from '../aiService';
import { findBitgetTokenByMint } from './bitgetListed';
import { MEME_DESK_CONFIG } from './config';
import type { DexPoolSnapshot, GeminiJudgeVerdict, RugcheckFacts } from './types';

/**
 * 建立第 14 關 Gemini 裁判提示詞（改編自原文 JUDGE_PROMPT，針對免費 Gemini + Bitget 已上架代幣與鏈上結構最佳化）。
 */
function buildGeminiJudgePrompt(token: RugcheckFacts, pool: DexPoolSnapshot): string {
  const bitgetInfo = findBitgetTokenByMint(token.mint);
  const inputPayload = {
    bitgetExchange: bitgetInfo
      ? { listed: true, bitgetSymbol: bitgetInfo.bitgetSymbol, category: bitgetInfo.category }
      : { listed: false },
    token: {
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      riskScore: token.riskScore,
      warnFlags: token.warnFlags,
      lpLockedPct: token.lpLockedPct,
      top10Pct: token.top10Pct,
      devPct: token.devPct,
      totalHolders: token.totalHolders,
    },
    pool: {
      priceUsd: pool.priceUsd,
      liquidityUsd: pool.liquidityUsd,
      fdvUsd: pool.fdvUsd,
      ageMin: pool.ageMin,
      buys5m: pool.buys5m,
      sells5m: pool.sells5m,
      buys1h: pool.buys1h,
      sells1h: pool.sells1h,
      volume1hUsd: pool.volume1hUsd,
      avgTrade1hUsd: pool.avgTrade1hUsd,
      priceChange1hPct: pool.priceChange1hPct,
      socials: pool.socials,
      websites: pool.websites,
      boostsActive: pool.boostsActive,
    },
  };

  return `
你是 RUG DESK（Bitget 已上架 Solana 迷因幣與生態幣 14 關最終裁判）。
下面這顆 Solana 代幣為 Bitget 交易所已上架幣種（${bitgetInfo ? `交易對：${bitgetInfo.bitgetSymbol}` : '鏈上代幣'}），且剛剛通過了全部 13 項程式碼硬指標（Mint/Freeze 權限已關、Dev 持倉 <= 5%、無 Insider、鏈上主池 >= $30k、且有真實雙向買賣單）。
請不要重複檢查上述已通過的硬數字，你的唯一工作是根據「鏈上近 1 小時量價動能、買賣筆數結構與合約健康度」，判斷現在是否適合在 Bitget 進場一筆固定 $${MEME_DESK_CONFIG.ticketUsd} 美元部位（BUY）或暫時觀望淘汰（SKIP）。

輸入數據 INPUT：
${JSON.stringify(inputPayload, null, 2)}

請嚴格審查以下 4 個關鍵維度：
1. 次級警告疊加（warnFlags）：排除 CEX 已上架代幣因採用 CLMM 池常見的 LP 提示後，是否有其他實質危險警告？
2. 社群與項目真實性（socials / websites / bitgetExchange）：
   - 若為已上架 Bitget 的官方合約且具備社群連結，代表已通過交易所上幣審核。
   - 若既非 Bitget 官方驗證代幣且無任何社群連結，必須判定 SKIP。
3. 刷量機器人與買賣結構（avgTrade1hUsd / buys1h vs sells1h / volume1hUsd）：
   - 若近 1 小時平均每筆成交額（avgTrade1hUsd）極小（例如低於 $15 美元），或 1 小時成交量極度萎縮，必須判定 SKIP。
   - 若近 1 小時賣單遠大於買單且價格重挫（持續破底出貨中），或短線已過度暴漲處於追高末端，應判定 SKIP。
4. 動能與換手健康度：近 1 小時與近 5 分鐘買盤是否穩定、池深與成交量是否足以支撐順暢進出。

請只回傳合法的 JSON 物件（使用繁體中文說明），格式如下：
{
  "verdict": "BUY" | "SKIP",
  "confidence": 0.0 到 1.0 之間的數字,
  "why": "兩句話以內說明為什麼給出此裁決（請提及 Bitget 交易對與近 1h 量價結構）",
  "xRead": "一句話總結社群完整度與鏈上買賣盤換手結構",
  "mainRisk": "一句話指出該代幣目前最大的短線風險點"
}

鐵則：
- 只要量價動能疲弱、賣壓沉重或疑似微額刷單，一律回傳 "SKIP"。
- 絕不可在說明中預測目標價。
`.trim();
}

/**
 * 當本機開發伺服器無法連外呼叫 Gemini API 時的結構化量化終審 Fallback。
 * 檢查 Bitget 上架狀態、社群連結完整度、平均單筆成交額（防 $15 以下微額刷量機器人）、以及近 1h 買賣動能。
 */
export function evaluateLocalJudgeFallback(
  token: RugcheckFacts,
  pool: DexPoolSnapshot,
): GeminiJudgeVerdict {
  const bitgetInfo = findBitgetTokenByMint(token.mint);
  const hasTwitter = pool.socials.some(s => s.type.toLowerCase() === 'twitter' || s.url.includes('x.com') || s.url.includes('twitter.com'));
  const hasTelegram = pool.socials.some(s => s.type.toLowerCase() === 'telegram' || s.url.includes('t.me'));

  if (!bitgetInfo && !hasTwitter && !hasTelegram) {
    return {
      verdict: 'SKIP',
      confidence: 0.85,
      why: '代幣未登記任何 X (Twitter) 或 Telegram 官方社群連結，缺乏真實社群背書。',
      xRead: '無 X / Telegram 社群連結 (本地結構終審)',
      mainRisk: '無社群資訊之匿名盤，熱度難以延續',
    };
  }

  if (pool.avgTrade1hUsd !== null && pool.avgTrade1hUsd < 15) {
    return {
      verdict: 'SKIP',
      confidence: 0.82,
      why: `近 1 小時平均每筆成交僅 $${pool.avgTrade1hUsd} USD，疑似微額刷單機器人或量能不足。`,
      xRead: `均單 $${pool.avgTrade1hUsd} 偏低，量能結構不佳`,
      mainRisk: '短線真實買盤動能不足，容易陷入盤整陰跌',
    };
  }

  if (pool.priceChange1hPct !== null && pool.priceChange1hPct < -8) {
    return {
      verdict: 'SKIP',
      confidence: 0.8,
      why: `近 1 小時跌幅達 ${pool.priceChange1hPct}%（買 ${pool.buys1h} / 賣 ${pool.sells1h}），短線賣壓沉重暫不接刀。`,
      xRead: `1h 動能偏弱 (${pool.priceChange1hPct}%)，空方拋壓佔優`,
      mainRisk: '短線處於下跌趨勢，建議等待止跌訊號',
    };
  }

  if (!bitgetInfo && token.warnFlags.length >= 3) {
    return {
      verdict: 'SKIP',
      confidence: 0.78,
      why: `Rugcheck 同時存在 ${token.warnFlags.length} 項次級警告 (${token.warnFlags.slice(0, 2).join(', ')})，風險疊加過高。`,
      xRead: '社群連結存在，但合約次級警告過多',
      mainRisk: token.warnFlags.join('、'),
    };
  }

  const pairLabel = bitgetInfo ? `Bitget (${bitgetInfo.bitgetSymbol})` : 'Solana 主池';
  const confidence = bitgetInfo ? 0.82 : (hasTwitter && hasTelegram ? 0.78 : 0.72);
  return {
    verdict: 'BUY',
    confidence,
    why: `${pairLabel} 已通過前 13 道合約與池深硬指標，近 1 小時成交 $${Math.round(pool.volume1hUsd).toLocaleString()}（均單 $${pool.avgTrade1hUsd ?? 'N/A'}）換手健康。`,
    xRead: `${bitgetInfo ? `Bitget 已上架 (${bitgetInfo.bitgetSymbol}) ｜ ` : ''}1h ${pool.buys1h} 買 / ${pool.sells1h} 賣，均單 $${pool.avgTrade1hUsd ?? 'N/A'} 結構自然`,
    mainRisk: '加密貨幣短線波動劇烈，需嚴格執行 -35% 停損與階梯分批停利',
  };
}

/**
 * 呼叫 Gemini 執行第 14 關最終裁決（對應原文 grok.ask + check.py 第 4 階段）。
 * @param token 已通過前 9 關的 Rugcheck 合約結構
 * @param pool 已通過第 10~13 關的 DexScreener 池子結構
 * @param env Cloudflare Workers 或本機環境變數
 */
export async function askGeminiMemeJudge(
  token: RugcheckFacts,
  pool: DexPoolSnapshot,
  env: Record<string, any> = {},
): Promise<GeminiJudgeVerdict> {
  try {
    const prompt = buildGeminiJudgePrompt(token, pool);
    const rawText = await getGeminiResponse(
      prompt,
      { responseMimeType: 'application/json' },
      env,
    );

    const startIdx = rawText.indexOf('{');
    const endIdx = rawText.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      throw new Error(`Gemini 未回傳有效 JSON: ${rawText.slice(0, 120)}`);
    }

    const parsed = JSON.parse(rawText.slice(startIdx, endIdx + 1));
    const rawVerdict = String(parsed?.verdict || '').toUpperCase();
    const rawConfidence = Number(parsed?.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, Math.round(rawConfidence * 100) / 100))
      : 0;

    let verdict: 'BUY' | 'SKIP' = rawVerdict === 'BUY' ? 'BUY' : 'SKIP';
    let why = String(parsed?.why || '未提供具體理由').trim();

    /**
     * 強制信心門檻把關（對應原文 check.py：verdict == "BUY" and conf < MIN_CONFIDENCE -> SKIP）：
     * 即使模型說 BUY，只要信心度未達 0.7，一律由程式碼強制改判 SKIP。
     */
    if (verdict === 'BUY' && confidence < MEME_DESK_CONFIG.minConfidence) {
      verdict = 'SKIP';
      why = `信心分數過低 (${confidence} < ${MEME_DESK_CONFIG.minConfidence})：${why}`;
    }

    return {
      verdict,
      confidence,
      why,
      xRead: String(parsed?.xRead || parsed?.x_read || '無社群判讀摘要').trim(),
      mainRisk: String(parsed?.mainRisk || parsed?.main_risk || '迷因幣高波動歸零風險').trim(),
    };
  } catch (error: any) {
    /**
     * 若本機環境因網路限制（fetch failed）或未設定 GEMINI_API_KEY 導致遠端呼叫失敗，
     * 退回本地量化社群與刷量結構終審 Fallback，避免整個 14 關流程因環境網路中斷。
     */
    console.warn('[Meme Desk] Gemini 遠端呼叫失敗，切換為本地結構終審 Fallback:', error?.message || error);
    return evaluateLocalJudgeFallback(token, pool);
  }
}
