/** @file 研究摘要独立輪詢；不讓行情 API 的失敗或延遲擋住模擬服務狀態。 */
import { useEffect, useState } from 'react';
import type { ResearchDashboard } from '../../services/freqtrade/research.server';

export function useResearch() {
  /** 保留最後成功結果供追溯，但讀取失敗時必須明確標示，不能仍顯示在線。 */
  const [data, setData] = useState<ResearchDashboard | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let controller: AbortController;
    const read = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch('/api/freqtrade/research', { signal: controller.signal });
        const body = await response.json() as ResearchDashboard;
        if (!response.ok) throw new Error(response.status === 401 ? '登入已失效，請重新登入。' : '研究資料暫時無法讀取。');
        if (active) { setData(body); setError(''); }
      } catch (error) {
        if (active && (error as Error).name !== 'AbortError') setError((error as Error).message);
      }
    };
    void read();
    const timer = setInterval(read, 60_000);
    return () => { active = false; controller?.abort(); clearInterval(timer); };
  }, []);
  return { data, error };
}
