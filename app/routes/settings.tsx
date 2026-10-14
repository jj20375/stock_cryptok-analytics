/** @file 帳戶與交易設定；數字欄位先驗證，機密仍由既有伺服器流程儲存。 */
import { NumericInput } from "../components/NumericInput";
import { RiskSettingsFields } from "../features/settings/RiskSettingsFields";
import { validateNumericInputs } from "../utils/numericInput";
import { Form, Link, redirect, useLoaderData, useActionData, useNavigation, useFetcher, useSubmit } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { cryptoAutoOrders } from "../db/cryptoAutoTradeSchema";
import { getUserId } from "../utils/auth";
import { encryptData, decryptData } from "../utils/encryption";
import { fetchBitgetFuturesMarkPrice } from "../services/bitgetService";
import { processCryptoDemoSignal } from "../services/cryptoAutoTrading/engine";

const sanitizePercent = (value: FormDataEntryValue | null, fallback: string, min: number, max: number) => {
  const parsed = parseFloat(String(value || ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max).toString();
};

const sanitizeNumber = (value: FormDataEntryValue | null, fallback: string, min: number, max: number) => {
  const parsed = parseFloat(String(value || ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max).toString();
};

const sanitizeInteger = (value: FormDataEntryValue | null, fallback: number, min: number, max: number) => {
  const parsed = parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as any;
  
  // 安全審查：取得動態金鑰驗證 Session
  const userId = await getUserId(request, env);
  if (!userId) {
    return redirect("/login");
  }

  const db = drizzle(env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return redirect("/login");
  }

  // 【詳細繁體中文註解】：防堵明文金鑰洩漏
  // 不再解密 API Key 及 Token 的明文回傳給前端，僅回傳遮罩標記以供 UI placeholder 顯示。
  const telegramBotToken = user.telegramBotToken ? "••••••••••••••••" : "";
  const telegramChatId = user.telegramChatId ? "••••••••••••••••" : "";
  const binanceApiKey = user.binanceApiKey ? "••••••••••••••••" : "";
  const pionexApiKey = user.pionexApiKey ? "••••••••••••••••" : "";
  const bitgetApiKey = user.bitgetApiKey ? "••••••••••••••••" : "";
  const bitgetDemoApiKey = user.bitgetDemoApiKey ? "••••••••••••••••" : "";
  const bitgetFuturesLiveApiKey = user.bitgetFuturesLiveApiKey ? "••••••••••••••••" : "";

  // 【詳細繁體中文註解】：將使用者自訂的策略時間週期與基本設定帶給前端
  return {
    telegramBotToken,
    telegramChatId,
    tradingMode: user.tradingMode,
    strategyTimeframe: user.strategyTimeframe || '15m',
    capitalBaseUsdt: user.capitalBaseUsdt || "1000",
    maxRiskPerTradePct: user.maxRiskPerTradePct || "0.5",
    maxDailyLossPct: user.maxDailyLossPct || "1",
    maxPositionSizePct: user.maxPositionSizePct || "10",
    riskStopLossPct: user.riskStopLossPct || "5",
    maxOpenPositions: user.maxOpenPositions || 2,
    maxTradesPerDay: user.maxTradesPerDay || 3,
    cryptoCrashGuardEnabled: user.cryptoCrashGuardEnabled ?? true,
    liveTradingEnabled: user.liveTradingEnabled ?? false,
    hasBinance: !!user.binanceApiKey && !!user.binanceApiSecret,
    hasPionex: !!user.pionexApiKey && !!user.pionexApiSecret,
    hasBitget: !!user.bitgetApiKey && !!user.bitgetApiSecret && !!user.bitgetPassphrase,
    binanceApiKey,
    pionexApiKey,
    bitgetApiKey,
    bitgetDemoApiKey,
    bitgetFuturesLiveApiKey,
    preferredExchange: user.preferredExchange || 'BINANCE',
    stockAutoTradingEnabled: user.stockAutoTradingEnabled ?? false,
    hasBitgetDemo: !!user.bitgetDemoApiKey && !!user.bitgetDemoApiSecret && !!user.bitgetDemoPassphrase,
    bitgetDemoMaxLeverage: user.bitgetDemoMaxLeverage ?? 1,
    hasBitgetFuturesLive: !!user.bitgetFuturesLiveApiKey && !!user.bitgetFuturesLiveApiSecret && !!user.bitgetFuturesLivePassphrase,
    bitgetFuturesExecutionMode: user.bitgetFuturesExecutionMode === 'LIVE' ? 'LIVE' : 'DEMO',
    bitgetFuturesLiveMaxLeverage: user.bitgetFuturesLiveMaxLeverage ?? 1,
    tradingviewDemoAutoTradingEnabled: user.tradingviewDemoAutoTradingEnabled ?? false,
    internalDemoAutoTradingEnabled: user.internalDemoAutoTradingEnabled ?? false,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as any;
  
  // 安全審查：取得動態金鑰驗證 Session
  const userId = await getUserId(request, env);
  if (!userId) return redirect("/login");

  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;

  try {
  const formData = await request.formData();

  /**
   * 【Demo 驗證註解】：只允許目前已選 Demo、已登入的本人按下測試，強制使用
   * processCryptoDemoSignal，不能因設定表單的其他欄位誤走正式盤。測試仍會在
   * Bitget Demo 建立真實的模擬委託，故沿用完整風控、稽核與 Slack 通知流程。
   */
  if (formData.get("intent") === "testBitgetDemoOrder") {
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user || user.bitgetFuturesExecutionMode === "LIVE") {
      return Response.json({ success: false, error: "請先在 Bitget 永續區塊選擇 Demo 模式，再進行連線測試。" }, { status: 400 });
    }
    if (!user.bitgetDemoApiKey || !user.bitgetDemoApiSecret || !user.bitgetDemoPassphrase) {
      return Response.json({ success: false, error: "Demo API Key、Secret 與 Passphrase 必須完整設定。" }, { status: 400 });
    }
    if (!user.tradingviewDemoAutoTradingEnabled) {
      return Response.json({ success: false, error: "請先開啟 TradingView 吃大魚訊號，才可驗證相同的下單流程。" }, { status: 400 });
    }

    const signalAt = Date.now();
    const sourceEventId = `settings-demo-connectivity-${signalAt}`;
    let referencePrice: number;
    try {
      referencePrice = await fetchBitgetFuturesMarkPrice("BTCUSDT");
      await processCryptoDemoSignal(env, {
        id: sourceEventId,
        source: "TRADINGVIEW",
        symbol: "BTCUSDT",
        action: "BUY",
        signalAt,
        referencePrice,
        label: "設定頁 Demo 連線測試（最小風控多單）",
      }, userId);
    } catch (error) {
      /** 僅回傳行情／連線類型，不把憑證、簽章或完整外部回應交給瀏覽器。 */
      const message = error instanceof Error ? error.message.replace(/[\r\n]/g, " ").slice(0, 160) : "未知錯誤";
      return Response.json({ success: false, error: `Demo 測試準備失敗：${message}` }, { status: 502 });
    }
    const audit = await db.select().from(cryptoAutoOrders).where(eq(cryptoAutoOrders.sourceEventId, sourceEventId)).get();
    if (audit?.status === "SUBMITTED") {
      return Response.json({
        success: true,
        message: `Demo 測試已送出：BTCUSDT 參考價 ${referencePrice}，訂單 ${audit.bitgetOrderId || "已建立"}。請到 Dashboard 或 Bitget Demo 核對。`,
      });
    }
    return Response.json({
      success: false,
      error: audit?.reason || "測試訊號未建立交易稽核紀錄，請檢查 Demo API 權限與 Bitget 回覆。",
    }, { status: 400 });
  }
  
  // 準備要更新的資料物件
  const updateData: any = {};

  const tMode = formData.get("tradingMode") as string;
  if (tMode === "PAPER" || tMode === "LIVE") {
    updateData.tradingMode = tMode;
  }

  // 【詳細繁體中文註解】：讀取並驗證使用者選擇的時間週期
  const sTimeframe = formData.get("strategyTimeframe") as string;
  if (sTimeframe && ['5m', '15m', '1h', '4h'].includes(sTimeframe)) {
    updateData.strategyTimeframe = sTimeframe;
  }

  updateData.capitalBaseUsdt = sanitizeNumber(formData.get("capitalBaseUsdt"), "1000", 10, 100000000);
  updateData.maxRiskPerTradePct = sanitizePercent(formData.get("maxRiskPerTradePct"), "0.5", 0.1, 3);
  updateData.maxDailyLossPct = sanitizePercent(formData.get("maxDailyLossPct"), "1", 0.1, 10);
  updateData.maxPositionSizePct = sanitizePercent(formData.get("maxPositionSizePct"), "10", 1, 100);
  updateData.riskStopLossPct = sanitizePercent(formData.get("riskStopLossPct"), "5", 1, 30);
  updateData.maxOpenPositions = sanitizeInteger(formData.get("maxOpenPositions"), 2, 1, 20);
  updateData.maxTradesPerDay = sanitizeInteger(formData.get("maxTradesPerDay"), 3, 1, 50);
  updateData.cryptoCrashGuardEnabled = formData.get("cryptoCrashGuardEnabled") === "on";
  updateData.liveTradingEnabled = formData.get("liveTradingEnabled") === "on";

  const tBotToken = formData.get("telegramBotToken") as string;
  const tChatId = formData.get("telegramChatId") as string;
  
  // 【詳細繁體中文註解】：安全檢查遮蔽狀態
  // 若使用者送出的值是預設的遮罩（••••••••••••••••），表示未修改該欄位，則不予覆蓋。
  if (tBotToken !== null && tBotToken !== "••••••••••••••••") {
    updateData.telegramBotToken = tBotToken ? await encryptData(tBotToken, masterKey) : null;
  }
  if (tChatId !== null && tChatId !== "••••••••••••••••") {
    updateData.telegramChatId = tChatId ? await encryptData(tChatId, masterKey) : null;
  }

  const bApiKey = formData.get("binanceApiKey") as string;
  const bApiSecret = formData.get("binanceApiSecret") as string;
  
  if (bApiKey !== null && bApiKey !== "••••••••••••••••") {
    updateData.binanceApiKey = bApiKey ? await encryptData(bApiKey, masterKey) : null;
  }
  // 如果使用者沒有填新的 Secret，就不更新（保留原本的）
  if (bApiSecret) {
    updateData.binanceApiSecret = await encryptData(bApiSecret, masterKey);
  }

  const pApiKey = formData.get("pionexApiKey") as string;
  const pApiSecret = formData.get("pionexApiSecret") as string;

  if (pApiKey !== null && pApiKey !== "••••••••••••••••") {
    updateData.pionexApiKey = pApiKey ? await encryptData(pApiKey, masterKey) : null;
  }
  if (pApiSecret) {
    updateData.pionexApiSecret = await encryptData(pApiSecret, masterKey);
  }

  // 【詳細繁體中文註解】：Bitget 金鑰(比 Binance/Pionex 多一組 passphrase)
  const bgApiKey = formData.get("bitgetApiKey") as string;
  const bgApiSecret = formData.get("bitgetApiSecret") as string;
  const bgPassphrase = formData.get("bitgetPassphrase") as string;

  if (bgApiKey !== null && bgApiKey !== "••••••••••••••••") {
    updateData.bitgetApiKey = bgApiKey ? await encryptData(bgApiKey, masterKey) : null;
  }
  if (bgApiSecret) {
    updateData.bitgetApiSecret = await encryptData(bgApiSecret, masterKey);
  }
  if (bgPassphrase) {
    updateData.bitgetPassphrase = await encryptData(bgPassphrase, masterKey);
  }

  // 【安全性註解】：Demo 金鑰不得覆蓋正式 Bitget 金鑰，兩套權限完全分開保存。
  const bgDemoApiKey = formData.get("bitgetDemoApiKey") as string;
  const bgDemoApiSecret = formData.get("bitgetDemoApiSecret") as string;
  const bgDemoPassphrase = formData.get("bitgetDemoPassphrase") as string;
  if (bgDemoApiKey !== null && bgDemoApiKey !== "••••••••••••••••") {
    updateData.bitgetDemoApiKey = bgDemoApiKey ? await encryptData(bgDemoApiKey, masterKey) : null;
  }
  if (bgDemoApiSecret) updateData.bitgetDemoApiSecret = await encryptData(bgDemoApiSecret, masterKey);
  if (bgDemoPassphrase) updateData.bitgetDemoPassphrase = await encryptData(bgDemoPassphrase, masterKey);

  // 【安全性註解】：正式合約金鑰獨立加密保存，不得沿用上方 Bitget 現貨／股票代幣金鑰。
  const bgFuturesLiveApiKey = formData.get("bitgetFuturesLiveApiKey") as string;
  const bgFuturesLiveApiSecret = formData.get("bitgetFuturesLiveApiSecret") as string;
  const bgFuturesLivePassphrase = formData.get("bitgetFuturesLivePassphrase") as string;
  if (bgFuturesLiveApiKey !== null && bgFuturesLiveApiKey !== "••••••••••••••••") {
    updateData.bitgetFuturesLiveApiKey = bgFuturesLiveApiKey ? await encryptData(bgFuturesLiveApiKey, masterKey) : null;
  }
  if (bgFuturesLiveApiSecret) updateData.bitgetFuturesLiveApiSecret = await encryptData(bgFuturesLiveApiSecret, masterKey);
  if (bgFuturesLivePassphrase) updateData.bitgetFuturesLivePassphrase = await encryptData(bgFuturesLivePassphrase, masterKey);

  const futuresExecutionMode = formData.get("bitgetFuturesExecutionMode") as string;
  if (futuresExecutionMode === "DEMO" || futuresExecutionMode === "LIVE") {
    updateData.bitgetFuturesExecutionMode = futuresExecutionMode;
  }

  const preferredExchange = formData.get("preferredExchange") as string;
  if (preferredExchange === "BINANCE" || preferredExchange === "BITGET") {
    updateData.preferredExchange = preferredExchange;
  }

  updateData.stockAutoTradingEnabled = formData.get("stockAutoTradingEnabled") === "on";
  updateData.tradingviewDemoAutoTradingEnabled = formData.get("tradingviewDemoAutoTradingEnabled") === "on";
  updateData.internalDemoAutoTradingEnabled = formData.get("internalDemoAutoTradingEnabled") === "on";
  // 【風控註解】：前端輸入不可直接信任；伺服器將槓桿上限限制為整數 1 至 50。
  updateData.bitgetDemoMaxLeverage = sanitizeInteger(formData.get("bitgetDemoMaxLeverage"), 1, 1, 50);
  updateData.bitgetFuturesLiveMaxLeverage = sanitizeInteger(formData.get("bitgetFuturesLiveMaxLeverage"), 1, 1, 50);

  // 如果有資料要更新
  if (Object.keys(updateData).length > 0) {
    await db.update(users).set(updateData).where(eq(users.id, userId)).run();
    return { success: true, message: "設定已成功儲存！" };
  }

  return { success: false, message: "沒有任何變更" };
  } catch (error) {
    /**
     * 設定表單可能包含交易所 Secret 與 Passphrase；D1 例外的查詢參數可能回顯表單內容，
     * 因此僅在伺服器保留錯誤種類，前端一律收到通用訊息，避免金鑰與資料庫結構外洩。
     */
    console.error('設定儲存失敗', {
      userId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { success: false, message: "設定暫時無法儲存，請重新整理後再試。" };
  }
}

import { AppLayout } from "../components/AppLayout";

export default function SettingsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; message?: string; error?: string }>();
  const navigation = useNavigation();
  const rawSubmit = useSubmit();
  // 即時儲存使用程式提交，不會經過瀏覽器表單驗證，因此先阻擋錯誤數值。
  const submit = (form: HTMLFormElement | null) => {
    if (form && validateNumericInputs(form)) rawSubmit(form);
  };
  const isSubmitting = navigation.state === "submitting";
  
  const fetcher = useFetcher();
  const isTesting = fetcher.state !== "idle";
  const testResult = fetcher.data as { success?: boolean; message?: string; error?: string } | undefined;

  return (
    <AppLayout>
      <div className="p-4 md:p-8">
        <div className="max-w-3xl mx-auto space-y-8">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#141414] pb-4">
            <h1 className="text-2xl md:text-3xl font-serif italic tracking-tight text-[#141414]">個人設定與 API 綁定</h1>
            <Form action="/api/logout" method="post">
              <button type="submit" className="text-red-600 hover:text-red-700 font-medium px-4 py-2 border border-red-600 hover:bg-red-50 rounded-sm transition-colors text-sm">
                登出帳號
              </button>
            </Form>
          </header>

          {(actionData?.message || actionData?.error) && (
            <div className={`p-4 rounded-sm border ${actionData.success ? 'bg-green-50 border-green-600 text-green-800' : 'bg-red-50 border-red-600 text-red-800'}`}>
              {actionData.message || actionData.error}
            </div>
          )}

          <Form method="post" className="space-y-8">
            {/* 交易模式設定 */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E4E3E0] transition-shadow hover:shadow-md">
              <h2 className="text-xl font-medium text-[#141414] mb-4 flex items-center gap-2">
                <span className="text-2xl">⚙️</span> 交易模式設定
              </h2>
              <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                請選擇您的策略執行模式。「模擬交易」將不會實際扣款，僅在系統內紀錄以供績效參考；「實戰交易」將直接使用您的 API Key 進行真實下單。
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <label className={`relative flex-1 p-4 border rounded-lg cursor-pointer transition-all duration-200 overflow-hidden ${data.tradingMode === 'PAPER' ? 'border-indigo-600 bg-indigo-50 shadow-[0_0_0_1px_rgba(79,70,229,1)]' : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'}`}>
                  {data.tradingMode === 'PAPER' && <div className="absolute top-0 right-0 w-12 h-12 bg-indigo-100 rounded-bl-full -z-0 opacity-50"></div>}
                  <input type="radio" name="tradingMode" value="PAPER" defaultChecked={data.tradingMode === 'PAPER'} onChange={(e) => submit(e.currentTarget.form)} className="hidden" />
                  <div className="relative z-10 flex items-center justify-between mb-1">
                    <div className="font-medium text-indigo-900 text-lg">🧪 模擬交易 (Paper)</div>
                    {data.tradingMode === 'PAPER' && <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></div>}
                  </div>
                  <div className="relative z-10 text-sm text-indigo-700/80">安全測試策略，不動用真實資金</div>
                </label>
                <label className={`relative flex-1 p-4 border rounded-lg cursor-pointer transition-all duration-200 overflow-hidden ${data.tradingMode === 'LIVE' ? 'border-red-600 bg-red-50 shadow-[0_0_0_1px_rgba(220,38,38,1)]' : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'}`}>
                  {data.tradingMode === 'LIVE' && <div className="absolute top-0 right-0 w-12 h-12 bg-red-100 rounded-bl-full -z-0 opacity-50"></div>}
                  <input type="radio" name="tradingMode" value="LIVE" defaultChecked={data.tradingMode === 'LIVE'} onChange={(e) => submit(e.currentTarget.form)} className="hidden" />
                  <div className="relative z-10 flex items-center justify-between mb-1">
                    <div className="font-medium text-red-700 text-lg">🔥 實戰交易 (Live)</div>
                    {data.tradingMode === 'LIVE' && <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></div>}
                  </div>
                  <div className="relative z-10 text-sm text-red-600/80">真實扣款下單，盈虧自負</div>
                </label>
              </div>

              <div className="mt-6">
                <label className="block text-sm font-bold text-[#141414] mb-2">加密貨幣自動交易偏好交易所</label>
                <p className="text-xs text-gray-500 mb-3">RSI 抄底策略要用哪個交易所下單，切換後請確認下方對應的 API 金鑰已填妥。</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className={`relative flex-1 p-3 border rounded-lg cursor-pointer transition-all duration-200 ${data.preferredExchange === 'BINANCE' ? 'border-yellow-600 bg-yellow-50 shadow-[0_0_0_1px_rgba(202,138,4,1)]' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                    <input type="radio" name="preferredExchange" value="BINANCE" defaultChecked={data.preferredExchange === 'BINANCE'} onChange={(e) => submit(e.currentTarget.form)} className="hidden" />
                    <div className="font-medium text-[#141414]">Binance 幣安</div>
                  </label>
                  <label className={`relative flex-1 p-3 border rounded-lg cursor-pointer transition-all duration-200 ${data.preferredExchange === 'BITGET' ? 'border-sky-600 bg-sky-50 shadow-[0_0_0_1px_rgba(2,132,199,1)]' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                    <input type="radio" name="preferredExchange" value="BITGET" defaultChecked={data.preferredExchange === 'BITGET'} onChange={(e) => submit(e.currentTarget.form)} className="hidden" />
                    <div className="font-medium text-[#141414]">Bitget</div>
                  </label>
                </div>
              </div>
            </div>

            {/* 【詳細繁體中文註解】：策略盯盤時間週期設定區塊，支援自動點擊儲存 */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E4E3E0] transition-shadow hover:shadow-md">
              <h2 className="text-xl font-medium text-[#141414] mb-4 flex items-center gap-2">
                <span className="text-2xl">⏱️</span> 策略週期設定
              </h2>
              <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                請選擇 RSI 抄底策略所參考的 K 線時間週期。更短的週期（如 5m）會提供更頻繁的交易機會，但也可能伴隨較多雜訊。
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['5m', '15m', '1h', '4h'].map((tf) => {
                  const isSelected = data.strategyTimeframe === tf;
                  return (
                    <label
                      key={tf}
                      className={`relative p-3 border rounded-lg cursor-pointer text-center font-bold transition-all duration-200 ${
                        isSelected 
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-[0_0_0_1px_rgba(37,99,235,1)]' 
                          : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="strategyTimeframe"
                        value={tf}
                        defaultChecked={isSelected}
                        onChange={(e) => submit(e.currentTarget.form)}
                        className="hidden"
                      />
                      <div className="text-lg mb-1">{tf}</div>
                      <div className="text-xs font-normal text-gray-500">
                        {tf === '5m' && '5 分鐘線'}
                        {tf === '15m' && '15 分鐘線'}
                        {tf === '1h' && '1 小時線'}
                        {tf === '4h' && '4 小時線'}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 本金保護設定 */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E4E3E0] transition-shadow hover:shadow-md">
              <h2 className="text-xl font-medium text-[#141414] mb-4 flex items-center gap-2">
                <span className="text-2xl">盾</span> 本金保護設定
              </h2>
              <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                這些參數會在任何虛擬幣開倉前先檢查。LIVE 模式還需要額外打開實戰授權，避免誤觸真實下單。
              </p>

              <RiskSettingsFields values={data} />

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start gap-3 p-4 border border-[#141414] rounded-sm bg-[#E4E3E0] cursor-pointer">
                  <input
                    type="checkbox"
                    name="cryptoCrashGuardEnabled"
                    defaultChecked={data.cryptoCrashGuardEnabled}
                    className="mt-1 h-4 w-4 accent-[#141414]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#141414]">啟用虛擬幣崩盤保護</span>
                    <span className="block text-xs text-gray-600 mt-1">BTC 急跌、跌破 MA200 或爆量長黑時，暫停做多。</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 p-4 border border-red-700 rounded-sm bg-red-50 cursor-pointer">
                  <input
                    type="checkbox"
                    name="liveTradingEnabled"
                    defaultChecked={data.liveTradingEnabled}
                    className="mt-1 h-4 w-4 accent-red-700"
                  />
                  <span>
                    <span className="block text-sm font-bold text-red-800">允許 LIVE 真實下單</span>
                    <span className="block text-xs text-red-700 mt-1">未勾選時，即使交易模式選 LIVE，系統也會阻擋新開倉。</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Telegram 設定區塊 */}
            <div className="bg-[#E4E3E0] p-6 rounded-sm border border-[#141414]">
              <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                <h2 className="text-xl font-bold text-[#141414] flex items-center">
                  <span className="w-2 h-6 bg-blue-600 rounded-sm mr-3"></span>
                  Telegram 通知設定
                </h2>
                <button
                  type="button"
                  disabled={isTesting || (!data.telegramBotToken || !data.telegramChatId)}
                  onClick={() => fetcher.submit({}, { method: "post", action: "/api/test-telegram" })}
                  className="px-4 py-2 text-sm font-bold border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-sm"
                >
                  {isTesting ? "測試中..." : "測試發送訊息"}
                </button>
              </div>
              
              {testResult && (
                <div className={`mb-4 p-3 rounded-sm border text-sm font-bold ${testResult.success ? 'bg-green-50 border-green-600 text-green-800' : 'bg-red-50 border-red-600 text-red-800'}`}>
                  {testResult.success ? testResult.message : testResult.error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">Bot Token</label>
                  <input
                    type="text"
                    name="telegramBotToken"
                    defaultValue={data.telegramBotToken}
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder="123456789:ABCdef..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">Chat ID</label>
                  <input
                    type="text"
                    name="telegramChatId"
                    defaultValue={data.telegramChatId}
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder="您的 Chat ID 或 頻道 ID"
                  />
                </div>
              </div>
            </div>

            {/* Binance API 設定區塊 */}
            <div className="bg-[#E4E3E0] p-6 rounded-sm border border-[#141414]">
              <h2 className="text-xl font-bold text-[#141414] mb-4 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center">
                  <span className="w-2 h-6 bg-yellow-500 rounded-sm mr-3"></span>
                  Binance 幣安 API
                </div>
                {data.hasBinance && (
                  <span className="px-2 py-1 text-xs bg-green-100 text-green-800 border border-green-600 rounded-sm font-bold">
                    已綁定
                  </span>
                )}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">API Key</label>
                  <input
                    type="text"
                    name="binanceApiKey"
                    defaultValue={data.binanceApiKey}
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder="輸入 Binance API Key"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">
                    Secret Key
                    {data.hasBinance && <span className="text-yellow-600 ml-2 font-normal text-xs">(基於安全，已綁定的 Secret 隱藏顯示。若需更改請直接輸入新值)</span>}
                  </label>
                  <input
                    type="password"
                    name="binanceApiSecret"
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder={data.hasBinance ? "••••••••••••••••••••••••" : "輸入 Binance Secret Key"}
                  />
                </div>
              </div>
            </div>

            {/* Pionex API 設定區塊 */}
            <div className="bg-[#E4E3E0] p-6 rounded-sm border border-[#141414]">
              <h2 className="text-xl font-bold text-[#141414] mb-4 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center">
                  <span className="w-2 h-6 bg-orange-500 rounded-sm mr-3"></span>
                  Pionex 派網 API
                </div>
                {data.hasPionex && (
                  <span className="px-2 py-1 text-xs bg-green-100 text-green-800 border border-green-600 rounded-sm font-bold">
                    已綁定
                  </span>
                )}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">API Key</label>
                  <input
                    type="text"
                    name="pionexApiKey"
                    defaultValue={data.pionexApiKey}
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder="輸入 Pionex API Key"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">
                    Secret Key
                    {data.hasPionex && <span className="text-orange-600 ml-2 font-normal text-xs">(已隱藏。若需更改請直接輸入新值)</span>}
                  </label>
                  <input
                    type="password"
                    name="pionexApiSecret"
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder={data.hasPionex ? "••••••••••••••••••••••••" : "輸入 Pionex Secret Key"}
                  />
                </div>
              </div>
            </div>

            {/* Bitget API 設定區塊 */}
            <div className="bg-[#E4E3E0] p-6 rounded-sm border border-[#141414]">
              <h2 className="text-xl font-bold text-[#141414] mb-4 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center">
                  <span className="w-2 h-6 bg-sky-500 rounded-sm mr-3"></span>
                  Bitget API
                </div>
                {data.hasBitget && (
                  <span className="px-2 py-1 text-xs bg-green-100 text-green-800 border border-green-600 rounded-sm font-bold">
                    已綁定
                  </span>
                )}
              </h2>
              <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                Bitget 除了 API Key/Secret，額外需要建立金鑰時自訂的 Passphrase。此組金鑰同時用於「加密貨幣自動交易(選擇 Bitget 時)」與「美股代幣(rToken)自動交易」。
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">API Key</label>
                  <input
                    type="text"
                    name="bitgetApiKey"
                    defaultValue={data.bitgetApiKey}
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder="輸入 Bitget API Key"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">
                    Secret Key
                    {data.hasBitget && <span className="text-sky-600 ml-2 font-normal text-xs">(已隱藏。若需更改請直接輸入新值)</span>}
                  </label>
                  <input
                    type="password"
                    name="bitgetApiSecret"
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder={data.hasBitget ? "••••••••••••••••••••••••" : "輸入 Bitget Secret Key"}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#141414] mb-1">
                    Passphrase
                    {data.hasBitget && <span className="text-sky-600 ml-2 font-normal text-xs">(已隱藏。若需更改請直接輸入新值)</span>}
                  </label>
                  <input
                    type="password"
                    name="bitgetPassphrase"
                    className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:ring-1 focus:ring-[#141414] focus:outline-none placeholder-gray-400"
                    placeholder={data.hasBitget ? "••••••••••••••••••••••••" : "建立 API 金鑰時自訂的 Passphrase"}
                  />
                </div>
              </div>
            </div>

            {/* Bitget 合約：Demo 與 LIVE 憑證完全分離，模式切換不會搬用另一組金鑰。 */}
            <div className="bg-sky-50 p-6 rounded-sm border border-sky-700">
              <h2 className="text-xl font-bold text-[#141414] mb-3 flex items-center justify-between flex-wrap gap-2">
                <span>Bitget USDT 永續自動交易</span>
                <span className="flex gap-2">
                  {data.hasBitgetDemo && <span className="px-2 py-1 text-xs bg-green-100 text-green-800 border border-green-600 rounded-sm">Demo 已綁定</span>}
                  {data.hasBitgetFuturesLive && <span className="px-2 py-1 text-xs bg-red-100 text-red-800 border border-red-600 rounded-sm">正式合約已綁定</span>}
                </span>
              </h2>
              <p className="text-sm text-gray-700 mb-4 leading-relaxed">
                此區設定 USDT 永續憑證與槓桿，固定逐倉。單筆計畫風險最多 0.25%、名目部位最多本金 5%。
                吃大魚舊來源只做多；合約專用策略支援多空，請至合約頁設定獨立的 Demo 自動化授權。
                Demo 與正式盤使用不同金鑰，正式盤還須開啟上方「允許 LIVE 真實下單」。
              </p>
              <p className="mb-4 text-sm"><Link to="/crypto-futures" className="font-bold text-sky-800 underline">前往合約頁：檢查 Demo 連線與設定自動交易</Link></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {(['DEMO', 'LIVE'] as const).map(mode => (
                  <label key={mode} className={`p-4 border rounded-sm cursor-pointer ${data.bitgetFuturesExecutionMode === mode ? (mode === 'LIVE' ? 'border-red-700 bg-red-50' : 'border-sky-700 bg-white') : 'border-gray-300 bg-gray-50'}`}>
                    <input type="radio" name="bitgetFuturesExecutionMode" value={mode}
                      defaultChecked={data.bitgetFuturesExecutionMode === mode} onChange={(e) => submit(e.currentTarget.form)} className="mr-2" />
                    <strong>{mode === 'LIVE' ? '⚠️ 正式盤 LIVE' : '🧪 模擬盤 DEMO'}</strong>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <fieldset className="grid gap-3 p-4 border border-sky-700 bg-white rounded-sm">
                  <legend className="px-2 font-bold">Demo 專用憑證</legend>
                  <input type="text" name="bitgetDemoApiKey" defaultValue={data.bitgetDemoApiKey} className="w-full px-4 py-2 border border-sky-700 rounded-sm" placeholder="Demo API Key" />
                  <input type="password" name="bitgetDemoApiSecret" className="w-full px-4 py-2 border border-sky-700 rounded-sm" placeholder={data.hasBitgetDemo ? "Demo Secret 已隱藏；不變更請留空" : "Demo Secret Key"} />
                  <input type="password" name="bitgetDemoPassphrase" className="w-full px-4 py-2 border border-sky-700 rounded-sm" placeholder={data.hasBitgetDemo ? "Demo Passphrase 已隱藏；不變更請留空" : "Demo Passphrase"} />
                  <label className="grid gap-1 text-sm font-bold">槓桿上限
                    <NumericInput  label="Demo 槓桿上限" name="bitgetDemoMaxLeverage" min="1" max="50" step="1" defaultValue={data.bitgetDemoMaxLeverage} className="w-full px-4 py-2 border border-sky-700 rounded-sm" />
                  </label>
                </fieldset>
                <fieldset className="grid gap-3 p-4 border border-red-700 bg-red-50 rounded-sm">
                  <legend className="px-2 font-bold text-red-900">正式合約專用憑證</legend>
                  <input type="text" name="bitgetFuturesLiveApiKey" defaultValue={data.bitgetFuturesLiveApiKey} className="w-full px-4 py-2 bg-white border border-red-700 rounded-sm" placeholder="正式合約 API Key" />
                  <input type="password" name="bitgetFuturesLiveApiSecret" className="w-full px-4 py-2 bg-white border border-red-700 rounded-sm" placeholder={data.hasBitgetFuturesLive ? "正式 Secret 已隱藏；不變更請留空" : "正式合約 Secret Key"} />
                  <input type="password" name="bitgetFuturesLivePassphrase" className="w-full px-4 py-2 bg-white border border-red-700 rounded-sm" placeholder={data.hasBitgetFuturesLive ? "正式 Passphrase 已隱藏；不變更請留空" : "正式合約 Passphrase"} />
                  <label className="grid gap-1 text-sm font-bold text-red-900">槓桿上限
                    <NumericInput  label="正式合約槓桿上限" name="bitgetFuturesLiveMaxLeverage" min="1" max="50" step="1" defaultValue={data.bitgetFuturesLiveMaxLeverage} className="w-full px-4 py-2 bg-white border border-red-700 rounded-sm" />
                  </label>
                  <small className="text-red-800">API 權限只開 Read／Trade，請勿開啟提領。若執行環境有固定出口 IP，再於 Bitget 啟用 IP 白名單；一般 Cloudflare Workers 預設沒有專用固定出口 IP。</small>
                </fieldset>
              </div>
              <div className="mt-5 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" name="tradingviewDemoAutoTradingEnabled"
                    defaultChecked={data.tradingviewDemoAutoTradingEnabled} className="mt-1 h-4 w-4" />
                  <span><strong>TradingView 吃大魚訊號</strong><br /><small className="text-gray-600">只接受 30 分鐘內、價格與方向完整的 Webhook。</small></span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" name="internalDemoAutoTradingEnabled"
                    defaultChecked={data.internalDemoAutoTradingEnabled} className="mt-1 h-4 w-4" />
                  <span><strong>系統自己的吃大魚訊號</strong><br /><small className="text-gray-600">最佳型與 Supertrend 翻綠才開倉；MACD 提早型只通知。</small></span>
                </label>
              </div>
              <p className="mt-4 text-xs text-amber-800">關閉訊號或 LIVE 授權只停止新開倉；既有多單仍保留 Bitget 原生停損與每五分鐘備援檢查。</p>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-sky-200 pt-4">
                <button
                  type="submit"
                  name="intent"
                  value="testBitgetDemoOrder"
                  disabled={isTesting || data.bitgetFuturesExecutionMode !== 'DEMO' || !data.hasBitgetDemo || !data.tradingviewDemoAutoTradingEnabled}
                  className="px-4 py-2 bg-sky-700 text-white font-bold rounded-sm disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isTesting ? 'Demo 測試送出中…' : '送出 1 筆 Demo 連線測試'}
                </button>
                <span className="text-xs text-gray-700">BTCUSDT、最小風控多單；強制使用 Demo，不會建立正式盤訂單。</span>
              </div>
              {testResult && (
                <p className={`mt-3 text-sm font-bold ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  {testResult.success ? testResult.message : testResult.error}
                </p>
              )}
            </div>

            {/* 美股代幣自動交易設定區塊 */}
            <div className="bg-[#E4E3E0] p-6 rounded-sm border border-[#141414]">
              <h2 className="text-xl font-bold text-[#141414] mb-4 flex items-center">
                <span className="w-2 h-6 bg-purple-500 rounded-sm mr-3"></span>
                美股代幣自動交易(Bitget rToken)
              </h2>
              <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                虛擬幣概念美股(COIN、MSTR 等)日線策略觸發時，透過 Bitget 股票代幣(如 COIN → RCOINUSDT)自動下單，
                同樣受上方交易模式(PAPER/LIVE)與「允許 LIVE 真實下單」開關保護。<br />
                ⚠️ 股票代幣是 Bitget 自家撮合的合成商品，非真正股票所有權，無股東投票權；交易時段為 24/5 延長時段而非全天候，
                手續費與買賣價差可能與一般加密貨幣不同，請先詳閱 Bitget 官方說明。
              </p>
              <label className="flex items-start gap-3 p-4 border border-purple-700 rounded-sm bg-purple-50 cursor-pointer">
                <input
                  type="checkbox"
                  name="stockAutoTradingEnabled"
                  defaultChecked={data.stockAutoTradingEnabled}
                  className="mt-1 h-4 w-4 accent-purple-700"
                />
                <span>
                  <span className="block text-sm font-bold text-purple-900">啟用美股代幣自動交易</span>
                  <span className="block text-xs text-purple-700 mt-1">
                    需同時填妥上方 Bitget 三把金鑰才會生效；未啟用時，美股訊號僅發送 Slack 通知、不會下單。
                  </span>
                </span>
              </label>
            </div>

            {/* 儲存按鈕 */}
            <div className="flex justify-end pt-4 pb-8">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-8 py-3 bg-[#141414] hover:bg-black disabled:bg-gray-600 disabled:cursor-not-allowed text-[#E4E3E0] font-bold rounded-sm transition-colors border border-[#141414]"
              >
                {isSubmitting ? "儲存中..." : "儲存設定"}
              </button>
            </div>
          </Form>
        </div>
      </div>
    </AppLayout>
  );
}
