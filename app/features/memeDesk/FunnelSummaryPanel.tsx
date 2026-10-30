/**
 * @component Solana 迷因幣戰情室漏斗統計與 14 關規則總覽面板。
 * 負責呈現當日 EVENING REPORT 擊殺漏斗數據與「Code kills, Gemini reads, you sign」的 14 道檢查規則。
 */
import type { MEME_DESK_CONFIG } from '../../services/memeDesk/config';
import type { MemeEveningReport } from '../../services/memeDesk/types';
import { formatKillReason } from './api';

interface FunnelSummaryPanelProps {
  report: MemeEveningReport;
  config: typeof MEME_DESK_CONFIG;
}

/** 14 道關卡說明清單（前 13 道為純程式免費硬過濾，第 14 道為 Gemini 綜合裁判） */
const FOURTEEN_CHECKS = [
  { num: 1, stage: 'FACTS', title: '未曾跑路 (Not Rugged)', rule: 'Rugcheck 未標記 rugged' },
  { num: 2, stage: 'FACTS', title: '鑄幣權限已關 (Mint Closed)', rule: 'mintAuthority === null' },
  { num: 3, stage: 'FACTS', title: '凍結權限已關 (Freeze Closed)', rule: 'freezeAuthority === null' },
  { num: 4, stage: 'FACTS', title: '零致命警告 (Zero Danger)', rule: '無任何 danger 等級風險標籤' },
  { num: 5, stage: 'FACTS', title: '風險分數合格', rule: '正規化分數 ≤ 40 / 100' },
  { num: 6, stage: 'FACTS', title: 'LP 高比例鎖倉', rule: '最大池 LP 鎖倉或燒毀 ≥ 90%' },
  { num: 7, stage: 'FACTS', title: '前十大持倉分散', rule: '排除 AMM/Locker 後 Top 10 ≤ 30%' },
  { num: 8, stage: 'FACTS', title: 'Dev 持倉極低', rule: '創建者錢包餘額 ≤ 5%' },
  { num: 9, stage: 'FACTS', title: '零老鼠倉綑綁', rule: 'Insiders 與關聯地址命中 = 0' },
  { num: 10, stage: 'POOL', title: '流動池深度充足', rule: '最大池流動性 ≥ $30,000 USD' },
  { num: 11, stage: 'POOL', title: '單筆滑價可控', rule: '$25 測試單 ≤ 流動池的 1%' },
  { num: 12, stage: 'POOL', title: '黃金生命周期', rule: '建池時間介於 30 分鐘 ～ 72 小時' },
  { num: 13, stage: 'POOL', title: '非貔貅盤驗證', rule: '排除 1h 買單 ≥ 20 卻 0 賣單' },
  { num: 14, stage: 'JUDGE', title: 'Gemini 社群與量價終審', rule: '檢查社群連結真偽、微額刷單與警告疊加 (信心 ≥ 0.7)' },
] as const;

