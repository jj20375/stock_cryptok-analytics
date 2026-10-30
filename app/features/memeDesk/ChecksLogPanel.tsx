/**
 * @component Solana 迷因幣 14 關審查與擊殺日誌面板（對應原文 checks.csv）。
 * 預設強調「READ THE KILLS, NOT THE BUYS」：清楚列出每顆代幣死在哪一關，並支援展開檢視 Rugcheck 9 項、DexScreener 4 項與 Gemini 第 14 關完整 JSON 指標。
 */
import { useState } from 'react';
import type { MemeCheckResult } from '../../services/memeDesk/types';
import { formatKillReason } from './api';

interface ChecksLogPanelProps {
  checks: MemeCheckResult[];
}

function formatTimeShort(ms: number): string {
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

export function ChecksLogPanel({ checks }: ChecksLogPanelProps) {
  /**
   * 篩選器狀態：預設顯示全部（all），亦可只看通過買進（BUY）或死於特定階段（facts / pool / judge）。
   * 為什麼需要此狀態：原文強調「Read the kills, not the buys」，使用者需快速檢視哪一道規則砍掉最多代幣。
   */
  const [stageFilter, setStageFilter] = useState<'all' | 'BUY' | 'facts' | 'pool' | 'judge'>('all');

  const filtered = checks.filter(item => {
    if (stageFilter === 'all') return true;
    if (stageFilter === 'BUY') return item.verdict === 'BUY';
    return item.stage === stageFilter;
  });

  return (
    <section className="rounded-xl border border-black/15 bg-white/75 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-base">最近 14 關審查與擊殺紀錄 (checks.csv)</h3>
          <p className="text-xs opacity-65">點擊任一列可展開 Rugcheck 合約數據、DexScreener 流動池與 Gemini 終審報告</p>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {[
            ['all', `全部 (${checks.length})`],
            ['BUY', `BUY 放行 (${checks.filter(c => c.verdict === 'BUY').length})`],
            ['facts', `合約擊殺 (${checks.filter(c => c.stage === 'facts').length})`],
            ['pool', `流動池擊殺 (${checks.filter(c => c.stage === 'pool').length})`],
            ['judge', `Gemini 終審 (${checks.filter(c => c.stage === 'judge').length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStageFilter(key as any)}
              className={`rounded-full border px-3 py-1 transition-colors ${
                stageFilter === key
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200 font-semibold'
                  : 'bg-white/70 border-black/20 opacity-80 hover:opacity-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 p-8 text-center text-sm opacity-65">
          尚無符合篩選條件的審查紀錄。請點擊上方「⚡ 掃描 Bitget 已上架代幣 (每次 5 檔)」或輸入 Bitget 幣種代號（如 WIF、BONK）。
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const isBuy = item.verdict === 'BUY';
            const badgeClass = isBuy
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : item.stage === 'judge'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                : item.stage === 'pool'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40';

            return (
              <details
                key={item.id}
                className="rounded-lg border border-black/15 bg-white p-3 text-xs group"
              >
                <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 font-mono font-bold text-[11px] ${badgeClass}`}>
                      {item.verdict} · {item.stage.toUpperCase()}
                    </span>
                    <strong className="text-sm">{item.symbol}</strong>
                    {item.bitgetSymbol && (
                      <span className="rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        Bitget: {item.bitgetSymbol}
                      </span>
                    )}
                    <span className="font-mono text-[11px] opacity-60">
                      {item.mint.slice(0, 6)}…{item.mint.slice(-4)}
                    </span>
                    {item.confidence !== null && (
                      <span className="rounded border border-black/20 px-1.5 py-0.5 font-mono opacity-80">
                        信心度 {(item.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="font-medium opacity-90">
                      — {formatKillReason(item.reason)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono text-[11px] opacity-70">
                    {item.liquidityUsd !== null && (
                      <span>池深 ${Math.round(item.liquidityUsd).toLocaleString()}</span>
                    )}
                    <span>{formatTimeShort(item.checkedAt)}</span>
                  </div>
                </summary>

                {/* 展開後的詳細 14 關數據 */}
                <div className="mt-3 pt-3 border-t border-black/10 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* 第 1~9 關：Rugcheck 合約數據 */}
                  <div className="rounded border border-black/15 bg-white/80 p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-emerald-300">1. 合約安全 (Rugcheck 1~9 關)</p>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(item.mint)}
                        className="rounded border border-black/25 px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                        title="複製完整 Solana 合約地址，可貼至 Bitget Onchain 或錢包搜尋"
                      >
                        📋 複製 CA
                      </button>
                    </div>
                    <p className="font-mono text-[11px] break-all opacity-65">CA: {item.mint}</p>
                    {item.facts ? (
                      <>
                        <p>風險分數：<strong>{item.facts.riskScore ?? 'N/A'}</strong> / 100 (上限 40)</p>
                        <p>Mint / Freeze 權限：{item.facts.mintAuthority ? '❌ 未關' : '✅ 已關'} / {item.facts.freezeAuthority ? '❌ 未關' : '✅ 已關'}</p>
                        <p>LP 鎖倉比例：<strong>{item.facts.lpLockedPct ?? 'N/A'}%</strong> (門檻 ≥ 90%)</p>
                        <p>Top 10 真實持倉：<strong>{item.facts.top10Pct ?? 'N/A'}%</strong> (上限 ≤ 30%)</p>
                        <p>Dev 錢包持倉：<strong>{item.facts.devPct ?? 'N/A'}%</strong> (上限 ≤ 5%)</p>
                        <p>老鼠倉 Insiders：<strong>{item.facts.insiders}</strong> (上限 0)</p>
                        {item.facts.warnFlags.length > 0 && (
                          <p className="text-amber-300">次級警告：{item.facts.warnFlags.join(', ')}</p>
                        )}
                      </>
                    ) : (
                      <p className="opacity-60">未通過前置關卡或無合約報告</p>
                    )}
                  </div>

                  {/* 第 10~13 關：DexScreener 流動池數據 */}
                  <div className="rounded border border-black/15 bg-white/80 p-2.5 space-y-1">
                    <p className="font-semibold text-amber-300">2. 流動池與量價 (DexScreener 10~13 關)</p>
                    {item.pool ? (
                      <>
                        <p>現價：<strong>${item.pool.priceUsd}</strong></p>
                        <p>最大池流動性：<strong>${Math.round(item.pool.liquidityUsd).toLocaleString()}</strong> (門檻 ≥ $30k)</p>
                        <p>建池時間：<strong>{item.pool.ageMin ?? 'N/A'} 分鐘</strong> (30m ~ 4320m)</p>
                        <p>近 1h 買 / 賣筆數：<strong>{item.pool.buys1h} 買 / {item.pool.sells1h} 賣</strong></p>
                        <p>近 1h 成交量 / 均單：<strong>${Math.round(item.pool.volume1hUsd).toLocaleString()}</strong> (均單 ${item.pool.avgTrade1hUsd ?? 'N/A'})</p>
                        <p>社群連結：{item.pool.socials.length > 0 ? item.pool.socials.map(s => s.type).join(', ') : '無社群連結'} ｜ Boost: {item.pool.boostsActive}</p>
                        <div className="flex flex-wrap gap-3 pt-1">
                          {item.bitgetSymbol && (
                            <a
                              href={`https://www.bitget.com/zh-TW/spot/${item.bitgetSymbol}`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline text-cyan-300 font-semibold"
                            >
                              前往 Bitget 交易 ({item.bitgetSymbol}) ↗
                            </a>
                          )}
                          {item.pool.pairUrl && (
                            <a href={item.pool.pairUrl} target="_blank" rel="noreferrer" className="underline text-emerald-300">
                              開啟 DexScreener 線圖 ↗
                            </a>
                          )}
                        </div>
                      </>
                    ) : item.stage === 'pool' ? (
                      <p className="opacity-70">
                        DexScreener 查無活躍外盤交易池（可能仍處於 Pump.fun 內盤尚未畢業，或流動性為 $0）
                      </p>
                    ) : (
                      <p className="opacity-60">於合約關卡即被淘汰，未查詢池子</p>
                    )}
                  </div>

                  {/* 第 14 關：Gemini 終審報告 */}
                  <div className="rounded border border-black/15 bg-white/80 p-2.5 space-y-1">
                    <p className="font-semibold text-purple-300">3. Gemini AI 第 14 關終審</p>
                    {item.judge ? (
                      <>
                        <p>裁決：<strong>{item.judge.verdict}</strong> (信心度 {(item.judge.confidence * 100).toFixed(0)}%)</p>
                        <p>理由：{item.judge.why}</p>
                        <p>社群與量價判讀：{item.judge.xRead}</p>
                        <p className="text-rose-300">主要風險：{item.judge.mainRisk}</p>
                      </>
                    ) : (
                      <p className="opacity-60">死於前 13 道硬指標，已省下 AI Token 費用 ($0)</p>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
