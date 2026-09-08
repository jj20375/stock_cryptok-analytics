import assert from 'node:assert/strict';
import { test } from 'node:test';
import cryptoMomentumBurst, { MOMENTUM_BURST_PARAMS } from '../app/services/strategy/strategies/cryptoMomentumBurst';
import { IndicatorCache } from '../app/services/strategy/indicatorCache';
import type { Candle, StrategyContext } from '../app/services/strategy/types';

const INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * 產生一段「平穩盤整 → 最後一根放量突破」的 K 線。
 * 各參數可單獨調整以驗證單一進場條件的把關效果。
 */
function buildCandles(options: {
  bars?: number;
  basePrice?: number;
  baseVolume?: number;
  /** 最後一根的收盤價相對盤整高點的溢價 % */
  breakoutPct?: number;
  /** 最後一根的量能相對均量倍數 */
  volumeMultiple?: number;
  /** 突破前 momentumBars 根的起漲基準價(用來控制動能漲幅) */
  momentumBasePrice?: number;
} = {}): Candle[] {
  const bars = options.bars ?? 80;
  const base = options.basePrice ?? 100;
  // 預設量能需讓近 6 根成交額(量 × 價)超過策略的 minQuoteVolume(200 萬),否則會被流動性門檻擋下
  const baseVolume = options.baseVolume ?? 5000;
  const candles: Candle[] = [];
  for (let i = 0; i < bars - 1; i++) {
    // 盤整區間:高點固定在 base,避免影響突破位計算
    const price = options.momentumBasePrice != null && i === bars - 1 - MOMENTUM_BURST_PARAMS.momentumBars
      ? options.momentumBasePrice
      : base;
    candles.push({
      openTime: i * INTERVAL_MS,
      open: price, high: price, low: price * 0.995, close: price, volume: baseVolume,
    });
  }
  const breakoutPct = options.breakoutPct ?? 5;
  const close = base * (1 + breakoutPct / 100);
  candles.push({
    openTime: (bars - 1) * INTERVAL_MS,
    open: base, high: close, low: base * 0.995, close,
    volume: baseVolume * (options.volumeMultiple ?? 4),
  });
  return candles;
}

const contextFor = (candles: Candle[], params = MOMENTUM_BURST_PARAMS): StrategyContext => ({
  candles,
  index: candles.length - 1,
  indicators: new IndicatorCache(candles),
  position: null,
  params: { ...params },
});

test('放量突破且動能足夠才進場;量能不足、追價過遠、動能不足皆不進場', () => {
  // 基準情境:突破 +5%、量能 4 倍、動能來自 momentumBasePrice 造成的漲幅
  const good = buildCandles({ momentumBasePrice: 90 });
  const entry = cryptoMomentumBurst.evaluate(contextFor(good));
  assert.equal(entry.type, 'ENTRY');
  assert.equal(entry.type === 'ENTRY' && entry.side, 'LONG');
  assert.equal(entry.type === 'ENTRY' && entry.stopLossPct, MOMENTUM_BURST_PARAMS.stopLossPct);

  // 量能只有 1.5 倍(低於預設 3 倍)→ 不進場
  assert.equal(cryptoMomentumBurst.evaluate(contextFor(buildCandles({ momentumBasePrice: 90, volumeMultiple: 1.5 }))).type, 'HOLD');

  // 追價過遠:突破 +20% 超過 maxExtensionPct(8%)→ 不進場
  assert.equal(cryptoMomentumBurst.evaluate(contextFor(buildCandles({ momentumBasePrice: 90, breakoutPct: 20 }))).type, 'HOLD');

  // 動能不足:近 momentumBars 根幾乎沒漲(基準價等於盤整價)→ 不進場
  assert.equal(cryptoMomentumBurst.evaluate(contextFor(buildCandles({ breakoutPct: 1 }))).type, 'HOLD');
});

test('流動性不足與波動失控時不得進場', () => {
  const candles = buildCandles({ momentumBasePrice: 90 });

  // 成交額門檻拉到極高 → 流動性不足,不進場
  const illiquid = cryptoMomentumBurst.evaluate(
    contextFor(candles, { ...MOMENTUM_BURST_PARAMS, minQuoteVolume: 1_000_000_000 })
  );
  assert.equal(illiquid.type, 'HOLD');

  // 波動上限壓到極低 → ATR 佔比超標,不進場
  const tooVolatile = cryptoMomentumBurst.evaluate(
    contextFor(candles, { ...MOMENTUM_BURST_PARAMS, maxAtrPct: 0.01 })
  );
  assert.equal(tooVolatile.type, 'HOLD');
});

test('非法參數與資料不足時一律不產生訊號', () => {
  const candles = buildCandles({ momentumBasePrice: 90 });

  // 非整數回看根數
  assert.equal(cryptoMomentumBurst.evaluate(
    contextFor(candles, { ...MOMENTUM_BURST_PARAMS, breakoutBars: 12.5 })
  ).type, 'HOLD');

  // 超出允許範圍
  assert.equal(cryptoMomentumBurst.evaluate(
    contextFor(candles, { ...MOMENTUM_BURST_PARAMS, exitBars: 999 })
  ).type, 'HOLD');

  // NaN 參數
  assert.equal(cryptoMomentumBurst.evaluate(
    contextFor(candles, { ...MOMENTUM_BURST_PARAMS, momentumPct: NaN })
  ).type, 'HOLD');

  // 資料根數不足以完成回看
  const short = buildCandles({ bars: 10, momentumBasePrice: 90 });
  assert.equal(cryptoMomentumBurst.evaluate(contextFor(short)).type, 'HOLD');
});

test('持倉時只依出場規則判斷,且不受量能與流動性門檻阻擋', () => {
  const candles = buildCandles({ momentumBasePrice: 90 });
  const position = {
    side: 'LONG' as const, entryPrice: 100, quantity: 1,
    stopLossPrice: 90, entryTime: 0,
  };

  // 收盤仍高於前 exitBars 根低點 → 續抱
  assert.equal(cryptoMomentumBurst.evaluate({ ...contextFor(candles), position }).type, 'HOLD');

  // 讓最後一根收盤跌破前 exitBars 根低點 → 出場(即使量能與流動性門檻嚴苛也必須能出場)
  const broken = [...candles];
  broken[broken.length - 1] = { ...broken[broken.length - 1], close: 50, low: 50 };
  const exit = cryptoMomentumBurst.evaluate({
    ...contextFor(broken, { ...MOMENTUM_BURST_PARAMS, minQuoteVolume: 1_000_000_000 }),
    position,
  });
  assert.equal(exit.type, 'EXIT');
});

test('暖機需求遠低於波段策略,10 天資料即可評估', () => {
  // 迷因幣的核心訴求:不需要 crypto_wave 的 312 根(約 52 天)歷史
  assert.ok(cryptoMomentumBurst.warmupBars <= 60);
  assert.deepEqual(cryptoMomentumBurst.markets, ['CRYPTO']);
  assert.equal(cryptoMomentumBurst.supportsShort, false);
  // 描述必須明確揭露倖存者偏差,避免使用者誤信回測績效
  assert.match(cryptoMomentumBurst.description, /倖存者偏差/);
});
