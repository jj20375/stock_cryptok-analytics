/** @file 股票永續掃描：重用首頁純評分，逐檔讀公開行情，排名與 AI 說明皆無下單副作用。 */
import { evaluateTrendMomentumData, evaluateConsecutiveVolumeData, evaluateVolumeNoBreakoutData } from '../stockService';
import { calculateEMA, calculateMA, calculateRSI, calculateMACD, calculateKD } from '../indicators/technical';
import { loadStockPerpCandles, loadStockPerpTickers, STOCK_PERP_INTERVALS, type StockPerpContract, type StockPerpTicker } from './market';
import type { Candle } from '../strategy/types';
import type { StockDataPoint, Timeframe } from '../../types';
import type { ScanStrategy } from '../../features/home/types';

export const STOCK_PERP_SCAN_STRATEGIES: { id: ScanStrategy; name: string; description: string }[] = [
  { id: 'trend', name: '多空趨勢強勢追蹤', description: '共用 MA20、EMA26、RSI、MACD、KD 評分，40 分以上列為觀察。' },
  { id: 'consecutive_volume', name: '量能連續兩期以上放大', description: '連續至少兩根量能大於前 5 根均量的 1.5 倍。' },
  { id: 'volume_no_break', name: '量增但未突破前高', description: '量能大於前 5 根均量 1.5 倍且未過前高，僅作做空觀察。' },
  { id: 'daily_volume_spike', name: '日線量增 2 倍', description: '已收盤日線量能達前一日 2 倍，分開標示放量漲跌。' },
];
/** 股票永續的初始流動性篩選：成交額至少 10 萬 USDT、即時價差不超過 0.5%，不代表可承受任意倉位。 */
export const MIN_STOCK_PERP_TURNOVER = 100_000;
export const MAX_STOCK_PERP_SPREAD_PCT = 0.5;

export interface StockPerpPick {
  symbol: string; name: string; score: number; reason: string; bias: string; signalTime: number;
  price: number; turnoverUsdt: number; spreadPct: number; aiInsight?: string;
}
export interface StockPerpScanProgress {
  processed: number; total: number; excluded: number; insufficient: number; stale: number; failed: number;
  matched: number; scanAt: number; results: StockPerpPick[]; issues: string[];
}

/** 共用首頁指標實作，EMA26／RSI14／MA20／MACD12-26-9／KD9 不另寫第二套公式。 */
function indicatorData(candles: Candle[]): StockDataPoint[] {
  const data = candles.map(c => ({ date: '', timestamp: c.openTime, price: c.close, open: c.open, high: c.high,
    low: c.low, close: c.close, volume: c.volume, currency: 'USDT', isMock: false }));
  const closes = candles.map(c => c.close), ma20 = calculateMA(closes, 20), ema26 = calculateEMA(closes, 26);
  const rsi14 = calculateRSI(closes, 14), macd = calculateMACD(closes), kd = calculateKD(data);
  return data.map((c, index) => ({ ...c, ma20: ma20[index], emaLong: ema26[index], rsi: rsi14[index],
    macdHist: macd.hist[index], k: kd.k[index], d: kd.d[index] }));
}

/** 已收盤根與共同掃描時間固定；資料不足、逾期或零量不列為「未符合條件」，避免混淆。 */
export function scoreStockPerpCandidate(contract: StockPerpContract, ticker: StockPerpTicker, candles: Candle[],
  strategy: ScanStrategy, timeframe: Timeframe, now: number): { status: 'match' | 'unmatched' | 'insufficient' | 'stale'; pick?: StockPerpPick } {
  const duration = STOCK_PERP_INTERVALS[timeframe].duration;
  const closed = candles.filter(c => c.openTime + duration <= now);
  const minimum = strategy === 'trend' ? 60 : strategy === 'consecutive_volume' ? 10 : strategy === 'volume_no_break' ? 6 : 2;
  if (closed.length < minimum) return { status: 'insufficient' };
  const latest = closed.at(-1)!, previous = closed.at(-2)!;
  if (now - latest.openTime - duration > duration * 3) return { status: 'stale' };
  if (latest.volume <= 0 || previous.volume <= 0) return { status: 'insufficient' };
  const data = indicatorData(closed);
  let score = 0, reason = '', triggered = false, bias = '方向待確認';
  if (strategy === 'trend') {
    const result = evaluateTrendMomentumData(data);
    score = result.score; triggered = result.isTriggered; reason = result.reasons.join('；');
    bias = result.trend === 'up' ? '做多觀察' : '趨勢待確認';
  } else if (strategy === 'consecutive_volume') {
    const result = evaluateConsecutiveVolumeData(data, 1.5);
    triggered = result.isTriggered; score = 50 + result.consecutiveDays * 15; reason = result.reasons.join('；');
    bias = latest.close >= previous.close ? '放量上漲' : '放量下跌';
  } else if (strategy === 'volume_no_break') {
    const result = evaluateVolumeNoBreakoutData(data, 1.5);
    triggered = result.isTriggered; score = 75; reason = result.reasons.join('；'); bias = '做空觀察';
  } else {
    /** 2 倍與畫面標示一致；爆量下跌也能進入觀察名單，但不冒充做多進場。 */
    const multiple = latest.volume / previous.volume;
    triggered = multiple >= 2; score = 60 + multiple * 8; reason = `已收盤日線成交量為前一日 ${multiple.toFixed(2)} 倍`;
    bias = latest.close >= previous.close ? '放量上漲' : '放量下跌';
  }
  if (!triggered) return { status: 'unmatched' };
  return { status: 'match', pick: { symbol: contract.symbol, name: contract.baseCoin, score: Math.min(100, Math.round(score)),
    reason, bias, signalTime: latest.openTime + duration, price: latest.close, turnoverUsdt: ticker.turnoverUsdt, spreadPct: ticker.spreadPct } };
}

