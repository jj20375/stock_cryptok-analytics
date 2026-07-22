/**
 * 【詳細繁體中文註解】：策略註冊表
 *
 * 所有策略模組在此集中註冊,提供:
 *   1. 回測 UI 的策略下拉選單(listStrategies)
 *   2. 回測引擎與 live 引擎依 id 查找策略(getStrategy)
 *
 * 新增策略步驟:在 strategies/ 目錄建立新模組檔 → import 進來 → 加入 STRATEGY_MODULES。
 * 依開發規範,新策略必須先建立可重用的 strategy module,再由 UI / 引擎引用。
 */

import type { StrategyModule } from './types';
import rsiMeanReversion from './strategies/rsiMeanReversion';
import supertrendMomentum from './strategies/supertrendMomentum';
import trendMomentum from './strategies/trendMomentum';
import consecutiveVolumeBreakout from './strategies/consecutiveVolumeBreakout';
import volumeNoBreakoutFade from './strategies/volumeNoBreakoutFade';
import dailyVolumeSpike from './strategies/dailyVolumeSpike';

/** 全部已註冊策略(id 不可重複) */
const STRATEGY_MODULES: StrategyModule[] = [
  rsiMeanReversion,
  supertrendMomentum,
  trendMomentum,
  consecutiveVolumeBreakout,
  volumeNoBreakoutFade,
  dailyVolumeSpike,
];

const STRATEGY_MAP = new Map<string, StrategyModule>(
  STRATEGY_MODULES.map((s) => [s.id, s])
);

/** 依 id 取得策略模組;找不到回傳 null(呼叫端須處理,避免對不存在的策略下單) */
export const getStrategy = (id: string): StrategyModule | null =>
  STRATEGY_MAP.get(id) ?? null;

/** 列出全部策略(供 UI 下拉);回傳淺拷貝避免呼叫端誤改註冊表 */
export const listStrategies = (): StrategyModule[] => [...STRATEGY_MODULES];

/** 列出支援指定市場的策略 */
export const listStrategiesByMarket = (market: 'CRYPTO' | 'US' | 'TW'): StrategyModule[] =>
  STRATEGY_MODULES.filter((s) => s.markets.includes(market));
