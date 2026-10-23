/** @file 市場漲跌走勢羅盤的資料讀取；定時自動更新，避免頁面掛著時一直顯示前一晚的舊判讀。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MacroIndicators } from '../../services/macroService';

/**
 * 自動更新間隔（毫秒）：5 分鐘。後端已有 3 分鐘快取，太頻繁只會拿到同一份資料；
 * 再長則台股盤中期貨與台幣的變化會跟不上（10/22 盤中 NQ 一小時可走 0.3% 以上）。
 */
export const MACRO_AUTO_REFRESH_MS = 5 * 60 * 1000;

export function useMacroIndicators() {
  const [macro, setMacro] = useState<MacroIndicators | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  /** 最後一次成功取得判讀的時間；分頁切回前景時用來判斷是否需要立即補更新 */
  const lastLoadedAtRef = useRef(0);

  /**
   * 向後端 `/api/macro` 拉取最新四大維度指標
   * @param forceRefresh 是否強制略過後端 3 分鐘記憶體快取
   */
  const fetchMacro = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(forceRefresh ? '/api/macro?refresh=1' : '/api/macro');
      if (!res.ok) throw new Error('暫時無法取得市場總經指標');
      const json = await res.json();
      if (!json.indicators) throw new Error('市場總經指標格式異常');
      setMacro(json.indicators);
      lastLoadedAtRef.current = Date.now();
    } catch (err: any) {
      setError(err.message || '載入市場走勢羅盤失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMacro(false);
    // 背景分頁不輪詢，省下 Yahoo 請求；切回前景時若已超過更新間隔就立刻補抓
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchMacro(false);
    }, MACRO_AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadedAtRef.current >= MACRO_AUTO_REFRESH_MS) {
        fetchMacro(false);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchMacro]);

  return { macro, loading, error, fetchMacro };
}
