import { type LoaderFunctionArgs } from "react-router";

// 代理 Yahoo Finance 的報價 Loader
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const symbol = params["*"];
    if (!symbol) {
      return Response.json({ error: "Missing symbol" }, { status: 400 });
    }

    const urlParams = new URL(request.url).searchParams;
    const range = urlParams.get("range") || "6mo";
    const interval = urlParams.get("interval") || "1d";

    let yfSymbol = symbol;
    // 處理台股與格式轉換
    if (symbol.endsWith(".TW")) {
      yfSymbol = symbol;
    } else if (/^\d{4}$/.test(symbol)) {
      yfSymbol = `${symbol}.TW`;
    } else if (symbol.includes("/")) {
      yfSymbol = symbol.replace("/", "-");
    }

    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSymbol}?range=${range}&interval=${interval}`;

    let response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    // 如果 404 而且是 .TW 股票，改嘗試 .TWO (櫃買中心)
    if (response.status === 404 && yfSymbol.endsWith(".TW")) {
      const twoSymbol = yfSymbol.replace(".TW", ".TWO");
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${twoSymbol}?range=${range}&interval=${interval}`;
      response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Yahoo Finance API returned ${response.status} for ${yfSymbol}`);
      return Response.json(
        { error: `Yahoo Finance API returned ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error: any) {
    console.error("Error fetching from Yahoo Finance:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
