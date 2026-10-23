/**
 * @file 市場漲跌走勢羅盤的單一維度判讀：匯率、美股期貨、債券利差與 VIX。
 * 從 macroService.ts 的 buildMarketSpecificView 拆出，每個維度一個純函式，方便單獨測試門檻。
 * 注意：這裡只產生「宏觀環境偏多/偏空」的參考訊號，不直接觸發任何下單或通知。
 */
import type { MacroPillarAnalysis, MacroQuote, MacroSignalDirection, MacroTargetMarket } from "./types";

/**
 * 台幣「逆勢貶值」的最小偏離門檻（%）：USD/TWD 需高於 10MA 至少 0.15%（約 0.05 元）才視為確認。
 * Yahoo TWD=X 單日雜訊約 0.03～0.05 元，只是貼著均線上方時不足以判定外資提款，維持中性。
 */
const TWD_DIVERGENCE_MIN_GAP_PCT = 0.15;

/** VIX 單日跳升幅度（%）門檻：即使仍低於 10MA，單日大漲 5% 以上也代表避險買盤正在進場 */
const VIX_DAILY_JUMP_PCT = 5;

/** VIX 低檔區上緣：低於 18 且同時低於 10MA、利差未倒掛，才視為風險偏好健康 */
const VIX_CALM_LEVEL = 18;

/** 產生對應市場的看漲/看跌標籤文字 */
export function formatSignalLabel(signal: MacroSignalDirection, marketName: string): string {
  if (signal === "BULLISH") return `📈 利多${marketName}看漲`;
  if (signal === "BEARISH") return `📉 利空${marketName}看跌`;
  return `⚖️ ${marketName}影響中性`;
}

/** 帶正負號的百分比字串，例如 +0.22%、-1.36%；避免文案把上漲寫成「下跌 0.22%」 */
export function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * 依那指期貨實際漲跌與均線位置產生描述，供卡片與總結共用。
 * 舊版在「看跌」分支一律寫「下跌 X% 且跌破 10MA」，NQ 小漲但仍在均線下方時就會寫出「下跌 0.22%」的錯誤文案。
 */
export function describeNqMove(nq: MacroQuote): string {
  const maText = nq.trend === "UP"
    ? `站上 10MA (${Math.round(nq.ma10).toLocaleString()})`
    : `位於 10MA (${Math.round(nq.ma10).toLocaleString()}) 下方`;
  // 動詞與數字分開處理：動詞由實際正負決定，數字取絕對值，避免出現「下跌 -1.83%」或「下跌 0.22%」（實為上漲）
  return `那指期貨${nq.changePct >= 0 ? "上漲" : "下跌"} ${Math.abs(nq.changePct).toFixed(2)}% 且${maText}`;
}

/** 報價抓取失敗時的維度卡片：固定中性、不計分，並在卡片上明講資料暫缺 */
export function buildUnavailablePillar(
  key: MacroPillarAnalysis["key"],
  title: string,
  sourceName: string
): MacroPillarAnalysis {
  return {
    key,
    title,
    signal: "NEUTRAL",
    signalLabel: "⚠️ 資料暫缺",
    primaryMetric: "—",
    secondaryMetric: `${sourceName} 報價抓取失敗`,
    explanation: `${sourceName} 報價暫時無法取得，本維度不納入多空評分（不以預設值代入，避免產生假訊號），請稍後按「更新風向」重試。`,
    dataUnavailable: true,
  };
}

/**
 * 【匯率維度】美股、幣圈看美元 DXY；台股看新台幣 USD/TWD 搭配 DXY 判讀外資資金流向。
 * 台股規則（USD/TWD 上升 = 台幣貶值）：
 * - 台幣升值 + 美元走弱：外資匯入，看漲。
 * - 台幣貶值 + 美元走強：全球美元回流，看跌。
 * - 台幣逆勢貶值（美元走弱、台幣卻貶）：賣壓來自外資針對台股匯出，看跌；偏離不足門檻時維持中性。
 * - 台幣逆勢升值（美元走強、台幣卻升）：外資逆勢匯入台灣，看漲。
 */
