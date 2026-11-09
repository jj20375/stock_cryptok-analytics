/**
 * @file 台指夜盤／費半連動觀察（TSM 台積電 ADR、^SOX 費城半導體）與「VIX × 期貨 × 夜盤」多空時機判讀。
 *
 * 【詳細繁體中文註解】：
 * 1. 為什麼用 TSM + ^SOX + NQ=F 模擬台指夜盤？
 *    Yahoo Finance 公開 API 無法穩定提供台指期夜盤（TXF 電子盤）即時報價，
 *    但台指夜盤漲跌有超過 65% 由台積電 ADR (`TSM`)、費城半導體指數 (`^SOX`) 與那指 100 期貨 (`NQ=F`) 驅動。
 *    透過三者相對 10MA 趨勢與單日漲跌幅共振，即可在美股走盤與台股盤前精準判讀夜盤多空壓制與跳空方向。
 * 2. 為什麼獨立出 `MacroTimingWindow`？
 *    原有羅盤僅給出「偏多／震盪／偏空」靜態方向，遇到連續跌勢時，使用者最需要知道：
 *    - 什麼時候是「順勢做空時機」（VIX 突破均線加速 + 期貨與 TSM/SOX 同步破線走弱）？
 *    - 什麼時候是「恐慌見底反轉做多時機」（VIX 衝高 >= 22 後單日回落或留長上影 + 期貨/TSM 破底翻紅止穩）？
 *    本模組不改動原有四大維度的回測權重分數，確保既有回測驗證結果 100% 不變。
 */
import { buildUnavailablePillar, formatSignalLabel, formatSignedPct } from "./pillars";
import type {
  MacroPillarAnalysis,
  MacroQuote,
  MacroRawInput,
  MacroSignalDirection,
  MacroTargetMarket,
  MacroTimingWindow,
} from "./types";

/**
 * 台積電 ADR (TSM) 或費半 (^SOX) 單日顯著波動門檻（%，單位：百分比）：
 * 單日漲跌超過 ±1.2% 代表夜盤外資與美股科技股出現明確單邊表態。
 */
const NIGHT_SIGNIFICANT_MOVE_PCT = 1.2;

/**
 * VIX 恐慌高檔門檻（單位：指數點數）：
 * VIX >= 22 代表市場已進入明顯恐慌區間，若此時 VIX 出現單日回落，常伴隨空頭回補與反轉做多契機。
 */
const VIX_FEAR_ZONE_LEVEL = 22;

/**
 * VIX 恐慌見頂回落確認門檻（%，單位：單日百分比變化）：
 * 當 VIX 在高檔單日下跌 <= -2.5%（或跌破 10MA），代表避險買盤退潮、Put 保護單開始獲利了結。
 */
const VIX_PEAK_COOLING_PCT = -2.5;

/**
 * VIX 避險升溫做空門檻（單位：指數點數）：
 * VIX >= 19.5 且位於 10MA 之上（或單日大漲 >= 5%），代表機構正在加碼避險，順勢做空勝率提高。
 */
const VIX_SHORT_ALERT_LEVEL = 19.5;

/** 格式化單一報價的簡短字串（例如：TSM $188.50 (+1.85%)） */
function formatNightQuote(label: string, quote: MacroQuote | null, isIndex = false): string {
  if (!quote) return `${label} —（暫缺）`;
  const priceText = isIndex
    ? Math.round(quote.value).toLocaleString("en-US")
    : `$${quote.value.toFixed(2)}`;
  return `${label} ${priceText} (${formatSignedPct(quote.changePct)})`;
}

/**
 * 【詳細繁體中文註解】
 * 建立「台指夜盤 & 費半半導體連動 (TSM / ^SOX / NQ)」維度卡片（供 TW 台股與 US 美股顯示）。
 * 僅作為補充觀察卡片，不併入原四大維度總分，避免影響既有回測分數。
 */
