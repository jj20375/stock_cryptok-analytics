/**
 * 【詳細繁體中文註解】：權益曲線與回撤圖(Recharts)
 * 上半:權益曲線 AreaChart;下半:從波段高點起算的回撤 %(永遠 <= 0,紅色面積)。
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EquityPoint } from '../types';
import { chartDateFormatter } from '../../../utils/chartDate';

interface EquityCurveChartProps {
  equityCurve: EquityPoint[];
  initialCapital: number;
}

const formatTime = (time: number) =>
  new Date(time).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric' });

const tooltipDateFormat = chartDateFormatter();

export function EquityCurveChart({ equityCurve, initialCapital }: EquityCurveChartProps) {
  // 計算逐點回撤 %(相對截至當下的波段高點)
  let peak = -Infinity;
  const data = equityCurve.map((point) => {
    if (point.equity > peak) peak = point.equity;
    const drawdownPct = peak > 0 ? -((peak - point.equity) / peak) * 100 : 0;
    return { ...point, drawdownPct: Math.round(drawdownPct * 100) / 100 };
  });

  return (
    <div className="bg-white/80 border border-[#141414] rounded-sm p-4 flex flex-col gap-2">
      <h3 className="text-xs font-bold font-serif">權益曲線</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#141414" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#141414" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#14141420" vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              minTickGap={48}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              width={56}
            />
            <Tooltip
              labelFormatter={(value) => tooltipDateFormat.format(Number(value))}
              formatter={(value: number) => [`${value}`, '權益']}
              contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
            />
            {/* 初始資金基準線以 baseValue 呈現 */}
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#141414"
              strokeWidth={1.5}
              fill="url(#equityFill)"
              baseValue={initialCapital}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <h3 className="text-xs font-bold font-serif mt-1">回撤 %</h3>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="time" hide />
            <YAxis
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              width={56}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              labelFormatter={(value) => tooltipDateFormat.format(Number(value))}
              formatter={(value: number) => [`${value}%`, '回撤']}
              contentStyle={{ fontSize: 11, fontFamily: 'monospace' }}
            />
            <Area
              type="monotone"
              dataKey="drawdownPct"
              stroke="#f43f5e"
              strokeWidth={1}
              fill="#f43f5e33"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
