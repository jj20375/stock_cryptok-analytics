/**
 * 【詳細繁體中文註解】：戰情室 — 加密貨幣永續合約即時訊號看板
 *
 * 定位:比回測系統更直接的「現在該怎麼做」看板,不需要理解回測參數,
 * 打開頁面就能看到:大盤風險燈號、每檔幣種目前訊號(做多/做空/觀望)、
 * 依自訂保證金與槓桿試算的倉位與估算爆倉價、建議停損與離場時機。
 *
 * ⚠️ 純顯示看板,不會替使用者下單 — 所有交易仍需自行到交易所操作。
 * 訊號僅供技術面參考,不構成投資建議,合約交易伴隨爆倉風險,請謹慎評估。
 */

import { useState } from 'react';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { AlertTriangle, RefreshCw, Shield } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { getUserId } from '../utils/auth';
import { useWarRoom } from '../features/warroom/useWarRoom';
import { CoinSignalCard } from '../features/warroom/components/CoinSignalCard';
import { cn } from '../utils/cn';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any).cloudflare.env;
  const userId = await getUserId(request, env);
  if (!userId) throw redirect('/login');
  return { userId };
}

const REGIME_STYLE: Record<string, { label: string; className: string }> = {
  LOW: { label: '風險偏低', className: 'bg-emerald-500 text-white' },
  MEDIUM: { label: '風險中等,建議壓低倉位', className: 'bg-amber-500 text-white' },
  HIGH: { label: '風險偏高,建議觀望', className: 'bg-rose-500 text-white' },
  CRASH: { label: '市場熔斷警戒', className: 'bg-rose-700 text-white animate-pulse' },
};

export default function WarRoomPage() {
  const [interval, setInterval] = useState('4h');
  const [marginUsdt, setMarginUsdt] = useState(100);
  const [leverage, setLeverage] = useState(3);
  const { data, loading, error, refresh } = useWarRoom(interval);

  const regimeStyle = data ? REGIME_STYLE[data.marketRegime.riskLevel] : null;

  // 排序:有明確訊號(LONG/SHORT)的排最前面,方便一眼看到「現在可以開哪個合約」
  const sortedCoins = data
    ? [...data.coins].sort((a, b) => {
        const rank = (c: typeof a) => (c.error ? 2 : c.signal === 'HOLD' || !c.signal ? 1 : 0);
        return rank(a) - rank(b);
      })
    : [];

  return (
    <AppLayout>
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1400px] mx-auto">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#141414] pb-3">
          <div className="flex items-center gap-3">
            <Shield size={22} />
            <div>
              <h1 className="text-xl font-bold font-serif leading-none">戰情室</h1>
              <p className="text-[11px] font-mono opacity-50 mt-1">
                即時合約訊號看板 — 只看不下單,實際交易請自行至交易所操作
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className="text-[10px] font-mono opacity-40">
                更新於 {new Date(data.updatedAt).toLocaleTimeString('zh-TW')}(每 60 秒自動刷新)
              </span>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono font-bold border border-[#141414] rounded-sm hover:bg-[#141414] hover:text-[#E4E3E0] disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
              刷新
            </button>
          </div>
        </header>

        {/* 大盤風控燈號 */}
        {regimeStyle && data && (
          <div className={cn('p-3 rounded-sm flex items-center gap-2 text-xs font-mono font-bold', regimeStyle.className)}>
            <AlertTriangle size={14} />
            大盤狀態(BTC):{regimeStyle.label} — {data.marketRegime.reason}
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-400 rounded-sm text-xs font-mono text-rose-600">
            載入失敗:{error}
          </div>
        )}

        {/* 控制列 */}
        <div className="bg-white/80 border border-[#141414] rounded-sm p-4 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-bold uppercase opacity-50">K 線週期</span>
            <div className="flex gap-1">
              {['1h', '4h', '1d'].map((opt) => (
                <button
                  key={opt}
                  onClick={() => setInterval(opt)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-mono border border-[#141414] rounded-sm transition-all',
                    interval === opt ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'
                  )}
                >
                  {opt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-bold uppercase opacity-50">投入保證金(USDT)</span>
            <input
              type="number"
              min={1}
              step={10}
              value={marginUsdt}
              onChange={(e) => setMarginUsdt(Math.max(1, Number(e.target.value)))}
              className="w-32 border border-[#141414] bg-white px-2 py-1.5 text-xs font-mono rounded-sm focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-bold uppercase opacity-50">槓桿倍數</span>
            <input
              type="number"
              min={1}
              max={125}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Math.min(125, Math.max(1, Number(e.target.value))))}
              className="w-24 border border-[#141414] bg-white px-2 py-1.5 text-xs font-mono rounded-sm focus:outline-none"
            />
          </label>
          {data && <span className="text-[10px] font-mono opacity-40">訊號策略:{data.strategyName}</span>}
        </div>

        {/* 幣種訊號卡片 */}
        {loading && !data ? (
          <div className="p-12 flex items-center justify-center gap-2 text-xs font-mono opacity-50">
            <RefreshCw size={14} className="animate-spin" />
            載入中...
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedCoins.map((coin) => (
              // 【詳細繁體中文註解】：key 刻意放在原生 div 上而非自訂元件 —
              // 專案未安裝 @types/react,自訂元件的 key prop 型別檢查會失敗(原生元素不受影響)。
              <div key={coin.symbol}>
                <CoinSignalCard coin={coin} marginUsdt={marginUsdt} leverage={leverage} />
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] leading-relaxed opacity-40">
          ⚠️ 爆倉價為簡化估算(逐倉模式、固定維持保證金率),實際數值請以交易所當下顯示為準;
          訊號僅依歷史技術指標產生,不保證未來獲利,合約交易具槓桿放大效果與爆倉風險,請自行評估承受能力。
          本頁面不構成投資建議,亦不會代為執行任何交易。
        </p>
      </div>
    </AppLayout>
  );
}
