import { fetchStockData, calculateMA } from "./stockService";
import { getTWStockChips } from "./chipService";
import { getAIResponse } from "./aiService";

/**
 * 【詳細繁體中文註解】
 * 汰弱留強換股診斷結果結構
 */
export interface AssetDiagnosis {
  symbol: string;
  name: string;
  price: number;
  ma20: number;
  ma60: number;
  technicalState: "BULL" | "BEAR" | "NEUTRAL"; // 多頭、空頭或盤整
  chipState: string;                         // 籌碼面狀態簡述
  isWeak: boolean;                           // 是否判定為弱勢股 (建議汰弱)
  reasons: string[];                         // 弱勢原因列表
}

export interface RebalancingAdvice {
  diagnoses: AssetDiagnosis[];
  aiAdvice: string;                          // Gemini 輸出的換股短評
  strongCandidates: { symbol: string; name: string; reason: string }[];
}

/**
 * 【詳細繁體中文註解】
 * 評估單一資產的技術與籌碼面，判定其是否為弱勢資產
 */
async function diagnoseAsset(symbol: string): Promise<AssetDiagnosis | null> {
  try {
    let normalizedSymbol = symbol;
    if (symbol.includes("/")) {
      normalizedSymbol = symbol.replace("/", "-").replace("USDT", "USD");
    }

    const { data, name } = await fetchStockData(normalizedSymbol, 80, "1d");
    if (data.length < 60) return null;

    const closes = data.map(h => h.close);
    const ma20List = calculateMA(closes, 20);
    const ma60List = calculateMA(closes, 60);

    const price = closes[closes.length - 1];
    const ma20 = ma20List[ma20List.length - 1] || price;
    const ma60 = ma60List[ma60List.length - 1] || price;

    // 1. 技術面判定：
    // - BULL: 股價大於 MA20，且 MA20 大於 MA60 (多頭排列)
    // - BEAR: 股價小於 MA20，且 MA20 小於 MA60 (空頭排列)
    let technicalState: "BULL" | "BEAR" | "NEUTRAL" = "NEUTRAL";
    if (price > ma20 && ma20 > ma60) {
      technicalState = "BULL";
    } else if (price < ma20 && ma20 < ma60) {
      technicalState = "BEAR";
    }

    // 2. 籌碼面判定：僅適用於台股
    let chipState = "無籌碼資料";
    let isChipWeak = false;
    let chipDetails = "";

    if (symbol.includes(".TW") || /^\d{4,6}$/.test(symbol)) {
      const chips = await getTWStockChips(symbol);
      if (chips) {
        const foreignSell = chips.foreignBuySell < 0;
        const trustSell = chips.trustBuySell < 0;
        const marginExcess = chips.marginBalance > 15000 && chips.shortMarginRatio < 2;
        
        if (foreignSell && trustSell) {
          chipState = "土洋同步賣超";
          isChipWeak = true;
          chipDetails = "三大法人主力籌碼持續流出";
        } else if (trustSell) {
          chipState = "投信賣超";
          chipDetails = "本土投信減碼中";
        } else if (foreignSell) {
          chipState = "外資賣超";
          chipDetails = "外資法人偏空操作";
        } else {
          chipState = "法人買超中";
        }

        if (marginExcess) {
          chipState += " ｜ 融資過高";
          isChipWeak = true;
          chipDetails += (chipDetails ? "、" : "") + "散戶融資摸底浮額過重";
        }
      }
    }

    // 3. 綜合判定弱勢股條件 (破線空頭，或籌碼極度鬆散且技術面無起色)
    const reasons: string[] = [];
    if (technicalState === "BEAR") {
      reasons.push("股價跌破月線且處於空頭排列");
    }
    if (isChipWeak) {
      reasons.push(chipDetails || "法人撤離或散戶融資大增");
    }

    // 股價低於季線 (MA60) 且有其他弱勢特徵時，列為弱勢股
    const isWeak = reasons.length > 0 && price < ma60;

    return {
      symbol,
      name,
      price,
      ma20,
      ma60,
      technicalState,
      chipState,
      isWeak,
      reasons,
    };
  } catch (err) {
    console.error(`[RebalancingService] 診斷資產 ${symbol} 失敗:`, err);
    return null;
  }
}

