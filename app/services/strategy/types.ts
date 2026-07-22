/**
 * 【詳細繁體中文註解】：策略抽象層 — 核心型別定義
 *
 * 設計原則(整個回測/自動交易系統最重要的架構決策):
 *   「策略 = 純函式 (context) => action」
 *   策略本身不 fetch 行情、不下單、不發通知;
 *   資料取得與副作用分別由 live 引擎(strategyEngine)與回測引擎(backtest/engine)負責。
 *   同一份 evaluate 邏輯同時供兩邊使用,確保「回測驗證的」與「實際跑的」永遠是同一套規則。
 *
 * 防前視偏差(look-ahead bias)鐵則:
 *   evaluate() 只能讀取 candles[0..index] 與 indicators 中 <= index 的值,
 *   嚴禁讀取 index 之後的任何資料 — 違反此規則會讓回測績效嚴重失真(看見未來)。
 */

import type { IndicatorCache } from './indicatorCache';

/** 單根 K 線。時間一律為毫秒 UTC timestamp */
export interface Candle {
  /** K 線開盤時間 (毫秒 UTC) */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 目前持倉狀態(由引擎維護,策略唯讀) */
export interface OpenPositionState {
  /** 方向:SHORT 僅回測模擬使用,現貨實盤不支援做空 */
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  /** 停損價;null 代表本筆未設停損 */
  stopLossPrice: number | null;
  /** 進場時間 (毫秒 UTC) */
  entryTime: number;
  /** 進場時的 K 線索引(回測引擎用來計算持倉根數;live 引擎可不填) */
  entryIndex?: number;
}

/**
 * 策略評估結果。
 * - ENTRY:建議開倉。stopLossPct 為停損百分比(如 5 代表 -5%),
 *   由引擎換算成停損價;未提供時引擎套用使用者風控設定(users.riskStopLossPct)。
 * - EXIT:建議平倉(策略訊號出場;停損出場由引擎以 high/low 盤中觸價判斷,不經過策略)。
 * - HOLD:不動作。
 */
export type StrategyAction =
  | { type: 'ENTRY'; side: 'LONG' | 'SHORT'; stopLossPct?: number; reason: string }
  | { type: 'EXIT'; reason: string }
  | { type: 'HOLD' };

/** 策略評估上下文:回測引擎每根 K 線建構一次;live 引擎以最後一根「已收盤」K 線建構 */
export interface StrategyContext {
  /** K 線序列:回測 = 完整歷史;live = 最近 N 根(N >= 策略 warmupBars) */
  candles: Candle[];
  /** 目前評估位置。evaluate 嚴禁讀取 index 之後的資料(防前視偏差) */
  index: number;
  /** 全序列指標惰性快取,同一指標整段序列只計算一次 */
  indicators: IndicatorCache;
  /** 目前持倉;null 代表空手 */
  position: OpenPositionState | null;
  /** 策略參數(門檻值),預設值來自 StrategyModule.defaultParams,可被回測 UI 覆寫 */
  params: Record<string, number>;
}

/** 策略參數的說明中繼資料,供回測 UI 動態產生參數表單 */
export interface StrategyParamMeta {
  /** 參數 key,對應 params 內的欄位 */
  key: string;
  /** 顯示名稱(繁體中文) */
  label: string;
  /** 參數用途與門檻選用理由說明 */
  description: string;
  min?: number;
  max?: number;
  step?: number;
}

/** 策略模組介面:每個策略一個檔案,於 registry.ts 註冊 */
export interface StrategyModule {
  /** 唯一識別碼,如 'rsi_mean_reversion',存入 backtests.strategy_id */
  id: string;
  /** 顯示名稱(繁體中文) */
  name: string;
  /** 策略說明(進出場邏輯摘要,顯示於回測 UI) */
  description: string;
  /** 適用市場 */
  markets: ('CRYPTO' | 'US' | 'TW')[];
  /** 支援的 K 線週期,如 ['15m', '1h', '4h'] */
  supportedIntervals: string[];
  /**
   * 暖機根數:指標穩定所需的最少 K 線數。
   * 回測引擎從第 warmupBars 根開始評估,避免指標初始值失真造成假訊號。
   */
  warmupBars: number;
  /** 是否會產生 SHORT 訊號(SHORT 僅回測模擬,現貨 live 不支援) */
  supportsShort: boolean;
  /** 預設參數 */
  defaultParams: Record<string, number>;
  /** 參數說明(供 UI 動態表單) */
  paramMeta: StrategyParamMeta[];
  /** 核心評估函式 — 純函式、無副作用、禁止前視 */
  evaluate(ctx: StrategyContext): StrategyAction;
}
