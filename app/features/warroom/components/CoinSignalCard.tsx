/**
 * 【詳細繁體中文註解】：戰情室單一幣種訊號卡片
 *
 * LONG/SHORT 訊號時,依使用者輸入的保證金(USDT)與槓桿倍數,即時試算:
 * 名目倉位、預估爆倉價、若停損價會晚於爆倉價觸發則顯示警告。
 * 這些計算全部是簡單乘除,故意不透過 API 計算,調整保證金/槓桿時即時反應。
 */

import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { estimateLiquidationPrice, isStopLossPastLiquidation } from '../../../services/futuresRisk';
import { cn } from '../../../utils/cn';
import type { CoinSignal } from '../types';

interface CoinSignalCardProps {
  coin: CoinSignal;
  marginUsdt: number;
  leverage: number;
}

const formatFundingRate = (rate: number | null | undefined) => {
  if (rate == null) return '—';
  const pct = (rate * 100).toFixed(4);
  return `${rate >= 0 ? '+' : ''}${pct}%`;
};

export function CoinSignalCard({ coin, marginUsdt, leverage }: CoinSignalCardProps) {
  if (coin.error || coin.signal == null || coin.price == null) {
    return (
      <div className="p-3 border border-[#141414]/10 rounded-sm bg-white/40 opacity-50">
        <div className="text-xs font-mono font-bold">{coin.name} ({coin.symbol})</div>
        <div className="text-[10px] font-mono mt-1">{coin.error || '無法評估'}</div>
      </div>
    );
  }

  const isActionable = coin.signal === 'LONG' || coin.signal === 'SHORT';
  const notionalUsdt = marginUsdt * leverage;
  const quantity = notionalUsdt / coin.price;

  const liquidationPrice = isActionable
    ? estimateLiquidationPrice({ entryPrice: coin.price, leverage, side: coin.signal as 'LONG' | 'SHORT' })
    : 0;
  const stopLossTooLate =
    isActionable && coin.stopLossPrice != null
      ? isStopLossPastLiquidation(coin.signal as 'LONG' | 'SHORT', coin.stopLossPrice, liquidationPrice)
      : false;

  return (
    <div
      className={cn(
        'p-3 border rounded-sm flex flex-col gap-2 transition-colors',
        coin.signal === 'LONG'
          ? 'border-rose-500/50 bg-rose-500/5'
          : coin.signal === 'SHORT'
            ? 'border-emerald-500/50 bg-emerald-500/5'
            : 'border-[#141414]/10 bg-white/40'
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold font-mono">{coin.symbol}</div>
          <div className="text-[10px] font-mono opacity-50">{coin.name}</div>
        </div>
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] font-mono font-bold',
            coin.signal === 'LONG'
              ? 'bg-rose-500 text-white'
              : coin.signal === 'SHORT'
                ? 'bg-emerald-500 text-white'
                : 'bg-[#141414]/10 text-[#141414]/50'
          )}
        >
          {coin.signal === 'LONG' && <TrendingUp size={12} />}
          {coin.signal === 'SHORT' && <TrendingDown size={12} />}
          {coin.signal === 'LONG' ? '做多 LONG' : coin.signal === 'SHORT' ? '做空 SHORT' : '觀望 HOLD'}
        </div>
      </div>

      <div className="text-xs font-mono">現價 ${coin.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
      <p className="text-[10px] leading-relaxed opacity-70">{coin.reason}</p>

      <div className="text-[10px] font-mono opacity-50">
        資金費率:{formatFundingRate(coin.fundingRate)}
        {coin.fundingRate != null && (
          <span className="ml-1">{coin.fundingRate > 0 ? '(多付空)' : coin.fundingRate < 0 ? '(空付多)' : ''}</span>
        )}
      </div>

      {isActionable && (
        <div className="mt-1 pt-2 border-t border-[#141414]/10 flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
            <div>
              <span className="opacity-50">名目倉位 </span>
              <span className="font-bold">${notionalUsdt.toFixed(0)}</span>
            </div>
            <div>
              <span className="opacity-50">數量約 </span>
              <span className="font-bold">{quantity.toFixed(4)}</span>
            </div>
            <div>
              <span className="opacity-50">停損價 </span>
              <span className="font-bold text-amber-600">
                {coin.stopLossPrice != null ? `$${coin.stopLossPrice.toFixed(4)}` : '—'}
              </span>
            </div>
            <div>
              <span className="opacity-50">估算爆倉價 </span>
              <span className="font-bold text-rose-600">${liquidationPrice.toFixed(4)}</span>
            </div>
          </div>
          <div className="text-[10px] font-mono opacity-50">最大虧損約 {marginUsdt} USDT(未計手續費/資金費率)</div>
          <div className="text-[9px] leading-relaxed opacity-60 italic">離場時機:{coin.exitHint}</div>

          {stopLossTooLate && (
            <div className="flex items-start gap-1 mt-1 p-1.5 bg-rose-500/10 border border-rose-500/40 rounded-sm">
              <AlertTriangle size={12} className="text-rose-600 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] leading-relaxed text-rose-700">
                目前槓桿倍數過高:估算爆倉價已經比策略停損價更早觸及,實際上會先爆倉、停損形同虛設,建議降低槓桿或增加保證金。
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
