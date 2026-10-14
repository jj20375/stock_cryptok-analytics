/** @file 合約自動化契約；環境分開授權，全倉保證金；30 USDT 只限制測試單。 */
import type { BitgetFuturesExecutionMode, CryptoAutoTradeSignal, CryptoFuturesTradingEnv } from '../cryptoAutoTrading/types';
export const FUTURES_AUTO_STRATEGIES = [
  { id: 'futures_trend_retest', name: '合約趨勢回踩續行' },
  { id: 'futures_range_reclaim', name: '合約區間假突破回收' },
  { id: 'futures_big_fish', name: '合約吃大魚 2.0（Pine 條件／僅做多）' },
] as const;
/** 手動Demo預覽清單包含本次使用者提供的SOL／ADA；不擴大自動化已保存商品。 */
export const FUTURES_PREVIEW_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT'] as const;
/** 吃大魚沒有固定退出時間，僅以24小時不利費率預留成本；實際費率持續對帳。 */
export function futuresFundingHours(strategyId: string, params: Record<string, number>) {
  return strategyId === 'futures_big_fish' ? 24 : params.maxHoldingBars ?? 12;
}
/** 訊號最多晚五分鐘；行情或排程延遲後不追補歷史進場。時間單位為毫秒。 */
export const AUTO_SIGNAL_MAX_AGE = 5 * 60_000;
export const AUTO_HOUR = 3_600_000;
export const AUTO_ORDER_LABELS: Record<string, string> = { PENDING: '準備處理', RECEIVED: '已收到，待確認', SUBMITTED: '委託已接受，待成交對帳',
  FILLED: '已成交', PARTIALLY_FILLED: '部分成交', REJECTED: '風控拒絕', BLOCKED: '訊號未通過成交檢查', IGNORED: '未送單',
  FAILED: '執行失敗', UNKNOWN: '結果未知，等待對帳', NOT_SUBMITTED: '未送單，請查授權', CANCELED: '委託取消', PARTIAL_CANCELED: '部分成交後取消' };
/** 小額測試名目硬上限，單位 USDT；正式資金不使用這個固定上限。 */
export const AUTO_MAX_NOTIONAL_USDT = 30;
/**
 * 全市場模式在 symbols_json 以 ["*"] 保存，不新增資料表欄位。
 * 「*」不符合 USDT 合約代號格式，不會與真實商品混淆；實際掃描清單每輪由交易所行情動態產生。
 */
export const AUTO_UNIVERSE_ALL = '*';
export type AutomationUniverse = 'LIST' | 'ALL';
export const DEFAULT_AUTOMATION: AutomationInput = { enabled: false, executionMode: 'DEMO', testMode: true, maxNotionalUsdt: 30, positionPct: 5, maxOpenPositions: 3,
  universe: 'LIST', symbols: 'BTCUSDT, ETHUSDT', strategyId: 'futures_trend_retest', feePct: 0.06 };
