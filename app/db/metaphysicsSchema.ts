/** @file 玄學羅盤資料表（migration 0031）：加密生辰、每日紫微預測快照、AI 解說快取。與交易、風控資料表完全分開。 */
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './schema';

/** 使用者生辰；整包 AES-GCM 加密（含性別），刪除帳號時一併刪除。 */
export const userBirthProfiles = sqliteTable('user_birth_profiles', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** encryptData(JSON.stringify(BirthInput), MASTER_ENCRYPTION_KEY) 的結果。 */
  encryptedPayload: text('encrypted_payload').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 每日紫微預測；source = 'live'（上線後頁面瀏覽時建立）或 'backtest'（回測腳本匯入）。 */
export const metaphysicsMarketForecasts = sqliteTable('metaphysics_market_forecasts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 'TW' | 'CRYPTO' | 'US'。 */
  market: text('market').notNull(),
  /** 市場當地日期 YYYY-MM-DD。 */
  tradeDate: text('trade_date').notNull(),
  ruleVersion: text('rule_version').notNull(),
  source: text('source').notNull(),
  /** 方向分數 -100～+100。 */
  directionScore: integer('direction_score').notNull(),
  /** 變盤強度 0–3。 */
  turningStrength: integer('turning_strength').notNull(),
  triggersJson: text('triggers_json').notNull(),
  /** 當日實際漲跌幅（%），收盤後回填；休市或尚未回填為 null。 */
  actualChangePct: real('actual_change_pct'),
  /** 實際是否變盤（1/0），定義見 hitRate.ts。 */
  isTurningActual: integer('is_turning_actual'),
  createdAt: integer('created_at').notNull(),
}, (t) => [uniqueIndex('metaphysics_forecast_unique').on(t.market, t.tradeDate, t.ruleVersion, t.source)]);

/** AI 解說快取；市場解說 userId = 0（SQLite 唯一索引中 NULL 互不相等，用 0 才能去重）。 */
export const metaphysicsNarrativeCache = sqliteTable('metaphysics_narrative_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(0),
  /** 台北日期 YYYY-MM-DD。 */
  cacheDate: text('cache_date').notNull(),
  /** 'market_TW' | 'market_CRYPTO' | 'market_US' | 'bazi_profile' | 'bazi_daily'。 */
  kind: text('kind').notNull(),
  ruleVersion: text('rule_version').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [uniqueIndex('metaphysics_narrative_unique').on(t.userId, t.cacheDate, t.kind, t.ruleVersion)]);
