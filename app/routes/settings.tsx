import { Form, redirect, useLoaderData, useActionData, useNavigation, useFetcher, useSubmit } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { getUserId } from "../utils/auth";
import { encryptData, decryptData } from "../utils/encryption";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const userId = await getUserId(request);
  if (!userId) {
    return redirect("/login");
  }

  const env = context.cloudflare.env as any;
  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return redirect("/login");
  }

  // 解密可供前端顯示的資料
  const telegramBotToken = user.telegramBotToken ? await decryptData(user.telegramBotToken, masterKey) : "";
  const telegramChatId = user.telegramChatId ? await decryptData(user.telegramChatId, masterKey) : "";

  // 【詳細繁體中文註解】：將使用者自訂的策略時間週期帶給前端
  return {
    telegramBotToken,
    telegramChatId,
    tradingMode: user.tradingMode,
    strategyTimeframe: user.strategyTimeframe || '15m',
    hasBinance: !!user.binanceApiKey && !!user.binanceApiSecret,
    hasPionex: !!user.pionexApiKey && !!user.pionexApiSecret,
    binanceApiKey: user.binanceApiKey ? await decryptData(user.binanceApiKey, masterKey) : "",
    pionexApiKey: user.pionexApiKey ? await decryptData(user.pionexApiKey, masterKey) : "",
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const userId = await getUserId(request);
  if (!userId) return redirect("/login");

  const env = context.cloudflare.env as any;
  const db = drizzle(env.DB);
  const masterKey = env.MASTER_ENCRYPTION_KEY;

  const formData = await request.formData();
  
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

  const tBotToken = formData.get("telegramBotToken") as string;
  const tChatId = formData.get("telegramChatId") as string;
  
  if (tBotToken !== null) updateData.telegramBotToken = await encryptData(tBotToken, masterKey);
  if (tChatId !== null) updateData.telegramChatId = await encryptData(tChatId, masterKey);

  const bApiKey = formData.get("binanceApiKey") as string;
  const bApiSecret = formData.get("binanceApiSecret") as string;
  
  if (bApiKey) updateData.binanceApiKey = await encryptData(bApiKey, masterKey);
  // 如果使用者沒有填新的 Secret，就不更新（保留原本的）
  if (bApiSecret) updateData.binanceApiSecret = await encryptData(bApiSecret, masterKey);

  const pApiKey = formData.get("pionexApiKey") as string;
  const pApiSecret = formData.get("pionexApiSecret") as string;
  
  if (pApiKey) updateData.pionexApiKey = await encryptData(pApiKey, masterKey);
  if (pApiSecret) updateData.pionexApiSecret = await encryptData(pApiSecret, masterKey);

  // 如果有資料要更新
  if (Object.keys(updateData).length > 0) {
    await db.update(users).set(updateData).where(eq(users.id, userId)).run();
    return { success: true, message: "設定已成功儲存！" };
  }

  return { success: false, message: "沒有任何變更" };
}

import { AppLayout } from "../components/AppLayout";

export default function SettingsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success?: boolean; message?: string }>();
  const navigation = useNavigation();
  const submit = useSubmit();
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

          {actionData?.message && (
            <div className={`p-4 rounded-sm border ${actionData.success ? 'bg-green-50 border-green-600 text-green-800' : 'bg-red-50 border-red-600 text-red-800'}`}>
              {actionData.message}
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