export function buildFxPillar(
  market: MacroTargetMarket,
  marketName: string,
  dxy: MacroQuote,
  usdTwd: MacroQuote | null
): MacroPillarAnalysis {
  if (market === "US" || market === "CRYPTO") {
    return buildDxyPillar(market, marketName, dxy);
  }

  const title = "匯率熱錢 (新台幣 & 美元外資流向)";
  if (!usdTwd) return buildUnavailablePillar("fx", title, "新台幣匯率 (USD/TWD)");

  /** 新台幣相對 10MA 的偏離（%）：正值代表台幣弱於均線（貶值），負值代表升值 */
  const twdGapPct = (usdTwd.value / usdTwd.ma10 - 1) * 100;
  let signal: MacroSignalDirection;
  let explanation: string;

  if (usdTwd.trend === "DOWN" && dxy.trend === "DOWN") {
    signal = "BULLISH";
    explanation = `新台幣升值（低於 10MA ${usdTwd.ma10.toFixed(2)}）且美元走弱，代表國際外資熱錢正匯入台灣，有利買超台積電與台股權值股。`;
  } else if (usdTwd.trend === "UP" && dxy.trend === "UP") {
    signal = "BEARISH";
    explanation = `新台幣貶值（高於 10MA ${usdTwd.ma10.toFixed(2)}）且美元轉強，顯示外資資金偏向匯出提款，台股大型權值股易受賣壓。`;
  } else if (usdTwd.trend === "UP") {
    if (twdGapPct >= TWD_DIVERGENCE_MIN_GAP_PCT) {
      signal = "BEARISH";
      explanation = `台幣逆勢貶值：美元指數低於 10MA 走弱，新台幣卻貶至 ${usdTwd.value.toFixed(2)}（高於 10MA ${usdTwd.ma10.toFixed(2)}，偏離 +${twdGapPct.toFixed(2)}%），代表賣壓來自外資針對台股匯出，而非全球美元走強，對台股權值股偏空。`;
    } else {
      signal = "NEUTRAL";
      explanation = `美元指數走弱，新台幣 ${usdTwd.value.toFixed(2)} 僅略高於 10MA ${usdTwd.ma10.toFixed(2)}（偏離 +${twdGapPct.toFixed(2)}%），背離幅度未達 ${TWD_DIVERGENCE_MIN_GAP_PCT}% 門檻，尚不足以確認外資提款，資金面中性。`;
    }
  } else {
    signal = "BULLISH";
    explanation = `台幣逆勢升值：美元指數站上 10MA 走強，新台幣仍維持在 10MA (${usdTwd.ma10.toFixed(2)}) 下方，代表外資逆勢匯入台灣，有利台股多方支撐。`;
  }

  return {
    key: "fx",
    title,
    signal,
    signalLabel: formatSignalLabel(signal, marketName),
    primaryMetric: `台幣 ${usdTwd.value.toFixed(2)} ｜ DXY ${dxy.value.toFixed(2)}`,
    secondaryMetric: `台幣10MA: ${usdTwd.ma10.toFixed(2)} (${usdTwd.trend === "DOWN" ? "台幣升值趨勢" : "台幣貶值趨勢"})`,
    explanation,
  };
}

