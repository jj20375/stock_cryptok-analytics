/** @file 研究策略的最小整合檢查；固定公開行情重放，拒絕所有研究新倉，沒有外部訂單或通知。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getStrategy, listStrategies } from '../app/services/strategy/registry';
import { evaluate } from '../scripts/futures-strategy-research';
import { processCryptoFuturesSignal } from '../app/services/cryptoAutoTrading/engine';
import { futuresSnapshot } from '../app/services/cryptoFutures/snapshot.server';

test('研究候選可列出，同一ADA快照重現55筆39勝；突破回踩在兩週內零訊號', async () => {
  const data = JSON.parse(await readFile(new URL('../research/futures-70-2026-10-07/transfer/ADAUSDT.json', import.meta.url), 'utf8'));
  const s = getStrategy('futures_rsi_pullback_research')!;
  assert.ok(listStrategies().includes(s)); assert.equal(s.backtestOnly, true);
  const candidate = { key: s.id, strategy: s, params: s.defaultParams };
  const all = evaluate([data], candidate, data.start, data.end);
  assert.equal(all.pooled.trades, 55); assert.equal(all.pooled.wins, 39);
  assert.ok(Math.abs(all.pooled.netPnl - 3.002150763698772) < 1e-8);
  const old = getStrategy('futures_trend_retest')!;
  const result = evaluate([data], { key: old.id, strategy: old, params: old.defaultParams }, data.end - 14 * 24 * 3_600_000, data.end);
  assert.equal(result.diagnostics[0].signals, 0); assert.equal(result.pooled.trades, 0);
  assert.equal(s.evaluate({ candles: data.candles, index: 900, indicators: {} as any, position: null, params: { ...s.defaultParams, targetR: NaN } }).type, 'HOLD');
});

test('研究標示在啟用新倉、forced Demo或LIVE時仍於DB與行情請求前拒絕', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('不應請求行情或下單'); };
  const env = { CRYPTO_NEW_ENTRIES_ENABLED: 'true', get DB() { throw new Error('不應讀取帳戶資料庫'); } } as any;
  try {
    for (const mode of ['DEMO', 'LIVE'] as const) for (const intent of ['OPEN_LONG', 'OPEN_SHORT'] as const) {
      await processCryptoFuturesSignal(env, { id: 'research-check', source: 'INTERNAL', symbol: 'ADAUSDT', action: 'BUY',
        intent, signalAt: Date.now(), referencePrice: 1, label: '研究檢查', strategyId: 'futures_rsi_pullback_research' }, 1, mode);
    }
    await assert.rejects(futuresSnapshot(env, 1, 'ADAUSDT', 'futures_rsi_pullback_research'), /僅供歷史回測/);
    /** 僅擋研究新倉；既有持倉平倉仍進入原流程，此處以DB攔截證明沒有提前返回。 */
    await assert.rejects(processCryptoFuturesSignal(env, { id: 'research-close-check', source: 'SYSTEM_STOP', symbol: 'ADAUSDT', action: 'SELL',
      intent: 'CLOSE_LONG', signalAt: Date.now(), referencePrice: 1, label: '既有保護檢查', strategyId: 'futures_rsi_pullback_research' }, 1, 'DEMO'), /不應讀取帳戶資料庫/);
  } finally { globalThis.fetch = original; }
});
