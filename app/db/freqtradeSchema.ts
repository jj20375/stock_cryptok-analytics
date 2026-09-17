import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Freqtrade 的研究與模擬結果快照。
 *
 * 此表只保存已經過同步橋接器清理的策略績效，不保存交易所金鑰、Freqtrade API 密碼、
 * 使用者帳戶餘額或可用來控制交易機器人的資料。runId 由橋接器產生，重送同一快照時覆寫，
 * 讓網路重試不會在戰情室重複顯示同一份研究結果。
 */
export const freqtradeRuns = sqliteTable('freqtrade_runs', {
  runId: text('run_id').primaryKey(),
  mode: text('mode').notNull(),
  strategyVersion: text('strategy_version').notNull(),
  strategyName: text('strategy_name').notNull(),
  exchange: text('exchange').notNull(),
  timeframe: text('timeframe').notNull(),
  status: text('status').notNull(),
  generatedAt: integer('generated_at').notNull(),
  /** 已驗證且有限欄位的 JSON 指標；避免把 Freqtrade 原始 API 回應直接存入 D1。 */
  metricsJson: text('metrics_json').notNull(),
  /** 僅研究範圍與成本假設；不包含帳戶或交易所金鑰。 */
  researchJson: text('research_json').notNull().default('{}'),
  syncedAt: integer('synced_at').notNull(),
}, (table) => [
  index('freqtrade_runs_generated_at_idx').on(table.generatedAt),
]);
