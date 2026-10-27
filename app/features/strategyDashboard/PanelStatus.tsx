/** @file 面板狀態列：來源、最後更新時間、過時與失敗警示，以及固定的「非投資建議」提示。 */
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import type { DashboardPanelData } from '../../services/strategyDashboard/types';
import { formatAgo, formatTaipei } from './format';
import { PANEL_AUTO_REFRESH_MS } from './useDashboardPanel';

export function Disclaimer() {
  return <p role="note" className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
    ⚠ 僅供參考，非投資建議。清單來自已收盤 K 線的條件篩選，不保證獲利；本頁不提供下單，也不會觸發任何推播或交易。
  </p>;
}

export function PanelStatus({ panel, loading, error, lastSuccessAt, now, onRefresh }: {
  panel: DashboardPanelData | null;
  loading: boolean;
  error: string | null;
  lastSuccessAt: number | null;
  now: number;
  onRefresh: () => void;
}) {
  /** 瀏覽器超過兩個更新週期都沒有成功取得資料，代表自動更新卡住，必須提醒使用者畫面可能過時。 */
  const clientStale = lastSuccessAt != null && now - lastSuccessAt > PANEL_AUTO_REFRESH_MS * 2;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/15 bg-white/70 px-4 py-3 text-sm">
      <div className="space-y-0.5">
        <p><span className="opacity-60">資料來源：</span><strong>{panel?.sourceLabel ?? '讀取中…'}</strong></p>
        <p className="text-xs opacity-70">
          最後更新：{lastSuccessAt ? `${formatTaipei(lastSuccessAt, true)}（${formatAgo(lastSuccessAt, now)}）` : '尚未取得'}
          {panel?.latestBarClosedAt ? `・最新訊號收盤 ${formatTaipei(panel.latestBarClosedAt)}` : ''}
          ・每 5 分鐘自動更新</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading}
        className="inline-flex items-center gap-2 rounded border border-current px-3 py-1.5 text-sm disabled:opacity-50">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{loading ? '更新中…' : '立即更新'}
      </button>
    </div>
    {error && <p role="alert" className="flex gap-2 rounded border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>更新失敗：{error}{panel && lastSuccessAt ? `。以下仍是 ${formatTaipei(lastSuccessAt, true)} 取得的舊資料，可能已過時。` : ''}</span></p>}
    {clientStale && !error && <p role="alert" className="rounded border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      已超過 10 分鐘未成功更新，以下資料可能已過時。</p>}
    {panel?.stale && <p role="alert" className="flex gap-2 rounded border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>資料過時：{panel.staleReason}</span></p>}
    {panel?.notes.map(note => <p key={note} className="flex gap-2 rounded border border-black/10 bg-white/60 px-3 py-2 text-xs">
      <Info size={14} className="mt-0.5 shrink-0" /><span>{note}</span></p>)}
  </div>;
}
