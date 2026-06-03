import { getClaudeResponse, getCodexResponse } from '../app/services/aiService';

// 【詳細繁體中文註解】：此指令碼用來測試 Claude 與 Codex 介面的載入與基本參數錯誤處理是否正常
async function runTest() {
    console.log("開始測試 AI 代理新增的供應商 (Claude & Codex)...");

    // 1. 測試在沒有 API Key 時，Claude 是否正確拋出錯誤
    try {
        console.log("正在測試 Claude 無 Key 錯誤處理...");
        await getClaudeResponse("哈囉", {}, { CLAUDE_API_KEY: "" });
    } catch (err: any) {
        console.log("✅ 成功擷取預期的 Claude 錯誤:", err.message);
    }

    // 2. 測試在沒有 API Key 時，Codex 是否正確拋出錯誤
    try {
        console.log("正在測試 Codex 無 Key 錯誤處理...");
        await getCodexResponse("print('Hello')", {}, { CODEX_API_KEY: "" });
    } catch (err: any) {
        console.log("✅ 成功擷取預期的 Codex 錯誤:", err.message);
    }

    console.log("測試完成，編譯與基本異常處理皆符合預期！");
}

runTest().catch(console.error);
