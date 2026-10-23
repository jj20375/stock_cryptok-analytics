/**
 * @file 市場漲跌走勢羅盤的預測快照寫入。
 * 副作用：寫入 D1 `macro_outlook_snapshots`。任何失敗一律吞掉並記 log，不得影響 /api/macro 回應或其他排程。
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { macroOutlookSnapshots } from '../../db/macroSnapshotSchema';
import { getMacroIndicators } from '../macroService';
import type { MacroIndicators, MacroTargetMarket } from './types';

export interface MacroSnapshotEnv {
  DB?: Parameters<typeof drizzle>[0];
}

export type MacroSnapshotSource = 'TW_PREOPEN' | 'API_VIEW';

/**
 * 使用者瀏覽時的快照節流間隔（毫秒）：15 分鐘最多一筆。
 * /api/macro 有 3 分鐘快取、前端每 5 分鐘自動更新，不節流的話頁面掛著一整天就是數百筆，
 * 15 分鐘的解析度已足以還原「當時看到什麼」。
 */
const API_VIEW_THROTTLE_MS = 15 * 60 * 1000;
/** API_VIEW 快照保留 180 天；TW_PREOPEN 每日僅一筆，長期保留做命中率統計 */
const API_VIEW_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** 只保留檢討需要的數值，避免把整份 MacroIndicators（含大量文案）塞進資料庫 */
function pickInputs(indicators: MacroIndicators) {
  const quote = (q: { value: number; prevValue: number; ma10: number; trend: string } | null) =>
    q ? { value: q.value, prevValue: q.prevValue, ma10: q.ma10, trend: q.trend } : null;
  return {
    dxy: quote(indicators.dxy),
    usdTwd: quote(indicators.usdTwd),
    us10y: quote(indicators.us10y),
    us3m: quote(indicators.us3m),
    vix: quote(indicators.vix),
    nq: quote(indicators.futures.nq),
    es: quote(indicators.futures.es),
    yieldSpread10Y3M: indicators.spreads.yieldSpread10Y3M,
    quoteTimes: indicators.dataStatus.quoteTimes,
  };
}

function pickPillarSignals(indicators: MacroIndicators) {
  const markets: MacroTargetMarket[] = ['TW', 'US', 'CRYPTO'];
  return Object.fromEntries(markets.map((market) => {
    const { pillars } = indicators.marketViews[market];
    return [market, {
      treasury: pillars.treasury.signal,
      fx: pillars.fx.dataUnavailable ? 'UNAVAILABLE' : pillars.fx.signal,
      futures: pillars.futures.dataUnavailable ? 'UNAVAILABLE' : pillars.futures.signal,
      bondSpreadAndVix: pillars.bondSpreadAndVix.signal,
    }];
  }));
}

/**
 * 寫入一筆羅盤快照。API_VIEW 會先檢查 15 分鐘內是否已有同來源快照，有則略過。
 * @returns 是否實際寫入
 */
export async function recordMacroSnapshot(
  env: MacroSnapshotEnv,
  indicators: MacroIndicators,
  source: MacroSnapshotSource
): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const db = drizzle(env.DB);
    if (source === 'API_VIEW') {
      const latest = await db.select({ createdAt: macroOutlookSnapshots.createdAt })
        .from(macroOutlookSnapshots)
        .where(eq(macroOutlookSnapshots.source, 'API_VIEW'))
        .orderBy(desc(macroOutlookSnapshots.createdAt)).limit(1);
      if (latest[0] && indicators.timestamp - latest[0].createdAt < API_VIEW_THROTTLE_MS) return false;
    }
    const { TW, US, CRYPTO } = indicators.marketViews;
    await db.insert(macroOutlookSnapshots).values({
      id: crypto.randomUUID(),
      createdAt: indicators.timestamp,
      source,
      twDirection: TW.outlook.direction,
      twScore: TW.outlook.score,
      usDirection: US.outlook.direction,
      usScore: US.outlook.score,
      cryptoDirection: CRYPTO.outlook.direction,
      cryptoScore: CRYPTO.outlook.score,
      missingSources: JSON.stringify(indicators.dataStatus.missing),
      inputsJson: JSON.stringify(pickInputs(indicators)),
      pillarsJson: JSON.stringify(pickPillarSignals(indicators)),
    });
    return true;
  } catch (error) {
    // 常見原因是尚未執行 migration 0028；快照只是檢討用途，失敗不可影響羅盤本身
    console.warn('[Macro Snapshot] 快照寫入失敗，略過本次紀錄:', error);
    return false;
  }
}

/**
 * 台股開盤前（台北 08:30）固定快照：重新抓一次最新報價，確保每天都有一筆可對照當日收盤的判讀，
 * 不依賴使用者是否剛好打開頁面。順便清除超過保留期限的 API_VIEW 快照。
 */
export async function runTwPreopenMacroSnapshot(env: MacroSnapshotEnv, now = Date.now()): Promise<void> {
  const indicators = await getMacroIndicators();
  if (!indicators) {
    console.warn('[Macro Snapshot] 開盤前快照：總經指標取得失敗，今日無快照');
    return;
  }
  await recordMacroSnapshot(env, indicators, 'TW_PREOPEN');
  if (!env.DB) return;
  try {
    await drizzle(env.DB).delete(macroOutlookSnapshots).where(and(
      eq(macroOutlookSnapshots.source, 'API_VIEW'),
      lt(macroOutlookSnapshots.createdAt, now - API_VIEW_RETENTION_MS),
    ));
  } catch (error) {
    console.warn('[Macro Snapshot] 清除過期快照失敗，下次排程再試:', error);
  }
}
