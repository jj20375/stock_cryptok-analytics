/**
 * @file Solana 迷因幣 14 關防 Rug 戰情室頁面（RUG DESK）。
 * 整合 @0xboan「Code kills, AI reads, you sign」架構，以 Rugcheck + DexScreener 前 13 關免費硬過濾結合第 14 關 Gemini 裁判，
 * 並內建 $25 固定模擬倉位與 5 重出場巡檢。
 */
import { useState, type FormEvent } from 'react';
import { redirect, useLoaderData, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import {
  formatKillReason,
  requestCheckSolanaMint,
  requestManualClosePosition,
  requestScanFreshTokens,
  requestWatchPositions,
} from '../features/memeDesk/api';
import { ChecksLogPanel } from '../features/memeDesk/ChecksLogPanel';
import { FunnelSummaryPanel } from '../features/memeDesk/FunnelSummaryPanel';
import { PositionsAndTradesPanel } from '../features/memeDesk/PositionsAndTradesPanel';
import { loadMemeDeskDashboard, type MemeDeskEnv } from '../services/memeDesk/deskRunner';
import type { MemeCheckResult } from '../services/memeDesk/types';
import { getUserId } from '../utils/auth';

export function meta() {
  return [{ title: 'Solana 防 Rug 戰情室 (Meme Desk)' }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: MemeDeskEnv } }).cloudflare.env;
  if (!await getUserId(request, env as Record<string, any>)) {
    throw redirect('/login');
  }
  return loadMemeDeskDashboard(env);
}

