/** @file 戰情室每分鐘讀取一次；取消舊請求，避免切換週期後顯示前一個週期的資料。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WarRoomData } from './types';

export const useWarRoom = (interval: string) => {
  /** 查詢狀態與輸入週期綁定；刷新失敗時清空訊號，避免把舊訊號當成當前機會。 */
  const [data, setData] = useState<WarRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const fetchData = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/warroom?interval=${interval}`, { signal: controller.signal });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || `讀取失敗 (${response.status})`);
      if (controller.signal.aborted) return;
      setData(json);
      setError('');
    } catch (err) {
      if (controller.signal.aborted) return;
      setData(null);
      setError((err as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [interval]);
  useEffect(() => {
    setData(null);
    /** 上輪完成後才安排下一輪；慢來源不可被每 60 秒的計時器取消，否則永遠沒有首份結果。 */
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await fetchData();
      if (!stopped) timer = setTimeout(poll, 60_000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); requestRef.current?.abort(); };
  }, [fetchData]);
  /** 渲染時也比對週期，補上 effect 執行前的空窗。 */
  return { data: data?.interval === interval ? data : null, loading, error, refresh: fetchData };
};
