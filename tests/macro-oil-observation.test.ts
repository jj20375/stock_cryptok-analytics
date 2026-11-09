/** @file 驗證油價觀察的成本／需求分支、原權重相容性與非核心來源失敗處理；不呼叫真實報價或資料庫。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMacroPillarsAndOutlook, getMacroIndicators } from '../app/services/macroService';
import type { MacroQuote, MacroRawInput } from '../app/services/macro/types';

/** 價格單位由指標決定；原油為美元／桶，漲跌幅單位為 %。 */
function quote(value: number, changePct = 0, ma10 = value): MacroQuote {
  return { value, prevValue: value / (1 + changePct / 100), changePct, ma10, trend: value > ma10 ? 'UP' : 'DOWN' };
}

function input(overrides: Partial<MacroRawInput> = {}): MacroRawInput {
  return {
    dxy: quote(102), usdTwd: quote(32), us10y: quote(5), us5y: quote(4.8),
    vix: quote(16, -1, 17), nq: quote(30000, 0, 29900), es: quote(6000),
    yieldSpread10Y3M: 0.5,
    oil: { wti: quote(75), brent: quote(80) },
    ...overrides,
  };
}

test('雙油急漲顯示成本逆風，台股／美股產業解讀不同，且不影響原有總分與計數', () => {
  const baseline = buildMacroPillarsAndOutlook(input());
  const moved = buildMacroPillarsAndOutlook(input({ oil: { wti: quote(80, 3, 75), brent: quote(85, 4, 80) } }));
  for (const market of ['TW', 'US'] as const) {
    const view = moved.marketViews[market];
    const previous = baseline.marketViews[market].outlook;
    assert.equal(view.pillars.oil?.signal, 'BEARISH');
    assert.match(view.pillars.oil!.primaryMetric, /WTI \$80\.00 \(\+3\.00%\).*布蘭特 \$85\.00/);
    assert.match(view.outlook.summary, /油價觀察（不計分）：通膨與成本逆風/);
    for (const key of ['score', 'direction', 'bullishCount', 'bearishCount', 'neutralCount', 'unavailableCount'] as const) {
      assert.equal(view.outlook[key], previous[key]);
    }
  }
  assert.match(moved.marketViews.TW.pillars.oil!.explanation, /進口能源與航空成本/);
  assert.match(moved.marketViews.US.pillars.oil!.explanation, /上游能源商/);
  assert.equal(moved.marketViews.CRYPTO.pillars.oil, undefined);
  assert.deepEqual(moved.marketViews.CRYPTO, baseline.marketViews.CRYPTO);
});

test('雙油高於 10MA 5% 提示成本壓力，未達門檻維持觀察', () => {
  for (const [value, expected] of [[104.9, 'NEUTRAL'], [105, 'BEARISH']] as const) {
    const view = buildMacroPillarsAndOutlook(input({ oil: { wti: quote(value, 0, 100), brent: quote(value, 0, 100) } })).marketViews.US;
    assert.equal(view.pillars.oil?.signal, expected);
  }
});

test('雙油溫和回落且股指及 VIX 平穩時，僅提示成本壓力緩和', () => {
  const view = buildMacroPillarsAndOutlook(input({ oil: { wti: quote(74, -0.5, 75), brent: quote(79, -1, 80) } })).marketViews.TW;
  assert.equal(view.pillars.oil?.signal, 'BULLISH');
  assert.match(view.pillars.oil!.explanation, /不能僅憑油價判定大盤上漲/);
});

test('急跌、VIX 升溫、期貨下跌或缺漏時，不將原油回落直接判為利多', () => {
  const easingOil = { wti: quote(74, -1, 75), brent: quote(79, -1, 80) };
  for (const overrides of [
    { oil: { ...easingOil, wti: quote(70, -3, 75) } },
    { oil: easingOil, vix: quote(17, 6, 18) },
    { oil: easingOil, nq: quote(30000, -0.1) },
    { oil: easingOil, nq: null },
    { oil: easingOil, es: null },
  ]) {
    const view = buildMacroPillarsAndOutlook(input(overrides)).marketViews.US;
    assert.equal(view.pillars.oil?.signal, 'NEUTRAL');
  }
});

test('單一原油缺報價維持中性，雙油皆缺標為資料暫缺，舊回測輸入仍相容', () => {
  const partial = buildMacroPillarsAndOutlook(input({ oil: { wti: quote(80, 5), brent: null } })).marketViews.TW;
  assert.equal(partial.pillars.oil?.signal, 'NEUTRAL');
  assert.match(partial.pillars.oil!.primaryMetric, /布蘭特 —（資料暫缺）/);
  for (const oil of [undefined, { wti: null, brent: null }]) {
    const view = buildMacroPillarsAndOutlook(input({ oil })).marketViews.US;
    assert.equal(view.pillars.oil?.dataUnavailable, true);
    assert.equal(view.outlook.unavailableCount, 0);
    assert.match(view.outlook.summary, /油價觀察（不計分）：⚠️ 資料暫缺/);
  }
});

test('報價服務抓取雙油並保留時間；原油來源失敗不阻斷核心羅盤', async () => {
  const originalFetch = globalThis.fetch;
  const symbols: string[] = [];
  /** 固定 UTC 報價時間，確認非日K開盤時間；測試不依賴真實市場。 */
  const quoteTime = 1_790_000_000;
  let oilUnavailable = false;
  globalThis.fetch = async (url) => {
    const symbol = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!);
    symbols.push(symbol);
    if (oilUnavailable && ['CL=F', 'BZ=F'].includes(symbol)) return new Response('', { status: 503 });
    const value = symbol === 'CL=F' ? 75 : symbol === 'BZ=F' ? 80 : 5;
    return Response.json({ chart: { result: [{
      meta: { regularMarketTime: quoteTime },
      timestamp: Array.from({ length: 20 }, (_, i) => quoteTime - (20 - i) * 86400),
      indicators: { quote: [{ close: Array(20).fill(value) }] },
    }] } });
  };
  try {
    const available = await getMacroIndicators();
    assert.ok(available);
    assert.ok(symbols.includes('CL=F') && symbols.includes('BZ=F'));
    assert.equal(available.oil.wti?.value, 75);
    assert.equal(available.oil.brent?.value, 80);
    assert.equal(available.dataStatus.quoteTimes.wti, quoteTime * 1000);
    assert.equal(available.dataStatus.quoteTimes.brent, quoteTime * 1000);
    oilUnavailable = true;
    const missing = await getMacroIndicators();
    assert.ok(missing);
    assert.deepEqual(missing.oil, { wti: null, brent: null });
    assert.deepEqual(missing.dataStatus.missing, ['wti', 'brent']);
    assert.equal(missing.marketViews.TW.pillars.oil?.dataUnavailable, true);
    assert.equal(missing.marketViews.US.outlook.score, available.marketViews.US.outlook.score);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
