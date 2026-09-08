/**
 * 【詳細繁體中文註解】：戰情室資料抓取與自動刷新 hook
 *
 * 「動態」需求以客戶端輪詢實現:預設每 60 秒自動重新呼叫 API 一次,
 * 並提供手動刷新按鈕;切換 K 線週期時立即重新抓取。
 * margin/leverage 純粹是前端狀態,不觸發 API 呼叫(倉位試算在元件端即時運算)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WarRoomData } from './types';

// 自動刷新間隔:60 秒。太短會浪費 Binance 公開 API 額度且對「4h 週期策略」沒有實質意義,
// 太長則失去「戰情室即時掌握盤勢」的價值,60 秒是折衷值。
const AUTO_REFRESH_MS = 60_000;

export const useWarRoom = (interval: string) => {
  const [data, setData] = useState<WarRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async (currentInterval: string) => {
    try {
      const response = await fetch(`/api/warroom?interval=${currentInterval}`);
      const json = (await response.json()) as any;
      if (!response.ok) throw new Error(json?.error || `API 錯誤 (${response.status})`);
      if (!aliveRef.current) return;
      setData(json);
      setError('');
    } catch (err) {
      if (!aliveRef.current) return;
      setError((err as Error).message);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData(interval);

    const timer = setInterval(() => fetchData(interval), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [interval, fetchData]);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchData(interval);
  }, [interval, fetchData]);

  return { data, loading, error, refresh };
};
