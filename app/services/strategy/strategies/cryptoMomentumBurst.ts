import type { StrategyContext, StrategyModule } from '../types';

/**
 * 【詳細繁體中文註解】：短線動能爆發策略(高風險,專為迷因幣/妖幣設計)
 *
 * 為什麼需要另一套策略:
 *   既有的 crypto_wave 波段策略要求「312 根 4h 暖機(約 52 天)+ 51 個完整日線 + MA20/MA50 上升」,
 *   剛上市或剛啟動的迷因幣根本湊不出這種長期結構,加進觀察名單也只會永遠停在 WAIT。
 *   本策略把暖機需求壓到 60 根(4h 約 10 天),改以「短期動能 + 放量突破」捕捉快速行情。
 *
 * ⚠️ 風險與限制(務必理解後再使用):
 *   1. 倖存者偏差極嚴重:能被回測到的迷因幣都是「還活著」的,已歸零下架的幣不在資料裡,
 *      因此本策略的回測績效會系統性高估,絕不能當成未來期望值。
 *   2. 迷因幣可能在數小時內腰斬,停損不保證能在設定價位成交(跳空/流動性枯竭)。
 *   3. 本策略未納入「相對大盤強度」— 策略介面目前只提供單一標的 K 線,無法比較 BTC。
 *   4. 僅做多。所有門檻皆為未經樣本外驗證的起始假設,請先用回測分幣種、分行情區間檢驗。
 *
 * 進場需同時滿足(任一不符即不進場):
 *   突破  :收盤價 > 前 breakoutBars 根最高價
 *   放量  :當根成交量 >= 前 breakoutBars 根均量 × volumeMultiplier
 *   動能  :近 momentumBars 根漲幅 >= momentumPct(確認確實在啟動,而非緩慢盤整)
 *   不追高:收盤距突破位 <= maxExtensionPct%(避免在噴出末端進場)
 *   流動性:近 6 根成交額 >= minQuoteVolume(迷因幣薄量時容易被單筆大單拉爆)
 *   波動可控:ATR14 / 收盤 <= maxAtrPct%(已經失控的標的不進場)
 *
 * 出場:收盤跌破前 exitBars 根低點(結構失效),或觸及引擎依 stopLossPct 設定的停損。
 */

