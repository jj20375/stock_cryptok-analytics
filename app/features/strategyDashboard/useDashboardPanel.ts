/**
 * @file 單一市場面板的資料讀取與自動更新；只呼叫唯讀的 /api/strategy-dashboard，不觸發掃描、推播或下單。
 * 面板切走時保留最後資料與狀態，切回時若已超過更新間隔就立即補抓一次。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardMarket, DashboardPanelData } from '../../services/strategyDashboard/types';

/** 自動更新間隔 5 分鐘：與羅盤一致；後端也快取 5 分鐘，更頻繁只會拿到同一份資料。 */
export const PANEL_AUTO_REFRESH_MS = 5 * 60 * 1000;

export interface PanelState {
  panel: DashboardPanelData | null;
  loading: boolean;
  /** 最近一次請求的錯誤；有舊資料時仍保留舊資料，並由畫面明確標示「更新失敗」。 */
  error: string | null;
  /** 最近一次「成功」取得資料的瀏覽器時間。 */
  lastSuccessAt: number | null;
}

export function useDashboardPanel(market: DashboardMarket, active: boolean) {
  const [state, setState] = useState<PanelState>({ panel: null, loading: false, error: null, lastSuccessAt: null });
  const lastSuccessRef = useRef(0);
  const loadingRef = useRef(false);

  const load = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState(previous => ({ ...previous, loading: true, error: null }));
    try {
      const response = await fetch(`/api/strategy-dashboard?market=${market}${force ? '&refresh=1' : ''}`);
      const json = await response.json().catch(() => null) as { panel?: DashboardPanelData; error?: string } | null;
      if (!response.ok || !json?.panel) {
        throw new Error(response.status === 401 ? '登入已過期，請重新登入。' : json?.error ?? `資料讀取失敗（HTTP ${response.status}）`);
      }
      lastSuccessRef.current = Date.now();
      setState({ panel: json.panel, loading: false, error: null, lastSuccessAt: lastSuccessRef.current });
    } catch (error) {
      setState(previous => ({ ...previous, loading: false,
        error: error instanceof Error ? error.message : '資料讀取失敗' }));
    } finally {
      loadingRef.current = false;
    }
  }, [market]);

  /** 第一次切到此面板、或切回時資料已超過更新間隔，就立即讀取。 */
  useEffect(() => {
    if (active && Date.now() - lastSuccessRef.current >= PANEL_AUTO_REFRESH_MS) load(false);
  }, [active, load]);

  /** 只有目前顯示中的面板、且分頁在前景時才定時更新，背景面板不耗用行情請求。 */
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, PANEL_AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSuccessRef.current >= PANEL_AUTO_REFRESH_MS) load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, load]);

  return { ...state, refresh: () => load(true) };
}