export function FunnelSummaryPanel({ report, config }: FunnelSummaryPanelProps) {
  const pnlColor = report.realizedPnlTodayUsd > 0
    ? 'text-emerald-400'
    : report.realizedPnlTodayUsd < 0
      ? 'text-rose-400'
      : 'opacity-80';

  return (
    <div className="space-y-4">
      {/* 今日 EVENING REPORT 漏斗數據卡片 */}
      <section className="rounded-xl border border-black/15 bg-white/75 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider opacity-60">
              EVENING REPORT · {report.day} (UTC)
            </p>
            <h2 className="text-lg font-bold mt-1">
              今日 14 關防 Rug 擊殺漏斗 ({report.paperMode ? 'PAPER 模擬盤' : 'LIVE 簽署模式'})
            </h2>
          </div>
          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-3 py-1 text-xs font-semibold text-emerald-300">
            單筆固定 ${config.ticketUsd} USD · 最多 {config.maxOpenPositions} 倉 (${config.ticketUsd * config.maxOpenPositions} 上限)
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="rounded-lg border border-black/15 bg-white/80 p-3">
            <p className="text-xs opacity-65">今日總掃描</p>
            <strong className="text-2xl block mt-1">{report.checkedCount}</strong>
          </div>
          <div className="rounded-lg border border-rose-500/40 bg-white/80 p-3">
            <p className="text-xs text-rose-300">合約擊殺 (1~9關)</p>
            <strong className="text-2xl block mt-1 text-rose-400">{report.killedByFacts}</strong>
          </div>
          <div className="rounded-lg border border-amber-500/40 bg-white/80 p-3">
            <p className="text-xs text-amber-300">流動池擊殺 (10~13關)</p>
            <strong className="text-2xl block mt-1 text-amber-400">{report.killedByPool}</strong>
          </div>
          <div className="rounded-lg border border-purple-500/40 bg-white/80 p-3">
            <p className="text-xs text-purple-300">Gemini 終審擊殺 (14關)</p>
            <strong className="text-2xl block mt-1 text-purple-300">{report.killedByJudge}</strong>
          </div>
          <div className="rounded-lg border border-emerald-500/40 bg-white/80 p-3">
            <p className="text-xs text-emerald-300">通過買進 / 持倉中</p>
            <strong className="text-2xl block mt-1 text-emerald-400">
              {report.boughtCount} / {report.openNowCount}
            </strong>
          </div>
          <div className="rounded-lg border border-black/15 bg-white/80 p-3">
            <p className="text-xs opacity-65">今日已實現損益</p>
            <strong className={`text-2xl block mt-1 ${pnlColor}`}>
              {report.realizedPnlTodayUsd >= 0 ? `+$${report.realizedPnlTodayUsd.toFixed(2)}` : `-$${Math.abs(report.realizedPnlTodayUsd).toFixed(2)}`}
            </strong>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs opacity-75 pt-1 border-t border-black/10">
          <span>風控限額攔截：{report.killedByLimits} 次</span>
          <span>
            今日勝率出場：{report.greenExitsCount}/{report.totalExitsCount}
          </span>
          {report.mostCommonKill && (
            <span>
              最常見死因：<strong className="text-rose-300">{formatKillReason(report.mostCommonKill.reason)}</strong> ({report.mostCommonKill.count}x)
            </span>
          )}
          {report.bestTrade && (
            <span>
              最佳：{report.bestTrade.symbol} (${report.bestTrade.pnlUsd >= 0 ? `+${report.bestTrade.pnlUsd.toFixed(2)}` : report.bestTrade.pnlUsd.toFixed(2)})
            </span>
          )}
          {report.worstTrade && (
            <span>
              最差：{report.worstTrade.symbol} (${report.worstTrade.pnlUsd >= 0 ? `+${report.worstTrade.pnlUsd.toFixed(2)}` : report.worstTrade.pnlUsd.toFixed(2)})
            </span>
          )}
        </div>
      </section>

      {/* 14 道關卡與 5 重出場規則摺疊說明 */}
      <details className="rounded-xl border border-black/15 bg-white/60 p-4 text-sm">
        <summary className="cursor-pointer font-semibold select-none">
          查看「Code kills (1~13 關免費硬過濾) + Gemini reads (第 14 關) + 5 重出場巡檢」完整規則
        </summary>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
          {FOURTEEN_CHECKS.map(item => (
            <div key={item.num} className="rounded border border-black/10 bg-white/80 p-2.5">
              <div className="flex items-center justify-between font-semibold">
                <span>#{item.num} {item.title}</span>
                <span className="rounded border border-black/20 px-1.5 py-0.5 text-[10px] font-mono opacity-75">{item.stage}</span>
              </div>
              <p className="mt-1 opacity-75">{item.rule}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded border border-black/10 bg-white/80 p-3 text-xs space-y-1">
          <p className="font-semibold">進場前寫死的 5 重自動出場規則（每 10 分鐘巡檢）：</p>
          <p>1. <strong>抽池逃生 (liquidity_pulled)</strong>：池子流動性較進場時跌逾 {config.exit.liqDropPct}% 立即 100% 全出。</p>
          <p>2. <strong>硬停損 (stop)</strong>：帳面達 {config.exit.stopPct}% 全數停損。</p>
          <p>3. <strong>階梯停利 (ladder)</strong>：+100% 先賣 50% 收回本金、+200% 再賣 25%。</p>
          <p>4. <strong>移動停利 (trailing_stop)</strong>：完成第一階停利後，自最高價回落 {config.exit.trailPct}% 全數平倉。</p>
          <p>5. <strong>死錢時間停損 (time_stop)</strong>：滿 {config.exit.timeStopHours} 小時漲幅未達 +{config.exit.timeStopMinPct}% 直接清出格位。</p>
        </div>
      </details>
    </div>
  );
}
