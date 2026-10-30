/**
 * @file Solana 迷因幣防 Rug 戰情室（Meme Desk）所有量化與風控參數設定檔（對應原文 config.py）。
 * 核心原則：所有策略門檻集中在單一檔案管理，AI 裁判不得自行放寬任何數字。
 */

export const MEME_DESK_CONFIG = {
  /**
   * 預設為模擬盤（Paper Mode）：以真實鏈上即時價格與池子深度模擬買賣，不接觸真實錢包。
   * 當切為 false 時，系統僅輸出待簽署指令（APPROVAL NEEDED），由人工自行於錢包買入。
   */
  paperMode: true,

  /**
   * 強制只掃描與放行「Bitget 交易所已上架幣種」：
   * 為什麼需要此設定：確保戰情室掃出來與通過 14 關的代幣（如 BONKUSDT、WIFUSDT、POPCATUSDT 等），
   * 使用者皆可直接於 Bitget 現貨／合約搜尋代號買入，不掃描未上架 Bitget 的野雞 DEX 代幣。
   */
  onlyBitgetListed: true,

  /**
   * 單筆固定投入金額（單位：USD）。
   * 風控理由：永遠維持固定票面大小（Flat Ticket），絕不因前幾筆連勝而放大單筆賭注。
   */
  ticketUsd: 25,

  /**
   * 場內同時持倉數量上限（單位：檔）。
   * 4 檔 × 25 USD = 任何時刻最多 100 USD 曝險於迷因幣市場。
   */
  maxOpenPositions: 4,

  /**
   * 單日最多允許新開倉次數（單位：次／UTC 日）。
   * 防止在熱絡行情中過度頻繁出手。
   */
  maxEntriesPerDay: 6,

  /**
   * 單日已實現虧損熔斷門檻（單位：USD）。
   * 當今日已實現損益 <= -50 USD 時，全天禁止任何新進場，甚至不發起 API 請求。
   */
  dailyLossHaltUsd: 50,

  /**
   * 同幣種出場後的冷卻時間（單位：小時）。
   * 剛平倉（不論停利或停損）的代幣在 24 小時內禁止重新進場，防止情緒性反覆追高殺低。
   */
  cooldownHours: 24,

  /**
   * 每次自動／手動批次掃描 DexScreener 最新代幣的數量上限（單位：顆）。
   * 限制單輪最多處理 5 顆，確保在 Cloudflare Workers 執行時間預算內完成，且不耗盡 API 配額。
   */
  maxScanBatchSize: 5,

  /**
   * 前 13 項純程式碼硬過濾門檻（Code Kills — 合約 9 項 + 流動池 4 項）。
   * 只要任一指標未達標或為 null，直接免費淘汰（SKIP），不進入 AI 審查。
   */
  facts: {
    /** 第 5 關：Rugcheck 正規化風險分數上限（0 ~ 100，越高越危險；超過 40 分即淘汰） */
    maxRiskScore: 40,
    /** 第 6 關：最大流動池 LP 鎖倉或銷毀最低比例（單位：%，低於 90% 代表隨時可抽池 Rug） */
    minLpLockedPct: 90,
    /** 第 7 關：排除 AMM 與鎖倉合約後，前 10 大持幣地址合計佔比上限（單位：%，超過 30% 視為籌碼過度集中） */
    maxTop10Pct: 30,
    /**
     * Bitget 已上架代幣之前 10 大持幣地址上限（單位：%）：
     * 已上架中心化交易所（Bitget / Binance / OKX / Bybit）的代幣，其前十大鏈上地址常包含交易所冷熱託管錢包，
     * 因此針對已上架 Bitget 的代幣放寬至 65%，避免因交易所託管用戶資產而誤殺。
     */
    maxTop10PctBitgetListed: 65,
    /** 第 8 關：創建者（Dev）錢包剩餘持幣佔總供給上限（單位：%，超過 5% 代表 Dev 隨時可砸盤） */
    maxDevPct: 5,
    /** 第 9 關：內部人（Insider）標記地址與關聯圖譜命中數上限（0 代表零容忍任何老鼠倉／綑綁地址） */
    maxInsiders: 0,
    /** 第 10 關：最大池子最低流動性門檻（單位：USD，低於 30,000 美元容易成為別人的出場流動性） */
    minLiquidityUsd: 30_000,
    /** 第 11 關：單筆下單金額佔流動池比例上限（0.01 = 1%，避免自己的買單造成過大滑價） */
    maxTicketShare: 0.01,
    /** 第 12-A 關：流動池成立最短時間（單位：分鐘；未滿 30 分鐘的池子籌碼與報告尚未穩定） */
    minAgeMin: 30,
    /** 第 12-B 關：流動池成立最長時間（單位：小時；超過 72 小時通常主升段已結束） */
    maxAgeHours: 72,
    /** 第 13 關：貔貅盤（Honeypot）判定門檻（近 1 小時買單達 20 筆以上卻 0 賣單，代表無法賣出） */
    honeypotMinBuys1h: 20,
  },

  /**
   * 第 14 關：Gemini AI 裁判放行最低信心分數（0 ~ 1）。
   * 即使 Gemini 回傳 BUY，若 confidence 低於 0.7 仍強制轉為 SKIP。
   */
  minConfidence: 0.7,

  /**
   * 5 重自動化出場規則（對應原文 watch.py，於進場前即寫死，每 10 分鐘巡檢一次）。
   */
  exit: {
    /** 抽池逃生門檻（單位：%）：當前流動性較進場時下降達 40%，不論帳面賺賠立即 100% 全數逃生 */
    liqDropPct: 40,
    /** 硬停損門檻（單位：%）：帳面報酬跌破 -35% 時全數停損出場 */
    stopPct: -35,
    /**
     * 階梯式分批停利（Ladder Take-Profit）：
     * 第一階：漲幅達 +100%（翻倍）時，賣出原始倉位的 50%（收回全部本金，剩餘部位零成本）
     * 第二階：漲幅達 +200%（三倍）時，再賣出原始倉位的 25%
     */
    ladder: [
      { targetPct: 100, sellFractionOfInitial: 0.50 },
      { targetPct: 200, sellFractionOfInitial: 0.25 },
    ] as const,
    /** 移動停利回落幅度（單位：%）：完成第一階停利（steps > 0）後，價格自持倉最高點回落 30% 即全數平倉 */
    trailPct: 30,
    /** 時間停損觀察期（單位：小時）：持倉滿 6 小時後檢查是否為死錢（Dead Money） */
    timeStopHours: 6,
    /** 時間停損最低要求漲幅（單位：%）：滿 6 小時但漲幅未達 +20%，直接平倉騰出持倉格位 */
    timeStopMinPct: 20,
  },
} as const;
