/**
 * @component Solana 迷因幣戰情室持倉巡檢與歷史交易帳本面板。
 * 顯示目前場內模擬持倉（含抽池幅度、階梯停利階段、移動停利基準與手動平倉按鈕）以及最近 30 筆開平倉紀錄。
 */
import type { MemeOpenPositionView } from '../../services/memeDesk/types';

interface TradeRow {
  id: string;
  createdAt: number;
  mint: string;
  symbol: string;
  action: string;
  usd: number;
  price: number;
  pnl: number;
  reason: string;
}

interface PositionsAndTradesPanelProps {
  openPositions: MemeOpenPositionView[];
  recentTrades: TradeRow[];
  busyAction: string | null;
  onWatchPositions: () => void;
  onClosePosition: (mint: string, fallbackPrice: number) => void;
}

function formatDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '-';
  }
}

export function PositionsAndTradesPanel({
  openPositions,
  recentTrades,
  busyAction,
  onWatchPositions,
  onClosePosition,
}: PositionsAndTradesPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 左側：當前模擬持倉與 5 重出場巡檢 */}
      <section className="rounded-xl border border-black/15 bg-white/75 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-base">當前模擬持倉 ({openPositions.length} / 4)</h3>
            <p className="text-xs opacity-65">每 10 分鐘自動巡檢抽池、停損、階梯停利與時間停損</p>
          </div>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={onWatchPositions}
            className="rounded border border-black/25 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/5 disabled:opacity-50"
          >
            {busyAction === 'watch' ? '巡檢中…' : '立即巡檢持倉 (watch.py)'}
          </button>
        </div>

        {openPositions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/15 p-6 text-center text-xs opacity-65">
            目前場內無持倉。當代幣通過全部 14 關且 Gemini 裁決為 BUY 時，將自動建立 $25 模擬倉位。
          </div>
        ) : (
          <div className="space-y-2.5">
            {openPositions.map(pos => {
              const pctClass = pos.unrealizedPct >= 0 ? 'text-emerald-700' : 'text-rose-700';
              const liqClass = pos.liquidityChangePct <= -25 ? 'text-rose-700 font-semibold' : 'opacity-75';

              return (
                <div key={pos.mint} className="rounded-lg border border-black/15 bg-white p-3 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm">{pos.symbol}</strong>
                      {pos.bitgetSymbol && (
                        <a
                          href={`https://www.bitget.com/zh-TW/spot/${pos.bitgetSymbol}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold hover:bg-cyan-500/30"
                        >
                          Bitget: {pos.bitgetSymbol} ↗
                        </a>
                      )}
                      <span className="font-mono text-[11px] opacity-60">{pos.mint.slice(0, 6)}…{pos.mint.slice(-4)}</span>
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px]">
                        階梯階段 Step {pos.steps}/2
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {pos.pairUrl && (
                        <a
                          href={pos.pairUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline opacity-75 hover:opacity-100"
                        >
                          DexScreener
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => onClosePosition(pos.mint, pos.lastPrice)}
                        className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                      >
                        手動平倉
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-black/10">
                    <div>
                      <span className="opacity-60 block">進場 / 現價</span>
                      <span className="font-mono">${pos.entryPrice.toPrecision(4)} → ${pos.lastPrice.toPrecision(4)}</span>
                    </div>
                    <div>
                      <span className="opacity-60 block">未實現報酬</span>
                      <strong className={pctClass}>
                        {pos.unrealizedPct >= 0 ? `+${pos.unrealizedPct.toFixed(1)}%` : `${pos.unrealizedPct.toFixed(1)}%`}
                        {' '}({pos.unrealizedPnlUsd >= 0 ? `+$${pos.unrealizedPnlUsd.toFixed(2)}` : `-$${Math.abs(pos.unrealizedPnlUsd).toFixed(2)}`})
                      </strong>
                    </div>
                    <div>
                      <span className="opacity-60 block">池深變化 (閾值 -40%)</span>
                      <span className={liqClass}>
                        ${Math.round(pos.lastLiquidityUsd).toLocaleString()} ({pos.liquidityChangePct >= 0 ? `+${pos.liquidityChangePct.toFixed(1)}%` : `${pos.liquidityChangePct.toFixed(1)}%`})
                      </span>
                    </div>
                    <div>
                      <span className="opacity-60 block">已持倉時間 (上限 6h)</span>
                      <span>{pos.heldHours.toFixed(1)} 小時</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 右側：歷史進出場與分批停利帳本 */}
      <section className="rounded-xl border border-black/15 bg-white/75 p-4 space-y-3">
        <div>
          <h3 className="font-bold text-base">交易與分批停利帳本 (trades.csv)</h3>
          <p className="text-xs opacity-65">記錄每次開倉、+100%/+200% 階梯減倉與停損出場</p>
        </div>

        {recentTrades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/15 p-6 text-center text-xs opacity-65">
            尚無模擬交易紀錄。
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {recentTrades.map(trade => {
              const isCloseOrPartial = trade.action !== 'open';
              const pnlText = trade.pnl >= 0 ? `+$${trade.pnl.toFixed(2)}` : `-$${Math.abs(trade.pnl).toFixed(2)}`;
              const pnlColor = trade.pnl > 0 ? 'text-emerald-700' : trade.pnl < 0 ? 'text-rose-700' : 'opacity-70';

              return (
                <div
                  key={trade.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-black/10 bg-white px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                      trade.action === 'open'
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : trade.action === 'partial'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-neutral-100 text-neutral-800 border border-neutral-300'
                    }`}>
                      {trade.action}
                    </span>
                    <strong>{trade.symbol}</strong>
                    <span className="opacity-65">({trade.reason})</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span>${trade.usd.toFixed(2)}</span>
                    {isCloseOrPartial && (
                      <strong className={pnlColor}>{pnlText}</strong>
                    )}
                    <span className="text-[11px] opacity-55">{formatDateTime(trade.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