/** 美股與幣圈的美元指數判讀：DXY 低於 10MA 且單日漲幅不大為偏多，站上均線明顯走強為偏空 */
function buildDxyPillar(market: MacroTargetMarket, marketName: string, dxy: MacroQuote): MacroPillarAnalysis {
  let signal: MacroSignalDirection = "NEUTRAL";
  let explanation: string;

  if (dxy.trend === "DOWN" && dxy.changePct <= 0.25) {
    signal = "BULLISH";
    explanation =
      market === "US"
        ? `美元指數位於 10MA (${dxy.ma10.toFixed(2)}) 下方，弱勢美元有利美股跨國科技巨頭（NVDA、AAPL、MSFT）海外營收換回美元並釋放股市資金活水。`
        : `美元指數位於 10MA (${dxy.ma10.toFixed(2)}) 下方，弱勢美元帶動全球熱錢流向風險資產。`;
  } else if (dxy.trend === "UP" && (dxy.changePct >= 0.15 || dxy.value > dxy.ma10 * 1.003)) {
    signal = "BEARISH";
    explanation =
      market === "US"
        ? `美元指數升破 10MA (${dxy.ma10.toFixed(2)}) 走強，不僅抽緊華爾街市場流動性，亦對美股跨國科技企業財報造成匯兌逆風。`
        : `美元指數站上 10MA 走強，資金回流美元避險，壓抑風險資產表現。`;
  } else {
    explanation = `美元指數於 ${dxy.value.toFixed(2)} 附近窄幅整理，匯率面暫無明顯單邊推力，對${marketName}影響中性。`;
  }

  return {
    key: "fx",
    title: market === "US" ? "美元匯率 (DXY 美股企業獲利與資金)" : "美元指數 (DXY 全球流動性)",
    signal,
    signalLabel: formatSignalLabel(signal, marketName),
    primaryMetric: `DXY ${dxy.value.toFixed(2)} (${formatSignedPct(dxy.changePct)})`,
    secondaryMetric: `10MA: ${dxy.ma10.toFixed(2)} (${dxy.trend === "DOWN" ? "低於均線 · 弱勢美元" : "高於均線 · 強勢美元"})`,
    explanation,
  };
}

/**
 * 【期貨維度】那斯達克 100 期貨 (NQ=F) 與標普 500 期貨 (ES=F)。
 * - 看跌：NQ 單日 <= -0.5%，或 NQ 位於 10MA 下方且 NQ/ES 任一下跌。
 * - 看漲：NQ 單日 >= +0.4%，或 NQ 站上 10MA、未下跌且 ES 跌幅不超過 0.1%。
 * NQ 缺資料時整個維度不判讀；只缺 ES 時僅依 NQ 判讀並在文案註明。
 */
export function buildFuturesPillar(
  market: MacroTargetMarket,
  marketName: string,
  nq: MacroQuote | null,
  es: MacroQuote | null
): MacroPillarAnalysis {
  const title = market === "US" ? "美股期貨 (那指 NQ & 標普 ES 先行盤)" : "美股期貨連動 (那指 NQ & 標普 ES)";
  if (!nq) return buildUnavailablePillar("futures", title, "那指期貨 (NQ)");

  /** 標普期貨單日漲跌幅（%）；ES 抓取失敗時為 null，不得當成 0% 參與判斷 */
  const esChangePct = es ? es.changePct : null;
  const esText = esChangePct === null ? "標普期貨資料暫缺" : `標普期貨 ${formatSignedPct(esChangePct)}`;
  const nqMove = describeNqMove(nq);
  let signal: MacroSignalDirection = "NEUTRAL";
  let explanation: string;

  if (nq.changePct <= -0.5 || (nq.trend === "DOWN" && (nq.changePct < 0 || (esChangePct !== null && esChangePct < 0)))) {
    signal = "BEARISH";
    explanation =
      market === "US"
        ? `${nqMove}，${esText}，華爾街電子盤賣壓湧現，美股短線面臨回檔壓力。`
        : `${nqMove}，${esText}，外資於夜盤與電子盤先行調節，將壓抑${marketName}開盤表現。`;
  } else if (nq.changePct >= 0.4 || (nq.trend === "UP" && nq.changePct >= 0 && (esChangePct === null || esChangePct >= -0.1))) {
    signal = "BULLISH";
    explanation =
      market === "US"
        ? `${nqMove}，${esText}，法人買盤積極，美股具備上漲動能。`
        : `${nqMove}，${esText}，科技股先行指標偏多，有利帶動${marketName}聯動上攻。`;
  } else {
    explanation = `那指期貨 (${formatSignedPct(nq.changePct)}) 與${esText}多空方向分歧或窄幅整理，等待美股現貨成交量放大表態。`;
  }

  return {
    key: "futures",
    title,
    signal,
    signalLabel: formatSignalLabel(signal, marketName),
    primaryMetric: `NQ ${formatSignedPct(nq.changePct)} (${Math.round(nq.value).toLocaleString()})`,
    secondaryMetric: `標普 ES ${esChangePct === null ? "—" : formatSignedPct(esChangePct)} ｜ NQ 10MA: ${Math.round(nq.ma10).toLocaleString()}`,
    explanation,
  };
}