/** 每次行情之後至少等 200ms，單一掃描最多約每秒 5 次；取消會清除等待並中止後續請求。 */
function pace(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function scanStockPerps(contracts: StockPerpContract[], strategy: ScanStrategy, timeframe: Timeframe,
  signal: AbortSignal, onProgress: (progress: StockPerpScanProgress) => void): Promise<StockPerpScanProgress> {
  signal.throwIfAborted();
  const scanAt = Date.now(), actualTimeframe = strategy === 'daily_volume_spike' ? '1d' : timeframe;
  const tickers = new Map((await loadStockPerpTickers(signal)).map(ticker => [ticker.symbol, ticker]));
  const universe = contracts.filter(c => {
    const ticker = tickers.get(c.symbol);
    return ticker && ticker.turnoverUsdt >= MIN_STOCK_PERP_TURNOVER && ticker.spreadPct <= MAX_STOCK_PERP_SPREAD_PCT;
  }).sort((a, b) => tickers.get(b.symbol)!.turnoverUsdt - tickers.get(a.symbol)!.turnoverUsdt);
  const progress: StockPerpScanProgress = { processed: 0, total: universe.length, excluded: contracts.length - universe.length,
    insufficient: 0, stale: 0, failed: 0, matched: 0, scanAt, results: [], issues: [] };
  const matches: StockPerpPick[] = [];
  let consecutiveFailures = 0;
  onProgress({ ...progress });
  for (const contract of universe) {
    signal.throwIfAborted();
    try {
      const candles = await loadStockPerpCandles(contract.symbol, actualTimeframe, 120, signal, scanAt);
      const result = scoreStockPerpCandidate(contract, tickers.get(contract.symbol)!, candles, strategy, actualTimeframe, scanAt);
      consecutiveFailures = 0;
      if (result.status === 'insufficient') progress.insufficient++;
      if (result.status === 'stale') progress.stale++;
      if (result.pick) matches.push(result.pick);
    } catch (error) {
      signal.throwIfAborted();
      progress.failed++; consecutiveFailures++;
      if (progress.issues.length < 3) progress.issues.push(`${contract.symbol}：${error instanceof Error ? error.message : '行情讀取失敗'}`);
    }
    progress.processed++; progress.matched = matches.length;
    progress.results = matches.sort((a, b) => b.score - a.score || b.turnoverUsdt - a.turnoverUsdt || a.symbol.localeCompare(b.symbol)).slice(0, 10);
    onProgress({ ...progress, issues: [...progress.issues] });
    if (consecutiveFailures >= 5) throw new Error('連續五個商品行情請求失敗，已停止掃描；保留目前部分結果，請確認網路後重試。');
    if (progress.processed < progress.total) await pace(signal);
  }
  return progress;
}

/** Gemini 只解讀已排名候選的事實，不改分數、不增加商品；AI 失敗由畫面明示並保留技術排名。 */
export async function explainStockPerpPicks(picks: StockPerpPick[], timeframe: Timeframe, signal: AbortSignal) {
  const response = await fetch('/api/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), body: JSON.stringify({ type: 'scanner',
      prompt: `僅依下列 Bitget USDT 股票永續 ${timeframe} 已收盤觀察名單，為每檔提供 60 字內繁體中文技術解讀。
禁止捏造新聞、支撐價格、勝率或保證進場；不要更動排名或分數，放量下跌與未過前高須明示風險。不是現貨持股建議。
${JSON.stringify(picks)}\n回傳 {"recommendations":[{"symbol":"原代號","aiInsight":"解讀"}]}` }) });
  if (!response.ok) throw new Error(response.status === 401 ? 'AI 解讀需要登入；技術排名已保留。' : 'AI 解讀暫時無法取得；技術排名已保留。');
  const payload = await response.json() as { recommendations?: { symbol: string; aiInsight: string }[] };
  if (!Array.isArray(payload.recommendations)) throw new Error('AI 解讀格式錯誤；技術排名已保留。');
  return picks.map(pick => {
    const text = payload.recommendations?.find(row => row.symbol === pick.symbol)?.aiInsight;
    return typeof text === 'string' && text.trim() ? { ...pick, aiInsight: text.trim().slice(0, 160) } : pick;
  });
}
