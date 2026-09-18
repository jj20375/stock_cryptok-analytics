/** @file 交易明細與原始訊號 log 表格；未平倉與被拒絕的請求都必須看得到，不隱藏失敗樣本。 */
import type { TradeRecord } from '../../services/tradingview/performance';
import type { SignalLogRow } from '../../services/tradingview/loader.server';
import { formatTime, pct, priceText } from './PerformanceCards';

const tone = (value: number | null) => value == null ? '' : value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-700' : '';

/** 狀態直接對應 webhook 端點回應，讓「沒收到訊號」能立刻分辨是哪一段出問題。 */
const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: '已接收',
  REJECTED_AUTH: '密鑰不符（已拒絕）',
  REJECTED_JSON: '訊息非合法 JSON',
  NO_CHANNEL: '已接收，但未設定 Slack 頻道',
};

export function TradeTable({ trades }: { trades: TradeRecord[] }) {
  if (!trades.length) return <section className="rounded-xl border border-dashed border-black/25 p-8 text-center">
    <h2 className="font-semibold">目前沒有符合篩選條件的交易</h2>
    <p className="mt-2 text-sm opacity-65">TradingView 送出進場訊號後，這裡會自動建立部位；收到對應的出場訊號才會計算報酬。</p>
  </section>;
  return <section className="rounded-xl border border-black/15 bg-white/70 p-5 space-y-3" aria-labelledby="tv-trade-title">
    <h2 id="tv-trade-title" className="text-xl font-bold">交易明細</h2>
    <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
      <thead className="border-b border-black/20"><tr>{['標的', '方向', '進場', '出場', '報酬', '狀態'].map(label =>
        <th key={label} className="py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
      <tbody>{trades.map(trade => <tr key={trade.id} className="border-b border-black/10 align-top">
        <td className="py-3 pr-4"><strong>{trade.symbol}</strong>
          <small className="block opacity-60">{trade.market === 'tw_stock' ? '台股' : '虛擬幣'}</small></td>
        <td className="py-3 pr-4">{trade.direction === 'LONG' ? '🟢 多單' : '🔴 空單'}</td>
        <td className="py-3 pr-4">{priceText(trade.entryPrice, trade.market)}
          <small className="block opacity-60">{formatTime(trade.entryAt)}</small></td>
        <td className="py-3 pr-4">{trade.exitPrice == null ? '—' : priceText(trade.exitPrice, trade.market)}
          <small className="block opacity-60">{trade.exitAt ? formatTime(trade.exitAt) : '持倉中'}</small></td>
        <td className={`py-3 pr-4 font-semibold ${tone(trade.returnPct)}`}>{pct(trade.returnPct)}</td>
        <td className="py-3">{trade.closed
          ? <span className="rounded-full bg-black/10 px-2 py-1 text-xs">已平倉</span>
          : <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">持倉中</span>}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="text-xs opacity-65">紙上模擬：以訊號當下的價格成交，未扣手續費、滑價與稅費，與實際下單結果會有落差。</p>
  </section>;
}

export function SignalLogTable({ signals }: { signals: SignalLogRow[] }) {
  return <details className="rounded-xl border border-black/15 bg-white/70 p-5">
    <summary className="cursor-pointer font-semibold">原始訊號紀錄（最近 {signals.length} 筆，含被拒絕的請求）</summary>
    {signals.length === 0
      ? <p className="mt-3 text-sm opacity-65">尚未收到任何 TradingView 請求。如果 Alert 已觸發卻沒有紀錄，代表請求根本沒有送達這個端點。</p>
      : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
        <thead className="border-b border-black/20"><tr>{['時間', '標的', '方向', '價格', '狀態', 'Slack', '配對結果'].map(label =>
          <th key={label} className="py-2 pr-4 font-medium">{label}</th>)}</tr></thead>
        <tbody>{signals.map(signal => <tr key={signal.id} className="border-b border-black/10 align-top">
          <td className="py-2 pr-4 whitespace-nowrap">{formatTime(signal.receivedAt)}</td>
          <td className="py-2 pr-4">{signal.symbol}</td>
          <td className="py-2 pr-4">{signal.action ?? '—'}</td>
          <td className="py-2 pr-4">{priceText(signal.price, signal.market)}</td>
          <td className="py-2 pr-4">{STATUS_LABELS[signal.status] ?? signal.status}
            {signal.error && <small className="block opacity-60">{signal.error}</small>}</td>
          <td className="py-2 pr-4">{signal.slackOk == null ? '—' : signal.slackOk ? '✅' : '❌'}</td>
          <td className="py-2">{signal.tradeEffect ?? '—'}</td>
        </tr>)}</tbody>
      </table></div>}
  </details>;
}
