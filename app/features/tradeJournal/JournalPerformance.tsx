/** @file 已對帳 USDT 現金損益；圖表單位與缺漏狀態明確呈現。 */
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { computeMetrics } from '../../services/bitgetLedger/metrics';
export const money = (value: string | number | null) => value === null ? '未完整' : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
export function JournalPerformance({ metrics }: { metrics: ReturnType<typeof computeMetrics> }) {
  const cards = [
    ['實際淨損益', money(metrics.net)], ['已實現損益', money(metrics.realized)],
    ['手續費現金流', money(metrics.fees)], ['資金費率現金流', money(metrics.funding)],
    ['完整已平倉樣本', String(metrics.closedCount)], ['勝率', metrics.winRate === null ? '無樣本' : `${metrics.winRate.toFixed(1)}%`],
    ['獲利因子', metrics.profitFactor === null ? '無虧損樣本' : metrics.profitFactor.toFixed(2)],
    ['每倉期望損益', metrics.expectancy === null ? '無樣本' : money(metrics.expectancy)],
    ['最大日末現金回撤', money(metrics.maximumDrawdown)],
  ];
  return <section className="space-y-4" aria-label="成交績效">
    {!metrics.reliable && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      區間尚未完整對帳。下方為已取得的現金流，完整淨利與回撤暫不計算。
      缺損益 {metrics.missingPnl} 筆／缺費用 {metrics.missingFees} 筆／其他費用幣別 {metrics.otherCoins.join('、') || '無'}。
    </div>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {cards.map(([label, value]) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-500">{label}{!['勝率', '獲利因子', '完整已平倉樣本'].includes(label) && ' · USDT'}</p>
        <p className="mt-2 font-mono text-xl">{value}</p>
      </div>)}
    </div>
    <p className="text-xs text-gray-500">現金損益依 UTC 事件日入帳，未含未實現損益；回撤以日末計算。勝率以完整已平倉倉位計算，排除 {metrics.excludedCount} 筆缺漏樣本。</p>
    {!!metrics.curve.length && <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium">{metrics.reliable ? '累計現金損益' : '已觀測累計現金損益（未完整）'} · USDT</h3>
        <div className="h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={metrics.curve}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
          <Line name="累計損益" dataKey="cumulative" stroke="#2563eb" dot={false} strokeWidth={2} />
        </LineChart></ResponsiveContainer></div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium">{metrics.reliable ? '月度現金損益' : '已觀測月度現金損益（未完整）'} · USDT</h3>
        <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={metrics.monthly}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
          <Bar name="月損益" dataKey="pnl" fill="#2563eb" />
        </BarChart></ResponsiveContainer></div>
      </div>
    </div>}
  </section>;
}