export function buildNightSessionPillar(
  params: MacroRawInput,
  market: MacroTargetMarket
): MacroPillarAnalysis | undefined {
  if (market === "CRYPTO") return undefined;

  const title =
    market === "TW"
      ? "台指夜盤連動 (台積電 ADR & 費半 SOX · 不計分)"
      : "AI 半導體先行盤 (費半 SOX & 台積電 ADR · 不計分)";

  const tsm = params.nightSession?.tsm ?? null;
  const sox = params.nightSession?.sox ?? null;
  const nq = params.nq;

  if (!tsm && !sox) {
    return buildUnavailablePillar("nightSession", title, "台積電 ADR (TSM)／費半指數 (^SOX)");
  }

  /** 台積電 ADR 與費半的有效報價清單，用來計算多空共振 */
  const activeQuotes = [tsm, sox].filter((q): q is MacroQuote => q !== null);
  const allDown = activeQuotes.every((q) => q.changePct < 0);
  const allUp = activeQuotes.every((q) => q.changePct > 0);
  const sharpDrop = activeQuotes.some((q) => q.changePct <= -NIGHT_SIGNIFICANT_MOVE_PCT);
  const sharpRally = activeQuotes.some((q) => q.changePct >= NIGHT_SIGNIFICANT_MOVE_PCT);
  const belowMaCount = activeQuotes.filter((q) => q.trend === "DOWN").length;
  const aboveMaCount = activeQuotes.filter((q) => q.trend === "UP").length;

  let signal: MacroSignalDirection = "NEUTRAL";
  let explanation = "";

  if (sharpDrop || (allDown && belowMaCount >= 1)) {
    signal = "BEARISH";
    explanation =
      market === "TW"
        ? `台積電 ADR 與費半同步走弱${sharpDrop ? "（出現逾 1.2% 明顯跌幅）" : ""}，連帶壓抑台指期夜盤表現，外資於隔日台股現貨開盤易出現提款賣壓，短線反彈遇壓可留意順勢避險／做空時機。`
        : `費城半導體與台積電 ADR 同步下跌且弱於均線，AI 晶片硬體族群面臨獲利了結賣壓，美股科技股走盤偏空，反彈不宜貿然追多。`;
  } else if (sharpRally || (allUp && aboveMaCount >= 1)) {
    signal = "BULLISH";
    explanation =
      market === "TW"
        ? `台積電 ADR 與費半同步走強${sharpRally ? "（單日漲逾 1.2%）" : ""}，激勵台指期夜盤買盤回溫，有利帶動台股權值股開高或跌深止穩反彈。`
        : `費城半導體與台積電 ADR 領漲站上均線，AI 半導體買盤回流，有利美股那指與科技權值股延續多頭走盤。`;
  } else {
    signal = "NEUTRAL";
    explanation =
      market === "TW"
        ? `台積電 ADR 與費半漲跌互見或幅度溫和，台指夜盤缺乏單邊方向共振，預計台股開盤以區間震盪、個股表現為主。`
        : `費半與台積電 ADR 多空分歧，半導體族群處於整理結構，等待美股現貨開盤量能確認方向。`;
  }

  const nqText = nq ? `NQ 期貨 ${formatSignedPct(nq.changePct)}` : "NQ 期貨暫缺";

  return {
    key: "nightSession",
    title,
    signal,
    signalLabel: formatSignalLabel(signal, market === "TW" ? "台指夜盤" : "美股半導體"),
    primaryMetric: `${formatNightQuote("TSM", tsm)} ｜ ${formatNightQuote("費半 SOX", sox, true)}`,
    secondaryMetric: `10MA：TSM ${tsm ? `$${tsm.ma10.toFixed(2)}` : "—"} ／ SOX ${sox ? Math.round(sox.ma10).toLocaleString("en-US") : "—"} ｜ ${nqText}`,
    explanation,
  };
}