/**
 * 【債券利差 & VIX 恐慌維度】10Y-3M 長短債利差與 VIX。
 * - 看跌：VIX >= 21，或高於 10MA 且 >= 19.5，或單日跳升 >= 7% 且 >= 18。
 * - 中性（低檔但升溫）：VIX 高於 10MA 或單日跳升 >= 5%，即使絕對值仍低也不視為看漲。
 *   舊版只要 VIX < 17.5 就判看漲，10/22 VIX 16.68 已站上 10MA 16.65 仍被當成利多。
 * - 看漲：VIX < 18、低於 10MA 且利差未倒掛。
 */
export function buildBondVixPillar(
  market: MacroTargetMarket,
  marketName: string,
  vix: MacroQuote,
  yieldSpread10Y3M: number
): MacroPillarAnalysis {
  const isInverted = yieldSpread10Y3M < 0;
  const spreadText = `${yieldSpread10Y3M >= 0 ? "+" : ""}${yieldSpread10Y3M.toFixed(2)}%`;
  const isVixRising = vix.trend === "UP" || vix.changePct >= VIX_DAILY_JUMP_PCT;
  let signal: MacroSignalDirection = "NEUTRAL";
  let explanation: string;

  if (vix.value >= 21 || (vix.trend === "UP" && vix.value >= 19.5) || (vix.changePct >= 7 && vix.value >= 18)) {
    signal = "BEARISH";
    explanation = `VIX 恐慌指數攀升至 ${vix.value.toFixed(2)}（10MA ${vix.ma10.toFixed(2)}）${isInverted ? "且長短債利差倒掛" : ""}，機構法人正在買進避險部位，${marketName}短線下跌風險升高。`;
  } else if (isVixRising) {
    explanation = vix.value < VIX_CALM_LEVEL
      ? `VIX ${vix.value.toFixed(2)} 雖處低檔，但已${vix.trend === "UP" ? `站上 10MA (${vix.ma10.toFixed(2)})` : `單日跳升 ${formatSignedPct(vix.changePct)}`}，避險情緒正在升溫，不再視為看漲支撐。`
      : `雖然美債長短利差 (${spreadText}) ${isInverted ? "倒掛" : "正常"}，但 VIX 指數 (${vix.value.toFixed(2)}) 高於 10MA (${vix.ma10.toFixed(2)})，顯示避險情緒略微升溫，追高宜謹慎。`;
  } else if (vix.value < VIX_CALM_LEVEL && !isInverted) {
    signal = "BULLISH";
    explanation = `VIX 恐慌指數回落至 ${vix.value.toFixed(2)} 低檔（低於 10MA ${vix.ma10.toFixed(2)}）且債券利差正常 (${spreadText})，華爾街無衰退與避險恐慌，有利${marketName}上漲。`;
  } else {
    explanation = `VIX 指數位於 ${vix.value.toFixed(2)}、美債 10Y-3M 利差 ${spreadText}，避險情緒處於中性觀察區。`;
  }

  return {
    key: "bondSpreadAndVix",
    title: market === "US" ? "債券利差 & VIX 華爾街恐慌指數" : "債券利差 & VIX 恐慌情緒",
    signal,
    signalLabel: formatSignalLabel(signal, marketName),
    primaryMetric: `VIX ${vix.value.toFixed(2)} ｜ 利差 ${spreadText}`,
    secondaryMetric: `${vix.trend === "UP" ? "⚠️ VIX 高於 10MA" : "✓ VIX 低於 10MA"} (${vix.ma10.toFixed(2)}) ｜ ${isInverted ? "⚠️ 殖利率倒掛" : "✓ 利差正常"}`,
    explanation,
  };
}
