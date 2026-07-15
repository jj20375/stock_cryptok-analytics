import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { userPortfolio } from "../db/schema";
import { getSession } from "../utils/auth";
import { fetchPriceFromServer } from "../services/stockService";

/**
 * 【詳細繁體中文註解】：處理使用者持股清單的讀取 (GET)
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context.cloudflare as any)?.env || process.env;
  const session = await getSession(request, env);
  const userId = session.get("userId");

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = drizzle(env.DB);

    const portfolioRaw = await db
      .select()
      .from(userPortfolio)
      .where(eq(userPortfolio.userId, userId))
      .all();

    // 為每項持股獲取即時價格
    const portfolio = await Promise.all(portfolioRaw.map(async (item) => {
      const currentPrice = await fetchPriceFromServer(item.symbol);
      return { ...item, currentPrice };
    }));

    return Response.json({ portfolio });
  } catch (error: any) {
    console.error("Failed to load portfolio:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * 【詳細繁體中文註解】：處理使用者持股的新增 (POST)、更新 (PUT) 與刪除 (DELETE)
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context.cloudflare as any)?.env || process.env;
  const session = await getSession(request, env);
  const userId = session.get("userId");

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = drizzle(env.DB);

  if (request.method === "POST") {
    try {
      const { symbol, name, market, avgPrice, shares, fees } = await request.json();

      if (!symbol || !market) {
        return Response.json({ error: "Missing required fields" }, { status: 400 });
      }

      // 檢查是否已經存在於清單中
      const existing = await db
        .select()
        .from(userPortfolio)
        .where(
          and(
            eq(userPortfolio.userId, userId),
            eq(userPortfolio.symbol, symbol)
          )
        )
        .get();

      if (existing) {
        return Response.json({ message: "Already in portfolio" }, { status: 200 });
      }

      await db.insert(userPortfolio).values({
        userId,
        symbol,
        name,
        market,
        avgPrice: avgPrice?.toString(),
        shares: shares?.toString(),
        fees: fees?.toString(),
      }).run();

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  if (request.method === "PUT") {
    try {
      const { symbol, avgPrice, shares, fees } = await request.json();

      if (!symbol) {
        return Response.json({ error: "Missing symbol" }, { status: 400 });
      }

      await db
        .update(userPortfolio)
        .set({
          avgPrice: avgPrice?.toString(),
          shares: shares?.toString(),
          fees: fees?.toString(),
        })
        .where(
          and(
            eq(userPortfolio.userId, userId),
            eq(userPortfolio.symbol, symbol)
          )
        )
        .run();

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  if (request.method === "DELETE") {
    try {
      const { symbol } = await request.json();

      if (!symbol) {
        return Response.json({ error: "Missing symbol" }, { status: 400 });
      }

      await db
        .delete(userPortfolio)
        .where(
          and(
            eq(userPortfolio.userId, userId),
            eq(userPortfolio.symbol, symbol)
          )
        )
        .run();

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
