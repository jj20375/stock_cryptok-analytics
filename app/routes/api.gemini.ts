import { type ActionFunctionArgs } from "react-router";
import { GoogleGenAI, Type } from "@google/genai";

// 處理來自前端的 AI 請求
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return Response.json({ error: "Server API Key not configured." }, { status: 500 });
    }

    const genAI = new GoogleGenAI({ apiKey });

    // 依據請求的 type 區分是「單一策略分析」還是「掃描器多檔分析」
    if (data.type === "strategy") {
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: data.prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              marketData: { type: Type.STRING },
              matchAnalysis: { type: Type.STRING },
              conclusion: { type: Type.STRING },
              actionPlan: { type: Type.STRING },
              riskWarning: { type: Type.STRING },
            },
            required: ["marketData", "matchAnalysis", "conclusion", "actionPlan", "riskWarning"],
          },
        },
      });

      const result = JSON.parse(response.text || "{}");
      return Response.json(result);
    } else if (data.type === "scanner") {
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: data.prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    symbol: { type: Type.STRING },
                    aiInsight: { type: Type.STRING },
                  },
                  required: ["symbol", "aiInsight"],
                },
              },
            },
            required: ["recommendations"],
          },
        },
      });

      const result = JSON.parse(response.text || "{}");
      return Response.json(result);
    }

    return Response.json({ error: "Invalid type" }, { status: 400 });
  } catch (err: any) {
    console.error("Action Error:", err);
    return Response.json(
      { error: err.message || "Unknown error occurred on server." },
      { status: 500 }
    );
  }
}
