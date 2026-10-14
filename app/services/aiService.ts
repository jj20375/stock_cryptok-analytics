import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

/**
 * 【詳細繁體中文註解】：統一 AI 調度服務 (重構版)
 * 已將 OpenAI 與 Gemini 邏輯拆分，並支援 NVIDIA API 相容介面
 */

export interface AIResponseOptions {
    responseMimeType?: string;
    responseSchema?: any;
}

/**
 * 總調度員：根據環境變數決定使用哪個 AI 供應商
 */
export async function getAIResponse(prompt: string, options: AIResponseOptions = {}, env: any = {}) {
    const provider = (env.AI_PROVIDER || process.env.AI_PROVIDER || "gemini").toLowerCase();

    if (provider === "openai" || provider === "nvidia") {
        return getOpenAIResponse(prompt, options, env);
    } else if (provider === "claude" || provider === "anthropic") {
        return getClaudeResponse(prompt, options, env);
    } else if (provider === "codex") {
        return getCodexResponse(prompt, options, env);
    } else {
        return getGeminiResponse(prompt, options, env);
    }
}

/**
 * 【詳細繁體中文註解】：清理 AI 回傳的文字
 * 有些模型會頑皮地加上 ```json ... ``` 標籤，這會導致 JSON.parse 失敗
 * 此函數會自動偵測並提取純粹的 JSON 內容
 */
function cleanJsonResponse(text: string): string {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
    if (jsonMatch) return jsonMatch[1].trim();
    return text.trim();
}

/**
 * OpenAI / NVIDIA 服務實現
 */
export async function getOpenAIResponse(prompt: string, options: AIResponseOptions = {}, env: any = {}) {
    const apiKey = env.NVIDIA_API_KEY || env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = env.AI_BASE_URL || process.env.AI_BASE_URL || "https://integrate.api.nvidia.com/v1";
    const modelName = env.AI_MODEL || process.env.AI_MODEL || "deepseek-ai/deepseek-v4-pro";

    if (!apiKey) throw new Error("AI API key (NVIDIA or OpenAI) not configured");

    const openai = new OpenAI({
        apiKey,
        baseURL,
        timeout: 120000, // 增加到 120 秒
    });

    const responseFormat: any = options.responseMimeType === "application/json" ? { type: "json_object" } : undefined;

    console.log(`[AI] Sending request to ${modelName}...`);
    const startTime = Date.now();
    try {
        const stream: any = await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            top_p: 0.95,
            max_tokens: 4096,
            chat_template_kwargs: { thinking: false },
            response_format: responseFormat,
            stream: true,
        } as any);

        let fullContent = "";
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            fullContent += content;
        }

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[AI] Model: ${modelName} responded in ${duration}s`);
        
        if (!fullContent) throw new Error("AI 回傳內容為空");
        return cleanJsonResponse(fullContent);
    } catch (err: any) {
        const duration = (Date.now() - startTime) / 1000;
        console.error(`❌ AI 發生錯誤 (${modelName}) 耗時 ${duration}s:`, err);
        throw new Error(`AI 分析中斷: ${err.message || "連線異常"}`);
    }
}

/**
 * Google Gemini 服務實現 (@google/genai 新版 SDK)
 */
export async function getGeminiResponse(prompt: string, options: AIResponseOptions = {}, env: any = {}) {
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    // 未指定 AI_MODEL 時使用 3.1 Flash-Lite；雲端與本機的明確模型設定仍優先。
    const modelName = env.AI_MODEL || process.env.AI_MODEL || "gemini-3.1-flash-lite";

    if (!apiKey) throw new Error("Gemini API key not configured");

    const client = new GoogleGenAI({ apiKey });

    try {
        const response = await client.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                responseMimeType: options.responseMimeType,
                responseSchema: options.responseSchema,
            },
        });

        const text = response.text || "{}";
        console.log(`[Gemini] Model: ${modelName} 回傳成功`);
        return cleanJsonResponse(text);
    } catch (err: any) {
        console.error(`[Gemini] 請求發生錯誤:`, err);
        throw err;
    }
}

/**
 * 【詳細繁體中文註解】：Anthropic Claude 服務實現 (使用原生 fetch 呼叫，無需額外安裝 SDK 依賴)
 * 透過 HTTP POST 請求發送給 Anthropic 官方 Messages API
 * @param prompt 輸入的提示詞
 * @param options 回傳格式設定 (例如要求 JSON 格式)
 * @param env 雲端或本地環境變數
 */
export async function getClaudeResponse(prompt: string, options: AIResponseOptions = {}, env: any = {}) {
    const apiKey = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    const modelName = env.AI_MODEL || process.env.AI_MODEL || "claude-3-5-sonnet-latest";

    if (!apiKey) throw new Error("Claude API key not configured");

    console.log(`[Claude] 正在傳送請求至模型: ${modelName}...`);
    const startTime = Date.now();

    try {
        // 如果有要求 JSON 格式，則在 Prompt 後方加註說明，確保 Claude 的 JSON 輸出穩定性
        let adjustedPrompt = prompt;
        if (options.responseMimeType === "application/json") {
            adjustedPrompt += "\n\nIMPORTANT: Please return the response strictly as a valid JSON object. Do not include any conversational text outside the JSON structure.";
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: "user", content: adjustedPrompt }],
                max_tokens: 4096,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Anthropic API 錯誤: ${response.status} ${errText}`);
        }

        const data: any = await response.json();
        const text = data.content?.[0]?.text || "";
        
        const duration = (Date.now() - startTime) / 1000;
        console.log(`[Claude] 模型: ${modelName} 於 ${duration} 秒內回應成功`);
        
        return cleanJsonResponse(text);
    } catch (err: any) {
        console.error(`[Claude] 請求發生錯誤:`, err);
        throw err;
    }
}

