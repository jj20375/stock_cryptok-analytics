---
name: node_version
description: Ensures the use of Node.js v20.19.6 for this project.
---

# Node.js Version Management Skill

這個 Skill 用於確保在處理此專案時使用的是正確的 Node.js 版本。

## 核心要求
1. **專案限定版本**：此專案必須且只能在 **Node.js v20.19.6** (或更高等級的 v20.x 版本) 下運行。
2. **AI 行為準則**：
   - 在執行任何 `npm` 或 `node` 命令前，AI 必須確認目前的環境是否符合 Node v20+。
   - 如果偵測到版本過低（如 v16 或 v18），應立即停止操作並建議 USER 切換版本。
   - 所有的開發工作（如 React Router v7 相關功能）均依賴於 Node 20+ 的 API。

## 操作指令
- 若環境中裝有 `nvm`，應優先執行 `nvm use` 或 `nvm use 20`。
- 檢查版本指令：`node -v`。

## 繁體中文註解
- 在編寫相關自動化腳本或說明時，請務必提醒使用者此版本要求。