export default function MemeDeskPage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  /**
   * 手動輸入的 Solana 合約地址（Mint Address / CA）。
   * 為什麼需要此狀態：對應原文 `python check.py <CA>`，讓使用者貼上任何群組或推文看到的 CA 即可一鍵跑完 14 關。
   */
  const [mintInput, setMintInput] = useState('');

  /**
   * 單幣檢測時是否略過本地持倉上限（bypassLimits）。
   * 為什麼需要此狀態：當場內已滿 4 倉或同幣剛檢測過時，使用者若純粹想診斷某顆新幣的合約與池子，可勾選略過風控槽限制。
   */
  const [bypassLimits, setBypassLimits] = useState(false);

  /**
   * 追蹤目前進行中的非同步操作名稱（'check' | 'scan' | 'watch' | 'close' | null），防止重複點擊送出。
   */
  const [busyAction, setBusyAction] = useState<string | null>(null);

  /**
   * 顯示最近一次手動操作（單幣檢測、批次掃描或持倉巡檢）的即時回饋訊息與錯誤提示。
   */
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [latestSingleResult, setLatestSingleResult] = useState<MemeCheckResult | null>(null);

  const handleCheckMint = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = mintInput.trim();
    if (!trimmed) return;

    setBusyAction('check');
    setErrorMessage(null);
    setBannerMessage(null);
    try {
      const result = await requestCheckSolanaMint(trimmed, bypassLimits);
      setLatestSingleResult(result);
      setBannerMessage(
        `已完成 ${result.symbol} (${result.mint.slice(0, 6)}…) 審查：裁決 ${result.verdict}（階段：${result.stage.toUpperCase()} — ${formatKillReason(result.reason)}）`,
      );
      revalidator.revalidate();
    } catch (error: any) {
      setErrorMessage(error?.message || '單幣審查失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const handleScanFresh = async () => {
    setBusyAction('scan');
    setErrorMessage(null);
    setBannerMessage(null);
    try {
      const existingMints = data.recentChecks.map(item => item.mint);
      const results = await requestScanFreshTokens(existingMints);
      const buyCount = results.filter(r => r.verdict === 'BUY').length;
      const scannedSymbols = results.map(r => r.bitgetSymbol || r.symbol).join('、');
      setBannerMessage(
        `已掃描 ${results.length} 檔 Bitget 已上架代幣（${scannedSymbols}）：通過買進 ${buyCount} 檔、淘汰 ${results.length - buyCount} 檔。`,
      );
      revalidator.revalidate();
    } catch (error: any) {
      setErrorMessage(error?.message || '批次掃描失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const handleWatchPositions = async () => {
    setBusyAction('watch');
    setErrorMessage(null);
    setBannerMessage(null);
    try {
      const events = await requestWatchPositions();
      setBannerMessage(
        events.length > 0
          ? `持倉巡檢觸發 ${events.length} 筆動作：${events.join(' ｜ ')}`
          : '已完成持倉巡檢：目前所有部位皆未觸發停損、停利或抽池警報。',
      );
      revalidator.revalidate();
    } catch (error: any) {
      setErrorMessage(error?.message || '持倉巡檢失敗');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClosePosition = async (mint: string, fallbackPrice: number) => {
    setBusyAction('close');
    setErrorMessage(null);
    setBannerMessage(null);
    try {
      await requestManualClosePosition(mint, fallbackPrice);
      setBannerMessage(`已手動平倉 ${mint.slice(0, 6)}…`);
      revalidator.revalidate();
    } catch (error: any) {
      setErrorMessage(error?.message || '手動平倉失敗');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
        {/* 頁首與核心理念標語 */}
        <header className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <p className="text-xs tracking-widest opacity-60 mb-1">BITGET SOLANA MEME RUG DESK</p>
            <h1 className="text-3xl font-bold">Bitget 已上架迷因幣 14 關戰情室</h1>
            <p className="text-sm mt-2 opacity-75">
              僅掃描 Bitget 交易所已上架之 Solana 代幣 · 前 13 關合約與池深免費硬過濾 · 第 14 關 Gemini 量價終審
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleScanFresh}
              className="rounded-lg bg-[#141414] text-white px-4 py-2.5 font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {busyAction === 'scan' ? '正在掃描 5 檔 Bitget 代幣…' : '⚡ 掃描 Bitget 已上架代幣 (每次 5 檔)'}
            </button>
            <button
              type="button"
              disabled={revalidator.state !== 'idle' || busyAction !== null}
              onClick={() => revalidator.revalidate()}
              className="rounded-lg border border-black/25 bg-white/80 px-3.5 py-2.5 font-semibold hover:bg-black/5 disabled:opacity-50"
            >
              {revalidator.state === 'idle' ? '重新整理' : '讀取中…'}
            </button>
          </div>
        </header>

        {/* 手動輸入 Bitget 幣種代號或 Solana CA 單幣診斷器 */}
        <section className="rounded-xl border border-black/15 bg-white/80 p-4 space-y-3">
          <form onSubmit={handleCheckMint} className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <div className="flex-1">
              <label htmlFor="solana-mint-input" className="sr-only">Bitget 幣種代號或 Solana 合約地址</label>
              <input
                id="solana-mint-input"
                type="text"
                value={mintInput}
                onChange={e => setMintInput(e.target.value)}
                placeholder="輸入 Bitget 幣種代號（如 WIF、BONK、POPCAT、PNUT、TRUMP）或貼上已上架 Bitget 的 Solana 合約地址…"
                className="w-full rounded-lg border border-black/20 bg-white px-3.5 py-2 text-sm font-mono focus:outline-none focus:border-black"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs opacity-80 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={bypassLimits}
                onChange={e => setBypassLimits(e.target.checked)}
              />
              略過持倉上限與冷卻僅做診斷
            </label>
            <button
              type="submit"
              disabled={busyAction !== null || !mintInput.trim()}
              className="rounded-lg border border-emerald-700 bg-emerald-600 text-white px-5 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyAction === 'check' ? '14 關審查中…' : '執行 14 關審查'}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="opacity-65">Bitget 熱門一鍵點選：</span>
            {['BONK', 'WIF', 'POPCAT', 'PNUT', 'PENGU', 'TRUMP', 'FARTCOIN', 'MEW', 'BOME', 'MOODENG', 'AI16Z', 'JUP'].map(coin => (
              <button
                key={coin}
                type="button"
                onClick={() => setMintInput(coin)}
                className="rounded border border-black/20 bg-white/70 px-2 py-0.5 font-mono hover:border-cyan-400 hover:text-cyan-300"
              >
                {coin}USDT
              </button>
            ))}
          </div>

          {errorMessage && (
            <div role="alert" className="rounded-lg border border-rose-500/40 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              ❌ {errorMessage}
            </div>
          )}
          {bannerMessage && (
            <div role="status" className="rounded-lg border border-emerald-500/40 bg-white/80 px-3.5 py-2.5 text-xs text-emerald-300">
              ✅ {bannerMessage}
            </div>
          )}
          {latestSingleResult && (
            <div className="rounded-lg border border-black/15 bg-black/[0.02] p-3 text-xs space-y-1 font-mono">
              <p className="font-sans font-semibold">
                最新單幣診斷結果：{latestSingleResult.symbol} ({latestSingleResult.mint}) → {latestSingleResult.verdict}
              </p>
              <p>攔截／通過階段：{latestSingleResult.stage.toUpperCase()} ｜ 原因：{formatKillReason(latestSingleResult.reason)}</p>
              {latestSingleResult.actionText && <p className="text-emerald-800 font-semibold">{latestSingleResult.actionText}</p>}
            </div>
          )}
        </section>

        {/* 當日擊殺漏斗與 14 關規則說明 */}
        <FunnelSummaryPanel report={data.report} config={data.config} />

        {/* 模擬持倉巡檢與交易帳本 */}
        <PositionsAndTradesPanel
          openPositions={data.openPositions}
          recentTrades={data.recentTrades}
          busyAction={busyAction}
          onWatchPositions={handleWatchPositions}
          onClosePosition={handleClosePosition}
        />

        {/* 14 關審查與擊殺日誌 */}
        <ChecksLogPanel checks={data.recentChecks} />
      </div>
    </AppLayout>
  );
}