/**
 * 【詳細繁體中文註解】
 * 綜合 VIX 恐慌指數、美股期貨走盤（NQ/ES）與台指夜盤連動（TSM/SOX），
 * 判斷當前是否出現「順勢做空時機」或「恐慌見底反轉做多時機」。
 */
export function buildMacroTimingWindow(
  params: MacroRawInput,
  market: MacroTargetMarket,
  score: number
): MacroTimingWindow {
  const { vix, nq, es, dxy, usdTwd } = params;
  const tsm = params.nightSession?.tsm ?? null;
  const sox = params.nightSession?.sox ?? null;
  const marketLabel = market === "TW" ? "台股／台指夜盤" : market === "US" ? "美股" : "加密貨幣";

  // 1. 判斷是否處於「高檔恐慌後回落」的反轉做多窗口
  const isVixElevated = vix.value >= VIX_FEAR_ZONE_LEVEL || vix.ma10 >= 21;
  const isVixCoolingFromPeak =
    isVixElevated && (vix.changePct <= VIX_PEAK_COOLING_PCT || vix.value < vix.ma10);
  const isFuturesStabilizing =
    (nq !== null && nq.changePct >= -0.15) ||
    (es !== null && es.changePct >= -0.1) ||
    (tsm !== null && tsm.changePct >= 0.3);

  // 2. 判斷是否處於「VIX 衝高 + 期貨/夜盤破線」的順勢做空窗口
  const isVixSpiking =
    vix.value >= VIX_SHORT_ALERT_LEVEL && (vix.trend === "UP" || vix.changePct >= 4);
  const isFuturesBreakingDown =
    (nq !== null && (nq.changePct <= -0.5 || (nq.trend === "DOWN" && nq.changePct < 0))) ||
    (market === "TW" && tsm !== null && tsm.changePct <= -1.2 && tsm.trend === "DOWN");

  // 組裝動態檢核清單，讓使用者一眼看懂目前哪些條件已達成 (✓)、哪些尚未達成 (○)
  const vixCoolCheck = `${isVixCoolingFromPeak ? "✓" : "○"} VIX 恐慌見頂回落：目前 VIX ${vix.value.toFixed(2)} (${formatSignedPct(vix.changePct)}，10MA ${vix.ma10.toFixed(2)})`;
  const futuresReboundCheck = `${
    nq && nq.changePct >= 0 ? "✓" : "○"
  } 美股走盤止穩翻紅：那指期貨 NQ ${nq ? formatSignedPct(nq.changePct) : "暫缺"}${
    es ? `、標普 ES ${formatSignedPct(es.changePct)}` : ""
  }`;
  const nightLongCheck =
    market === "TW"
      ? `${tsm && tsm.changePct >= 0 ? "✓" : "○"} 台指夜盤領先指標止跌：台積電 ADR ${
          tsm ? formatSignedPct(tsm.changePct) : "暫缺"
        }、費半 ${sox ? formatSignedPct(sox.changePct) : "暫缺"}`
      : `${dxy.trend === "DOWN" ? "✓" : "○"} 美元流動性緩和：DXY ${dxy.value.toFixed(2)} (${
          dxy.trend === "DOWN" ? "低於 10MA" : "高於 10MA"
        })`;

  const vixSpikeCheck = `${
    isVixSpiking ? "✓" : "○"
  } VIX 避險買盤升溫：VIX ${vix.value.toFixed(2)} (${
    vix.trend === "UP" ? "站上 10MA 加速" : "低於 10MA"
  }，單日 ${formatSignedPct(vix.changePct)})`;
  const futuresShortCheck = `${
    isFuturesBreakingDown ? "✓" : "○"
  } 美股期貨走盤轉弱：NQ ${
    nq ? `${formatSignedPct(nq.changePct)} (${nq.trend === "DOWN" ? "跌破 10MA" : "10MA 之上"})` : "暫缺"
  }`;
  const nightShortCheck =
    market === "TW"
      ? `${
          (tsm && tsm.changePct < 0) || (usdTwd && usdTwd.trend === "UP") ? "✓" : "○"
        } 夜盤與匯率壓制：TSM ${tsm ? formatSignedPct(tsm.changePct) : "暫缺"} ｜ 台幣 ${
          usdTwd ? `${usdTwd.value.toFixed(2)} (${usdTwd.trend === "UP" ? "貶值提款" : "升值"})` : "暫缺"
        }`
      : `${
          sox && sox.changePct < 0 ? "✓" : "○"
        } 半導體走弱壓抑反彈：費半 SOX ${sox ? formatSignedPct(sox.changePct) : "暫缺"}`;

  if (isVixCoolingFromPeak && isFuturesStabilizing) {
    return {
      stance: "REVERSAL_LONG_WINDOW",
      badge: "🟢 恐慌見頂回落・跌深反轉做多時機",
      triggerReason: `VIX 先前處於高檔恐慌區（${vix.value.toFixed(2)} / 10MA ${vix.ma10.toFixed(2)}），目前已開始降溫回落（${formatSignedPct(vix.changePct)}），同時美股期貨與科技股先行指標止跌回穩，屬於跌勢中「空頭回補、抓底部反轉區間做多」的高勝率窗口！`,
      longChecklist: [vixCoolCheck, futuresReboundCheck, nightLongCheck],
      shortChecklist: [vixSpikeCheck, futuresShortCheck, nightShortCheck],
    };
  }

  if (isVixSpiking || (score <= -20 && isFuturesBreakingDown)) {
    return {
      stance: "SHORT_WINDOW",
      badge: "🔴 避險升溫／夜盤破線・反彈做空時機",
      triggerReason: `VIX 恐慌指數維持高檔或站上 10MA 走升（${vix.value.toFixed(2)}），且那指期貨${
        market === "TW" ? "與台積電 ADR 夜盤連動" : "與美股走盤"
      }跌破均線轉弱（綜合評分 ${score} 分）。目前跌勢未止，切忌盲目摸底接刀，建議鎖定下方「反轉壓力區間」逢反彈受阻順勢做空！`,
      longChecklist: [vixCoolCheck, futuresReboundCheck, nightLongCheck],
      shortChecklist: [vixSpikeCheck, futuresShortCheck, nightShortCheck],
    };
  }

  if (score >= 25 && vix.value < 18.5 && vix.trend === "DOWN") {
    return {
      stance: "TREND_LONG_WINDOW",
      badge: "🟢 低恐慌＋期貨共振・順勢回踩做多時機",
      triggerReason: `VIX 處於 ${vix.value.toFixed(2)} 低檔安定區（低於 10MA ${vix.ma10.toFixed(2)}），${marketLabel}期貨與資金環境偏多共振（+${score} 分），適合在價格回測下方「做多支撐區間」時順勢佈局多單。`,
      longChecklist: [vixCoolCheck, futuresReboundCheck, nightLongCheck],
      shortChecklist: [vixSpikeCheck, futuresShortCheck, nightShortCheck],
    };
  }

  return {
    stance: "WAIT",
    badge: "🟡 多空分歧震盪・等待區間邊界反轉做多／做空",
    triggerReason: `目前 VIX (${vix.value.toFixed(2)}) 與美股期貨／夜盤連動尚未出現單邊極端宣洩或趨勢共振（評分 ${
      score >= 0 ? `+${score}` : score
    } 分）。盤勢易在箱型區間內來回刷洗，最佳策略是不追高殺低，直接利用下方「多空反轉區間面板」在壓力帶開空、支撐帶做多。`,
    longChecklist: [vixCoolCheck, futuresReboundCheck, nightLongCheck],
    shortChecklist: [vixSpikeCheck, futuresShortCheck, nightShortCheck],
  };
}
