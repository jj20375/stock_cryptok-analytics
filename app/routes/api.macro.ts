import { type LoaderFunctionArgs } from "react-router";
import { getMacroIndicators, type MacroIndicators } from "../services/macroService";
import { recordMacroSnapshot } from "../services/macro/snapshotStore.server";

/**
 * 【詳細繁體中文註解】
 * 全球總體經濟（美債、匯率、期貨、債券利差）多空風向球 API 端點
 * 用途：提供首頁與 Dashboard 即時讀取最新宏觀多空走向與四大維度判讀
 * 內建 3 分鐘記憶體快取，避免頻繁觸發 Yahoo Finance 限流，並支援 ?refresh=1 強制更新
 * 副作用：每次重新計算時，於背景寫入一筆 API_VIEW 預測快照到 D1（15 分鐘節流，失敗不影響回應）
 */
let cachedMacro: { data: MacroIndicators; expiresAt: number } | null = null;
const MACRO_CACHE_TTL_MS = 3 * 60 * 1000;

export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const now = Date.now();

    if (!forceRefresh && cachedMacro && cachedMacro.expiresAt > now) {
      return Response.json(
        { indicators: cachedMacro.data, cached: true },
        {
          headers: {
            "Cache-Control": "private, max-age=60",
          },
        }
      );
    }

    // 獲取最新總經數據（包含美債、匯率、期貨、債券利差與市場看漲/看跌總結）
    const indicators = await getMacroIndicators();

    if (!indicators) {
      // 若短暫網路異常但有舊快取，安全回退至舊快取
      if (cachedMacro?.data) {
        return Response.json({ indicators: cachedMacro.data, cached: true, stale: true });
      }
      return Response.json({ error: "Failed to fetch macro indicators" }, { status: 500 });
    }

    cachedMacro = {
      data: indicators,
      expiresAt: now + MACRO_CACHE_TTL_MS,
    };

    // 記下「使用者當下看到的判讀」，事後才能檢討預判失準；用 waitUntil 背景執行，不拖慢回應
    const cloudflare = (context as any)?.cloudflare;
    if (cloudflare?.env?.DB) {
      const snapshotTask = recordMacroSnapshot(cloudflare.env, indicators, "API_VIEW");
      if (cloudflare.ctx?.waitUntil) cloudflare.ctx.waitUntil(snapshotTask);
      else await snapshotTask;
    }

    return Response.json(
      { indicators, cached: false },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error: any) {
    console.error("❌ [API Macro] 執行失敗:", error);
    return Response.json({ error: error.message || "未知錯誤" }, { status: 500 });
  }
}
