import { type LoaderFunctionArgs } from "react-router";
import { getUserId } from "../utils/auth";

// 取得前 50 大交易量股票的 Loader
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context.cloudflare as any)?.env || process.env;

    // 安全審查：加上登入驗證
    const userId = await getUserId(request, env);
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const market = url.searchParams.get("market");
    let symbols: { symbol: string; name: string }[] = [];

    if (market === "US") {
      const fetchUrl = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=most_actives&count=50`;
      const response = await fetch(fetchUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const data = await response.json();
      if (data.finance?.result?.[0]?.quotes) {
        symbols = data.finance.result[0].quotes.map((q: any) => ({
          symbol: q.symbol,
          name: q.shortName || q.longName || q.symbol,
        }));
      }
    } else if (market === "TW") {
      const fetchUrl = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALL`;
      const response = await fetch(fetchUrl);
      const data = await response.json();
      if (data.tables) {
        const mainTable = data.tables.find(
          (t: any) => t.title && t.title.includes("每日收盤行情")
        );
        if (mainTable) {
          const stocks = mainTable.data
            .filter((row: any) => row[0].length === 4) // 過濾出普通股
            .map((row: any) => ({
              symbol: row[0] + ".TW",
              name: row[1],
              volume: parseInt(row[2].replace(/,/g, "")),
            }))
            .sort((a: any, b: any) => b.volume - a.volume);

          symbols = stocks.slice(0, 50).map((s: any) => ({
            symbol: s.symbol,
            name: s.name,
          }));
        }
      }
    } else if (market === "CRYPTO") {
      const fetchUrl = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=US&scrIds=all_cryptocurrencies_us&count=50`;
      const response = await fetch(fetchUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const data = await response.json();
      if (data.finance?.result?.[0]?.quotes) {
        symbols = data.finance.result[0].quotes.map((q: any) => ({
          symbol: q.symbol,
          name: q.shortName || q.longName || q.symbol,
        }));
      }
    }

    // 回傳 JSON 給前端
    return Response.json({ symbols });
  } catch (error: any) {
    console.error(`Error fetching top 50 for ${request.url}:`, error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