/**
 * 【詳細繁體中文註解】：OpenAI Codex 服務實現 (使用 openai SDK)
 * 自動識別並相容舊款 completions API (例如 code-davinci-002) 與新型 chat completions
 * @param prompt 輸入的提示詞
 * @param options 回傳格式設定 (例如要求 JSON 格式)
 * @param env 雲端或本地環境變數
 */
export async function getCodexResponse(prompt: string, options: AIResponseOptions = {}, env: any = {}) {
    const apiKey = env.CODEX_API_KEY || env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
    const baseURL = env.AI_BASE_URL || process.env.AI_BASE_URL; // 支援自訂 API 代理端點
    const modelName = env.AI_MODEL || process.env.AI_MODEL || "code-davinci-002";

    if (!apiKey) throw new Error("Codex API key not configured");

    const openai = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        timeout: 120000,
    });

    console.log(`[Codex] 正在傳送請求至模型: ${modelName}...`);
    const startTime = Date.now();

    try {
        let resultText = "";
        
        // 若為舊型代碼補全模型 (以 code- 開頭)，使用 completions 介面
        if (modelName.startsWith("code-")) {
            const response = await openai.completions.create({
                model: modelName,
                prompt: prompt,
                max_tokens: 4096,
                temperature: 0.2,
            });
            resultText = response.choices[0]?.text || "";
        } else {
            // 對於新型的對話代碼模型，使用 chat.completions 介面
            const responseFormat: any = options.responseMimeType === "application/json" ? { type: "json_object" } : undefined;
            const response = await openai.chat.completions.create({
                model: modelName,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2,
                max_tokens: 4096,
                response_format: responseFormat,
            });
            resultText = response.choices[0]?.message?.content || "";
        }

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[Codex] 模型: ${modelName} 於 ${duration} 秒內回應成功`);
        
        return cleanJsonResponse(resultText);
    } catch (err: any) {
        console.error(`[Codex] 請求發生錯誤:`, err);
        throw err;
    }
}
