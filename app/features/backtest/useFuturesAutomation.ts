/** @file 合約自動化狀態與表單；預覽及連線檢查均唯讀，輪詢不在瀏覽器觸發交易。 */
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import type { AutomationInput, AutomationPreview, AutomationStatus } from '../../services/cryptoFutures/automation';
export function useFuturesAutomation() {
  const status = useFetcher<AutomationStatus & { error?: string }>();
  const action = useFetcher<{ message?: string; error?: string; preview?: AutomationPreview }>();
  const { load } = status;
  /** 頁面可關閉；自動化由 Worker 排程執行，背景分頁不持續增加查詢。 */
  useEffect(() => {
    load('/api/futures-automation');
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load('/api/futures-automation'); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  /** 儲存或停止成功後刷新狀態；保留失敗訊息供使用者修正。 */
  useEffect(() => { if (action.state === 'idle' && action.data?.message) load('/api/futures-automation'); }, [action.state, action.data, load]);
  const submit = (body: Record<string, string | number | boolean>) => action.submit(body, { method: 'POST', action: '/api/futures-automation', encType: 'application/json' });
  return { status: status.data, busy: action.state !== 'idle', message: action.data?.message, error: action.data?.error, preview: action.data?.preview,
    save: (input: AutomationInput, confirmed: boolean) => submit({ operation: 'save', ...input, [input.executionMode === 'LIVE' ? 'confirmLive' : 'confirmDemo']: confirmed }),
    previewSettings: (input: AutomationInput) => submit({ operation: 'preview', ...input, enabled: false }),
    stop: () => submit({ operation: 'stop' }), check: (executionMode: AutomationInput['executionMode']) => submit({ operation: 'check', executionMode }) };
}