export interface AutomationInput { enabled: boolean; executionMode: BitgetFuturesExecutionMode; testMode: boolean; positionPct: number; maxOpenPositions: number; maxNotionalUsdt: number; universe: AutomationUniverse; symbols: string; strategyId: string; feePct: number }
export function automationMode(raw: unknown): BitgetFuturesExecutionMode {
  /** 舊 Demo 設定沒有環境欄位時仍視為 Demo，禁止自動升級為正式盤。 */
  if (raw == null || raw === 'DEMO') return 'DEMO';
  if (raw === 'LIVE') return 'LIVE';
  throw new Error('請選擇 Demo 或 LIVE 合約環境');
}
export function validateAutomationInput(raw: Record<string, unknown>): AutomationInput {
  if (typeof raw.enabled !== 'boolean') throw new Error('自動化開關格式不正確');
  if (typeof raw.symbols !== 'string' || raw.symbols.length > 150) throw new Error('請填寫合約商品代號');
  if (raw.universe != null && raw.universe !== 'LIST' && raw.universe !== 'ALL') throw new Error('請選擇指定商品或全市場');
  /** 已保存的全市場設定讀回時只有 symbols「*」，因此兩種寫法都視為全市場。 */
  const universe: AutomationUniverse = raw.universe === 'ALL' || raw.symbols.trim() === AUTO_UNIVERSE_ALL ? 'ALL' : 'LIST';
  const symbols = universe === 'ALL' ? [AUTO_UNIVERSE_ALL] : [...new Set(raw.symbols.toUpperCase().split(/[\s,，]+/).filter(Boolean))];
  if (universe === 'LIST' && (!symbols.length || symbols.length > 5 || symbols.some(symbol => !/^[A-Z0-9]{2,20}USDT$/.test(symbol)))) throw new Error('商品需為 USDT 合約代號，最多五個，以逗號分隔');
  if (!FUTURES_AUTO_STRATEGIES.some(strategy => strategy.id === raw.strategyId)) throw new Error('請選擇已開放自動化的合約策略');
  if (typeof raw.feePct !== 'number' || !Number.isFinite(raw.feePct) || raw.feePct < 0 || raw.feePct > 1) throw new Error('單邊費率需介於 0～1%');
  const positionPct = raw.positionPct ?? 5, maxOpenPositions = raw.maxOpenPositions ?? 3;
  if (typeof positionPct !== 'number' || !Number.isFinite(positionPct) || positionPct < 3 || positionPct > 5) throw new Error('合約單筆倉位上限需介於本金 3～5%');
  if (typeof maxOpenPositions !== 'number' || !Number.isInteger(maxOpenPositions) || maxOpenPositions < 1 || maxOpenPositions > 3) throw new Error('合約同時持倉上限需為 1～3 筆');
  const testMode = raw.testMode ?? true;
  if (typeof testMode !== 'boolean') throw new Error('請選擇測試單或正式資金配置');
  const maxNotionalUsdt = raw.maxNotionalUsdt ?? AUTO_MAX_NOTIONAL_USDT;
  if (typeof maxNotionalUsdt !== 'number' || !Number.isFinite(maxNotionalUsdt) || maxNotionalUsdt < 5 || maxNotionalUsdt > AUTO_MAX_NOTIONAL_USDT) throw new Error('單筆名目倉位上限需介於 5～30 USDT');
  return { enabled: raw.enabled, executionMode: automationMode(raw.executionMode), testMode, maxNotionalUsdt, positionPct, maxOpenPositions,
    universe, symbols: symbols.join(', '), strategyId: String(raw.strategyId), feePct: raw.feePct };
}
export function automationPolicy(env: Pick<CryptoFuturesTradingEnv, 'CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED' | 'CRYPTO_FUTURES_DEMO_AUTOMATION_PAUSE_REASON' |
  'CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED' | 'CRYPTO_FUTURES_LIVE_AUTOMATION_PAUSE_REASON'>, mode: BitgetFuturesExecutionMode) {
  const enabled = (mode === 'LIVE' ? env.CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED : env.CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED) === 'true';
  return { enabled, reason: enabled ? null : (mode === 'LIVE' ? env.CRYPTO_FUTURES_LIVE_AUTOMATION_PAUSE_REASON : env.CRYPTO_FUTURES_DEMO_AUTOMATION_PAUSE_REASON)
    ?? `${mode} 自動化尚未於此執行器開放` };
}
/** 正式盤有獨立部署政策；舊新倉開關不能繞過本來源的環境限制。 */
export function automationEntryAllowed(env: Parameters<typeof automationPolicy>[0], source: string, strategyId: string | undefined, mode: string | undefined) {
  return (mode === 'DEMO' || mode === 'LIVE') && automationPolicy(env, mode).enabled && source === 'FUTURES_AUTO'
    && FUTURES_AUTO_STRATEGIES.some(strategy => strategy.id === strategyId);
}
/** 舊 Demo 匯出保留相容，絕不放行 LIVE。 */
export const demoAutomationEntryAllowed = (env: Parameters<typeof automationPolicy>[0], source: string, strategyId: string | undefined, mode: string | undefined) =>
  mode === 'DEMO' && automationEntryAllowed(env, source, strategyId, mode);
