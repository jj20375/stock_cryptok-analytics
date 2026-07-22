/**
 * 【詳細繁體中文註解】：策略 — 量增但未突破前高(摸頭做空觀察)
 *
 * 來源:移植自 stockService.ts 的 evaluateVolumeNoBreakoutData()(日報「量增未破前高」警示模式)。
 * 原函式在系統中僅作為「視覺警示」(WARNING 標記,提醒留意出貨/洗盤壓力),不是可執行的進出場策略;
 * 回測將其重新定義為一個明確的做空情境:爆量但未創新高時嘗試放空,
 * 價格站回當初測試的前高視為假設失敗、回補出場,並設停損。
 *
 * ⚠️ 重要假設與限制:
 *   - 現股與多數台股帳戶不支援放空(需融券額度或期貨/選擇權管道),
 *     此策略的 SHORT 訊號僅供回測評估策略體質,不可直接套用於現股實盤下單。
 *   - 出場的「前高」以進場當根的前一根高點近似(entryIndex - 1 的 high),
 *     與原函式定義的 prevHigh 語意一致。
 *
 * 進場邏輯(與原函式一致):
 *   當根成交量 > 前 5 期均量 × volumeMultiplier(爆量)
 *   且當根最高價 <= 前一根最高價(未創新高)
 *   → 觸發放空。
 *
 * 適用:台股/美股一般標的,日線。
 */

import type { StrategyModule, StrategyContext, StrategyAction } from '../types';

const volumeNoBreakoutFade: StrategyModule = {
  id: 'volume_no_breakout_fade',
  name: '量增但未突破前高(做空觀察)',
  description:
    '爆量但未創新高,視為出貨或洗盤警訊,回測中定義為放空情境;價格站回前高(假設失效)、持倉過久或觸及停損則回補。⚠️ 現股/多數台股帳戶不支援放空,SHORT 訊號僅供回測參考。',
  markets: ['US', 'TW'],
  supportedIntervals: ['1d'],
  // 暖機根數:只需 5 期均量 + 前一根資料,取 20 根保守留裕度
  warmupBars: 20,
  supportsShort: true,
  defaultParams: {
    volumeMultiplier: 1.5,
    maxHoldingBars: 15,
    stopLossPct: 6,
  },
  paramMeta: [
    { key: 'volumeMultiplier', label: '量能放大倍數', description: '單期成交量須超過 5 期均量的此倍數', min: 1, max: 5, step: 0.1 },
    { key: 'maxHoldingBars', label: '最大持倉根數', description: '超過此根數強制回補(原策略無出場規則,回測新增)', min: 3, max: 60, step: 1 },
    { key: 'stopLossPct', label: '停損 %(反向)', description: '進場價往上此百分比觸發停損回補', min: 1, max: 20, step: 0.5 },
  ],

  evaluate(ctx: StrategyContext): StrategyAction {
    const { candles, index, position, params } = ctx;
    if (index < 6) return { type: 'HOLD' };

    if (position) {
      const entryIdx = position.entryIndex ?? index;
      // 出場基準:進場前一根的高點,近似原函式的 prevHigh 語意
      const refHighIdx = Math.max(0, entryIdx - 1);
      const refHigh = candles[refHighIdx].high;
      const close = candles[index].close;
      const heldBars = index - entryIdx;

      if (close > refHigh) {
        return { type: 'EXIT', reason: `收盤 ${close} 站回前高 ${refHigh},突破假設失效,回補` };
      }
      if (heldBars >= params.maxHoldingBars) {
        return { type: 'EXIT', reason: `持倉已達最大根數 ${params.maxHoldingBars},回補(原策略無自然出場點,回測新增規則)` };
      }
      return { type: 'HOLD' };
    }

    const current = candles[index];
    const prev = candles[index - 1];
    let sumVol = 0;
    for (let j = index - 5; j < index; j++) sumVol += candles[j].volume;
    const avgVolume5D = sumVol / 5;

    const hasVolume = avgVolume5D > 0 && current.volume > avgVolume5D * params.volumeMultiplier;
    const noBreakout = current.high <= prev.high;

    if (hasVolume && noBreakout) {
      const volMultiple = (current.volume / avgVolume5D).toFixed(1);
      return {
        type: 'ENTRY',
        side: 'SHORT',
        stopLossPct: params.stopLossPct,
        reason: `爆量未過高(量能達 ${volMultiple} 倍,最高價 ${current.high} 未突破前高 ${prev.high})`,
      };
    }

    return { type: 'HOLD' };
  },
};

export default volumeNoBreakoutFade;