export const MOMENTUM_BURST_PARAMS = {
  breakoutBars: 12,
  volumeMultiplier: 3,
  momentumBars: 6,
  momentumPct: 8,
  maxExtensionPct: 8,
  minQuoteVolume: 2_000_000,
  maxAtrPct: 15,
  stopLossPct: 10,
  exitBars: 5,
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const cryptoMomentumBurst: StrategyModule = {
  id: 'crypto_momentum_burst',
  name: '短線動能爆發(迷因幣・高風險)',
  description:
    '專為迷因幣/妖幣設計的短歷史動能策略:僅需約 10 天資料,以「放量突破 + 短期強勢動能 + 不追高 + 流動性門檻」進場,跌破前 N 根低點或觸及停損出場。⚠️ 迷因幣回測存在嚴重倖存者偏差(歸零下架的幣不在資料中),績效會被系統性高估,且可能數小時內腰斬,務必小額驗證。',
  markets: ['CRYPTO'],
  supportedIntervals: ['1h', '4h'],
  // 暖機:突破/動能回看最多 12 根 + ATR14 + 裕度,60 根即足夠(4h 約 10 天)
  warmupBars: 60,
  supportsShort: false,
  defaultParams: MOMENTUM_BURST_PARAMS,
  paramMeta: [
    { key: 'breakoutBars', label: '突破回看根數', description: '只比較當根之前的高點', min: 5, max: 40, step: 1 },
    { key: 'volumeMultiplier', label: '突破量能倍數', description: '迷因幣雜訊多,預設要求 3 倍均量', min: 1.5, max: 10, step: 0.5 },
    { key: 'momentumBars', label: '動能回看根數', description: '計算近期漲幅的區間長度', min: 3, max: 30, step: 1 },
    { key: 'momentumPct', label: '動能漲幅門檻 %', description: '近期漲幅需達此門檻才視為啟動', min: 2, max: 50, step: 1 },
    { key: 'maxExtensionPct', label: '最大追價距離 %', description: '收盤距突破位超過此距離不進場', min: 1, max: 30, step: 1 },
    { key: 'minQuoteVolume', label: '近 24h 估計成交額下限', description: '單一來源量乘收盤價的 USDT 近似值', min: 0, max: 100000000, step: 100000 },
    { key: 'maxAtrPct', label: '波動上限 %', description: 'ATR14 佔價格比重超過此值視為失控', min: 3, max: 50, step: 1 },
    { key: 'stopLossPct', label: '停損 %', description: '迷因幣波動大,停損過緊易被掃出', min: 3, max: 30, step: 1 },
    { key: 'exitBars', label: '出場回看根數', description: '收盤跌破前 N 根低點即出場', min: 2, max: 30, step: 1 },
  ],

  evaluate(ctx: StrategyContext) {
    const { candles, index, params, indicators } = ctx;

    // 參數來自使用者表單,無效值一律不產生訊號(與 crypto_wave 相同的防護原則)
    if (!Number.isInteger(params.breakoutBars) || params.breakoutBars < 5 || params.breakoutBars > 40 ||
        !Number.isInteger(params.momentumBars) || params.momentumBars < 3 || params.momentumBars > 30 ||
        !Number.isInteger(params.exitBars) || params.exitBars < 2 || params.exitBars > 30 ||
        !Object.values(params).every(Number.isFinite) ||
        params.volumeMultiplier < 1 || params.momentumPct <= 0 || params.maxExtensionPct <= 0 ||
        params.minQuoteVolume < 0 || params.maxAtrPct <= 0 || params.stopLossPct <= 0) {
      return { type: 'HOLD' as const };
    }

    // ── 持倉中:只看出場條件,不受進場的量能/流動性限制阻擋風控 ──
    if (ctx.position) {
      if (index < params.exitBars) return { type: 'HOLD' as const };
      const floor = Math.min(...candles.slice(index - params.exitBars, index).map(c => c.low));
      if (candles[index].close < floor) {
        return { type: 'EXIT' as const, reason: `收盤跌破前 ${params.exitBars} 根低點,動能結構失效` };
      }
      return { type: 'HOLD' as const };
    }

    const lookback = Math.max(params.breakoutBars, params.momentumBars, 14);
    if (index < lookback + 1) return { type: 'HOLD' as const };

    const current = candles[index];
    const history = candles.slice(index - params.breakoutBars, index);
    const breakoutLevel = Math.max(...history.map(c => c.high));
    const averageVolume = mean(history.map(c => c.volume));

    // 1) 放量突破
    if (!(current.close > breakoutLevel)) return { type: 'HOLD' as const };
    if (!(averageVolume > 0 && current.volume >= averageVolume * params.volumeMultiplier)) {
      return { type: 'HOLD' as const };
    }

    // 2) 短期動能:確認確實在啟動,而不是慢慢磨上來
    const momentumBase = candles[index - params.momentumBars].close;
    if (!(momentumBase > 0)) return { type: 'HOLD' as const };
    const momentumPct = ((current.close - momentumBase) / momentumBase) * 100;
    if (momentumPct < params.momentumPct) return { type: 'HOLD' as const };

    // 3) 不追高:距突破位太遠代表已經噴出一段,風險報酬比變差
    const extensionPct = ((current.close - breakoutLevel) / breakoutLevel) * 100;
    if (extensionPct > params.maxExtensionPct) return { type: 'HOLD' as const };

    // 4) 流動性門檻:迷因幣薄量時價格容易被單筆大單操縱
    const quoteVolume = candles.slice(index - 5, index + 1).reduce((sum, c) => sum + c.volume * c.close, 0);
    if (quoteVolume < params.minQuoteVolume) return { type: 'HOLD' as const };

    // 5) 波動可控:已經失控的標的停損會失去意義
    const atr = indicators.atr(14)[index];
    if (!Number.isFinite(atr) || atr <= 0) return { type: 'HOLD' as const };
    const atrPct = (atr / current.close) * 100;
    if (atrPct > params.maxAtrPct) return { type: 'HOLD' as const };

    return {
      type: 'ENTRY' as const,
      side: 'LONG' as const,
      stopLossPct: params.stopLossPct,
      reason: `放量突破前 ${params.breakoutBars} 根高點(量能 ${(current.volume / averageVolume).toFixed(1)} 倍)` +
        `,近 ${params.momentumBars} 根漲幅 ${momentumPct.toFixed(1)}%,距突破位僅 ${extensionPct.toFixed(1)}%`,
    };
  },
};

export default cryptoMomentumBurst;
