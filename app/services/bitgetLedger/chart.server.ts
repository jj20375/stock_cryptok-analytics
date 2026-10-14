/** @file 復盤圖固定查 Bitget 合約公開行情；不將任意 URL 或商品送往伺服器代理。 */
import type { OHLCV } from '@luxalgo/vela';
import type { LedgerEnv } from './credentials.server';
import { readLedger } from './repository.server';
export async function journalCandles(env: LedgerEnv, userId: number, accountId: string, sessionId: string) {
  const data = await readLedger(env, userId, accountId);
  const session = data.sessions.find(row => row.id === sessionId);
  if (!session) throw new Response('找不到此倉位', { status: 404 });
  const hour = 3_600_000;
  const from = session.openTime - 24 * hour, to = Math.min(Date.now(), (session.closeTime ?? Date.now()) + 24 * hour);
  /** 以最多 600 根保留完整倉位期間；長倉提高週期，圖上標記仍保留精確成交時間。 */
  const timeframe = to - from > 500 * 4 * hour ? '1D' : to - from > 500 * hour ? '4H' : '1H';
  const bars = new Map<number, OHLCV>();
  let end = to;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({ symbol: session.symbol, productType: 'USDT-FUTURES', granularity: timeframe,
      startTime: String(Math.max(from, end - 89 * 86_400_000)), endTime: String(end), limit: '200' });
    const response = await fetch(`https://api.bitget.com/api/v2/mix/market/history-candles?${params}`, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json() as { code?: string; data?: string[][] };
    if (!response.ok || payload.code !== '00000' || !Array.isArray(payload.data)) throw new Error('Bitget 歷史行情暫時無法取得');
    let oldest = end;
    for (const row of payload.data) {
      const values = row.slice(0, 6).map(Number);
      if (values.length !== 6 || values.some(value => !Number.isFinite(value))) throw new Error('Bitget K 線格式不正確');
      const [time, open, high, low, close, volume] = values;
      if (time >= from && time <= to) bars.set(time, { time, open, high, low, close, volume });
      oldest = Math.min(oldest, time);
    }
    if (payload.data.length < 200 || oldest <= from || oldest >= end) break;
    end = oldest - 1;
  }
  const candles = [...bars.values()].sort((a, b) => a.time - b.time);
  if (!candles.length) throw new Error('此期間沒有可用 Bitget K 線');
  return { bars: candles, timeframe, from, to, truncated: candles[0].time > session.openTime };
}
