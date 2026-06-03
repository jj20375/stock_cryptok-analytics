import { type ActionFunctionArgs } from "react-router";
import { getAIResponse } from "../services/aiService";
import { Type } from "@google/genai";

// 處理來自前端的 AI 請求
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json();
    const env = (context.cloudflare as any)?.env || process.env;

    // 定義對應不同 Request 類型的 Schema，確保 Gemini 輸出格式穩定
    let responseSchema: any = undefined;

    if (data.type === "strategy") {
      responseSchema = {
        type: Type.OBJECT,
        properties: {
          marketData: { type: Type.STRING },
          matchAnalysis: { type: Type.STRING },
          conclusion: { type: Type.STRING },
          actionPlan: { type: Type.STRING },
          riskWarning: { type: Type.STRING },
        },
        required: ["marketData", "matchAnalysis", "conclusion", "actionPlan", "riskWarning"],
      };
    } else if (data.type === "scanner") {
      responseSchema = {
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
      };
    }

    const resultText = await getAIResponse(data.prompt, {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    }, env);

    const result = JSON.parse(resultText || "{}");
    return Response.json(result);

  } catch (err: any) {
    console.error("AI Action Error:", err);
    return Response.json(
      { error: err.message || "Unknown error occurred on server." },
      { status: 500 }
    );
  }
}
