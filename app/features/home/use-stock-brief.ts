/** @file 選股參考資料的讀取生命週期；切股立即清除舊資料並取消請求，避免把 A 股消息顯示在 B 股。 */
import { useEffect, useState } from 'react';
import type { BriefMarket, StockBrief } from '../../services/stockBrief/types';

export function useStockBrief(symbol: string, market: BriefMarket, loggedIn: boolean) {
  const [data, setData] = useState<StockBrief | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** 只有使用者按重新讀取才重送；來源快取可避免反覆點選造成多餘請求。 */
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setLoading(loggedIn);
    if (loggedIn) {
      fetch(`/api/stock-brief?symbol=${encodeURIComponent(symbol)}&market=${market}`, { signal: controller.signal })
        .then(async response => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '讀取失敗，請稍後重試。');
          if (!controller.signal.aborted) setData(body);
        }).catch(cause => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '讀取失敗，請稍後重試。');
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [symbol, market, loggedIn, revision]);
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}