export function automationEventId(userId: number, symbol: string, strategyId: string, closedAt: number, intent: string, mode: BitgetFuturesExecutionMode = 'DEMO') {
  /** 保留既有 Demo ID 去重；LIVE 使用獨立識別，不能混用模擬委託。 */
  return `futures-auto:${mode === 'LIVE' ? 'LIVE:' : ''}${userId}:${strategyId}:${symbol}:${closedAt}:${intent}`;
}
export function automationPositionCapPct(capitalUsdt: number, configuredPct: number, maxNotionalUsdt?: number) {
  if (maxNotionalUsdt == null) return Math.min(configuredPct, 5);
  if (![capitalUsdt, configuredPct, maxNotionalUsdt].every(Number.isFinite) || capitalUsdt <= 0 || maxNotionalUsdt < 5 || maxNotionalUsdt > AUTO_MAX_NOTIONAL_USDT) throw new Error('合約名目倉位上限無效');
  return Math.min(configuredPct, 5, maxNotionalUsdt / capitalUsdt * 100);
}
export function automationConfigAuthorizes(config: { enabled: boolean; executionMode: string; symbolsJson: string; strategyId: string; maxNotionalUsdt: number; testMode?: boolean; positionPct?: number; maxOpenPositions?: number; updatedAt: number } | undefined,
  signal: Pick<CryptoAutoTradeSignal, 'symbol' | 'strategyId' | 'maxNotionalUsdt' | 'automationUpdatedAt' | 'automationTestMode' | 'automationPositionPct' | 'automationMaxOpenPositions'>, mode: BitgetFuturesExecutionMode) {
  if (!config?.enabled || config.executionMode !== mode || config.strategyId !== signal.strategyId || config.updatedAt !== signal.automationUpdatedAt
    || (config.positionPct ?? 5) !== (signal.automationPositionPct ?? 5)
    || (config.maxOpenPositions ?? 3) !== (signal.automationMaxOpenPositions ?? 3)
    || (config.testMode ?? true) !== (signal.automationTestMode ?? true)
    || (config.testMode ?? true ? config.maxNotionalUsdt : undefined) !== signal.maxNotionalUsdt || !Number.isFinite(config.maxNotionalUsdt) || config.maxNotionalUsdt < 5 || config.maxNotionalUsdt > AUTO_MAX_NOTIONAL_USDT) return false;
  try {
    const symbols = JSON.parse(config.symbolsJson);
    if (!Array.isArray(symbols)) return false;
    /** 全市場授權只接受合法 USDT 合約代號；流動性門檻由下單前的行情檢查再次驗證。 */
    if (symbols.length === 1 && symbols[0] === AUTO_UNIVERSE_ALL) return /^[A-Z0-9]{2,20}USDT$/.test(signal.symbol);
    return symbols.length <= 5 && symbols.includes(signal.symbol);
  } catch { return false; }
}
export interface AutomationStatus {
  config: AutomationInput;
  policyEnabled: boolean;
  policyReason: string | null;
  hasDemo: boolean;
  hasLive: boolean;
  liveAuthorized: boolean;
  policies: Record<BitgetFuturesExecutionMode, { enabled: boolean; reason: string | null }>;
  slackReady: boolean;
  checkedAt: number | null;
  lastError: string | null;
  checks: Record<string, { bar: number; reason: string }>;
  events: Array<{ id: string; executionMode: string; symbol: string; strategyId: string; signalAt: number; intent: string; price: number; reason: string;
    orderStatus: string; orderReason: string | null; notificationStatus: string }>;
}
export interface AutomationPreview {
  executionMode: BitgetFuturesExecutionMode; symbol: string; signalAt: number; action: string; reason: string; maxNotionalUsdt?: number; testMode: boolean; capitalUsdt?: number; error: string | null;
  quote: { quantity: number; notionalUsdt: number; marginUsdt: number; riskUsdt: number; leverage: number; stopLossPrice: number; targetPrice?: number; blockedReason: string | null } | null;
}
