/**
 * @component 首頁與美股雷達頁專用「市場漲跌走勢羅盤」面板
 * 【詳細繁體中文註解】：
 * 依據使用者當前切換的市場（US 美股 / TW 台股 / CRYPTO 幣圈），
 * 自動切換為對應市場的專屬漲跌研判模型：
 * - 美股頁面 (US)：專注分析「美股是否會漲」，匯率只看美元 DXY 對美股跨國企業獲利與華爾街資金的影響，
 *   並提高那指/標普期貨 (NQ/ES) 與 VIX 的權重，絕不與台股匯率混雜或產生圖文矛盾。
 * - 台股頁面 (TW)：專注分析「台股是否會漲」，納入新台幣匯率 (USD/TWD) 判讀外資匯入買超或提款壓力。
 */
import { Compass, HelpCircle, RefreshCw, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../../utils/cn';
import type { MacroPillarAnalysis, MacroSignalDirection } from '../../../services/macroService';
import type { MarketKey } from '../types';
import { useMacroIndicators } from '../use-macro-indicators';
import { MacroCompassFreshness } from './MacroCompassFreshness';

interface MacroMarketCompassProps {
  /** 目前選取的市場（US / TW / CRYPTO），用來切換對應市場的漲跌分析模型 */
  market: MarketKey;
}

/** 依據多空方向回傳對應的配色樣式 */
function getSignalBadgeStyle(signal: MacroSignalDirection): string {
  if (signal === 'BULLISH') {
    return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  }
  if (signal === 'BEARISH') {
    return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
  }
  return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
}

/** 依據多空方向回傳卡片邊框強調色 */
function getCardBorderStyle(signal: MacroSignalDirection, dataUnavailable?: boolean): string {
  if (dataUnavailable) {
    return 'border-dashed border-amber-500/40 bg-amber-950/10';
  }
  if (signal === 'BULLISH') {
    return 'border-emerald-500/30 bg-emerald-950/10';
  }
  if (signal === 'BEARISH') {
    return 'border-rose-500/30 bg-rose-950/10';
  }
  return 'border-[#E4E3E0]/15 bg-white/[0.03]';
}

/** 單一宏觀維度卡片（美債 / 美元或台幣匯率 / 美股期貨 / 債券利差與 VIX） */
function PillarCard({ pillar }: { pillar: MacroPillarAnalysis }) {
  return (
    <div
      className={cn(
        'rounded-sm border p-3.5 flex flex-col justify-between transition-all',
        getCardBorderStyle(pillar.signal, pillar.dataUnavailable)
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] font-bold tracking-wide text-[#E4E3E0]/90">
            {pillar.title}
          </span>
          <span
            className={cn(
              'px-2 py-0.5 text-[10px] font-mono font-bold rounded-sm border whitespace-nowrap',
              getSignalBadgeStyle(pillar.signal)
            )}
          >
            {pillar.signalLabel}
          </span>
        </div>

        <div className="text-base md:text-lg font-mono font-bold text-white tracking-tight">
          {pillar.primaryMetric}
        </div>
        <div className="text-[11px] font-mono text-[#E4E3E0]/60 mt-0.5">
          {pillar.secondaryMetric}
        </div>
      </div>

      <p className="mt-2.5 pt-2 border-t border-[#E4E3E0]/10 text-xs leading-relaxed text-[#E4E3E0]/80">
        {pillar.explanation}
      </p>
    </div>
  );
}

export function MacroMarketCompass({ market }: MacroMarketCompassProps) {
  // 讀取與每 5 分鐘自動更新邏輯見 use-macro-indicators.ts
  const { macro, loading, error, fetchMacro } = useMacroIndicators();

  // 取得當前選定市場（US 美股 / TW 台股 / CRYPTO 幣圈）的專屬分析視角
  const activeView = macro?.marketViews?.[market];
  const outlook = activeView?.outlook ?? macro?.marketOutlook;
  const activePillars = activeView?.pillars ?? macro?.pillars;
  const compassTitle =
    activeView?.compassTitle ??
    (market === 'US'
      ? '🇺🇸 美股漲跌走勢羅盤 · 美債 / 美元 / 美股期貨 / 債券與 VIX'
      : market === 'TW'
      ? '🇹🇼 台股漲跌走勢羅盤 · 美債 / 新台幣匯率 / 期貨夜盤連動 / 恐慌利差'
      : '🪙 幣圈宏觀走勢羅盤 · 美債 / 美元 DXY / 那指期貨連動 / 恐慌情緒');

  const marketLabel = market === 'US' ? '美股' : market === 'TW' ? '台股' : '幣圈';

  const pillars = activePillars
    ? [
        activePillars.treasury,
        activePillars.fx,
        activePillars.futures,
        activePillars.bondSpreadAndVix,
      ]
    : [];

  return (
    <section
      aria-label={`${marketLabel}漲跌走勢羅盤`}
      className="bg-[#141414] text-[#E4E3E0] p-4 md:p-5 rounded-sm border border-[#141414] shadow-sm"
    >
      {/* 頂部標題列與專屬市場漲跌燈號 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#E4E3E0]/15 pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
          <h2 className="font-serif italic text-sm md:text-base tracking-wider">
            {compassTitle}
          </h2>
          {outlook && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-mono font-bold border',
                getSignalBadgeStyle(outlook.direction)
              )}
            >
              {outlook.direction === 'BULLISH' && <TrendingUp className="w-3.5 h-3.5" />}
              {outlook.direction === 'BEARISH' && <TrendingDown className="w-3.5 h-3.5" />}
              {outlook.direction === 'NEUTRAL' && <ShieldAlert className="w-3.5 h-3.5" />}
              {outlook.label} ({outlook.score >= 0 ? `+${outlook.score}` : outlook.score}分)
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 self-end md:self-auto">
          {outlook && (
            <div className="text-[11px] font-mono text-[#E4E3E0]/70 hidden sm:flex items-center gap-2">
              <span className="text-emerald-400">看漲 {outlook.bullishCount}</span>
              <span>/</span>
              <span className="text-amber-300">中性 {outlook.neutralCount}</span>
              <span>/</span>
              <span className="text-rose-400">看跌 {outlook.bearishCount}</span>
              {outlook.unavailableCount > 0 && (
                <>
                  <span>/</span>
                  <span className="text-amber-500">暫缺 {outlook.unavailableCount}</span>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => fetchMacro(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-[#E4E3E0]/25 rounded-sm hover:bg-[#E4E3E0] hover:text-[#141414] transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            {loading ? '同步中...' : '更新風向'}
          </button>
        </div>
      </div>

      {/* 判讀時間與各報價最後更新時間，避免拿過時判讀操作 */}
      {macro && <MacroCompassFreshness macro={macro} />}

      {/* 載入中或錯誤狀態 */}
      {loading && !macro ? (
        <div className="py-6 text-center text-xs font-mono text-[#E4E3E0]/60 animate-pulse">
          正在分析{marketLabel}漲跌風向（美債 10Y、匯率、那指/標普期貨、債券利差與 VIX）...
        </div>
      ) : error && !macro ? (
        <div className="mt-3 p-3 rounded-sm border border-rose-500/30 bg-rose-950/20 text-xs text-rose-300 flex items-center justify-between">
          <span>⚠️ {error}（不影響下方選股與 K 線功能）</span>
          <button
            type="button"
            onClick={() => fetchMacro(true)}
            className="underline font-mono hover:text-white"
          >
            重試
          </button>
        </div>
      ) : (
        macro &&
        outlook && (
          <>
            {/* 專屬市場漲跌研判與操作建議橫幅 */}
            <div className="mt-3 p-3 rounded-sm bg-white/[0.04] border border-[#E4E3E0]/10 space-y-1.5">
              <div className="text-xs md:text-sm font-medium text-white leading-relaxed">
                <span className="font-mono text-cyan-300 mr-1.5">
                  [{marketLabel}漲跌研判]
                </span>
                {outlook.summary}
              </div>
              <div className="text-xs text-emerald-300 font-medium leading-relaxed pt-1 border-t border-[#E4E3E0]/10">
                🎯 {marketLabel}操作策略建議：{outlook.actionHint || outlook.usMarketHint}
              </div>
            </div>

            {/* 四大維度卡片網格 */}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {pillars.map((pillar) => (
                <PillarCard key={pillar.key} pillar={pillar} />
              ))}
            </div>

            {/* 可展開的「美債・匯率・期貨・債券」影響原理速查抽屜 */}
            <details className="mt-3 pt-2 border-t border-[#E4E3E0]/10 text-xs text-[#E4E3E0]/75 group">
              <summary className="cursor-pointer select-none inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 hover:underline">
                <HelpCircle className="w-3.5 h-3.5" />
                如何透過「美債、匯率、期貨、債券利差」判斷{marketLabel}是否會漲？（點擊展開速查指南）
              </summary>
              <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-2.5 p-3 rounded-sm bg-black/40 border border-[#E4E3E0]/10 text-[11px] leading-relaxed">
                <div>
                  <strong className="text-white">1. 美債殖利率 (10Y 科技股估值錨)：</strong>
                  債券價格與殖利率反向。當 <span className="text-rose-300">10Y 殖利率攀升或高於 4.5%</span>，無風險利息高，資金抽離股市，壓抑 AI 與科技股估值（<span className="text-rose-300">看跌/中性</span>）；殖利率顯著回落 10MA 下方則為<span className="text-emerald-300">看漲利多</span>。
                </div>
                <div>
                  <strong className="text-white">
                    {market === 'TW' ? '2. 匯率 (新台幣 & 美元外資流向)：' : '2. 美元指數 (DXY 華爾街資金與跨國營收)：'}
                  </strong>
                  {market === 'TW' ? (
                    <>
                      外資買台股須先換台幣。當<span className="text-emerald-300">台幣升值（低於 10MA）且美元走弱</span>，代表外資熱錢匯入買超台股（<span className="text-emerald-300">看漲</span>）；若<span className="text-rose-300">美元走弱、台幣卻逆勢貶值</span>（偏離 10MA 0.15% 以上），代表外資針對台股提款（<span className="text-rose-300">看跌</span>）。
                    </>
                  ) : (
                    <>
                      當<span className="text-emerald-300">美元指數 (DXY) 走弱低於 10MA</span>，美股科技巨頭（NVDA、AAPL、MSFT）海外營收換回美元獲利增加且市場資金充沛（<span className="text-emerald-300">看漲</span>）；美元強勢飆升則造成匯損與資金收緊（<span className="text-rose-300">看跌</span>）。
                    </>
                  )}
                </div>
                <div>
                  <strong className="text-white">3. 美股期貨 (那指 NQ & 標普 ES 先行盤)：</strong>
                  期貨 24 小時交易，是當日{marketLabel}最直接的先行風向。當那指期貨<span className="text-emerald-300">站上 10MA 且日內走揚</span>，代表華爾街主力正在買進（<span className="text-emerald-300">看漲</span>）；若期貨重挫跌破 10MA，現貨開盤極易承壓回檔（<span className="text-rose-300">看跌</span>）。
                </div>
                <div>
                  <strong className="text-white">4. 債券長短利差 (10Y-3M) & VIX 恐慌：</strong>
                  當 <span className="text-emerald-300">VIX &lt; 18 且低於 10MA</span>、同時長短債利差為正，代表市場風險偏好強（<span className="text-emerald-300">看漲</span>）；VIX 即使仍在低檔，只要<span className="text-amber-300">站上 10MA 或單日跳升 5% 以上</span>即視為避險升溫（中性）；VIX 高檔突破則為<span className="text-rose-300">看跌</span>。
                </div>
              </div>
            </details>
          </>
        )
      )}
    </section>
  );
}