/**
 * 【詳細繁體中文註解】
 * 為使用者的投資組合生成汰弱留強與換股建議
 * @param portfolioList 持倉清單
 * @param env 包含 AI API 金鑰之環境物件
 */
export const getPortfolioRebalancingAdvice = async (
  portfolioList: any[],
  env: any
): Promise<RebalancingAdvice | null> => {
  if (!portfolioList || portfolioList.length === 0) return null;

  try {
    // 1. 對所有持倉資產進行診斷
    const diagnosesRaw = await Promise.all(portfolioList.map(item => diagnoseAsset(item.symbol)));
    const diagnoses = diagnosesRaw.filter((d): d is AssetDiagnosis => d !== null);

    // 2. 獲取當前市場的強勢候選股 (模擬策略強勢推薦池)
    // 這裡我們預設幾檔具有代表性的強勢題材股或前 50 大熱門股作為過濾池，實務上可對接 strategyEngine
    const testSymbols = ["2603.TW", "2609.TW", "2330.TW", "NVDA", "AAPL", "BTC/USDT"];
    const candidateDiagnosesRaw = await Promise.all(testSymbols.map(sym => diagnoseAsset(sym)));
    
    // 篩選出多頭排列、且籌碼沒有轉空的標的作為「強勢建議換股標的」
    const strongCandidates = candidateDiagnosesRaw
      .filter((d): d is AssetDiagnosis => d !== null && d.technicalState === "BULL" && !d.isWeak)
      .slice(0, 3)
      .map(c => ({
        symbol: c.symbol,
        name: c.name,
        reason: c.chipState.includes("買超") || c.chipState.includes("共識")
          ? `技術面多頭，且伴隨 ${c.chipState} 指標背書。`
          : "均線多頭排列，股價站穩所有均線之上，動能強勁。"
      }));

    // 3. 呼叫 Gemini 生成專業 AI 換股短評
    const weakAssets = diagnoses.filter(d => d.isWeak);
    let aiAdvice = "目前持倉結構健康，暫無明顯弱勢標的，建議維持既有配置。";

    if (weakAssets.length > 0 && strongCandidates.length > 0) {
      const prompt = `
你是一位頂級的量化資產管理專家與智投顧問。請針對下述用戶投資組合中的「弱勢持倉（建議汰弱）」以及市場中篩選出的「強勢候選股（建議留強）」，進行客觀、專業的換股診斷。

【用戶弱勢持股 (汰弱)】：
${JSON.stringify(weakAssets.map(w => ({
  symbol: w.symbol,
  name: w.name,
  price: w.price,
  reasons: w.reasons.join("、")
})), null, 2)}

【市場強勢候選股 (留強)】：
${JSON.stringify(strongCandidates, null, 2)}

請用繁體中文輸出大約 150 到 200 字的專業分析與操作指引：
1. 點出弱勢股最核心的致命傷（技術面破位或籌碼外流）。
2. 指導如何將部分資金轉移到強勢股中，以提升資產組合的整體資金回報效率。
字數請精簡控制，不要包含條列式，直接以流暢的段落輸出。
`;
      try {
        const res = await getAIResponse(prompt, {}, env);
        if (res) {
          aiAdvice = res.trim();
        }
      } catch (err) {
        console.error("[RebalancingService] Gemini 呼叫異常:", err);
        aiAdvice = "AI 換股助手暫時無法取得在線分析，請參考下方個股的技術與籌碼面指標自行評估。";
      }
    }

    return {
      diagnoses,
      aiAdvice,
      strongCandidates,
    };
  } catch (error) {
    console.error("[RebalancingService] 生成換股建議失敗:", error);
    return null;
  }
};
