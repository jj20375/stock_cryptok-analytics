/** @component 羅盤可展開的指標原理指南；說明各市場差異與油價觀察限制，無資料請求或寫入副作用。 */
import { HelpCircle } from 'lucide-react';
import type { MarketKey } from '../types';

export function MacroCompassGuide({ market, marketLabel }: { market: MarketKey; marketLabel: string }) {
  return (
    <details className="mt-3 pt-2 border-t border-[#E4E3E0]/10 text-xs text-[#E4E3E0]/75 group">
      <summary className="cursor-pointer select-none inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 hover:underline">
        <HelpCircle className="w-3.5 h-3.5" />
        如何透過「美債、匯率、期貨、債券利差{market !== 'CRYPTO' ? '、油價' : ''}」判斷{marketLabel}是否會漲？（點擊展開速查指南）
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
          <strong className="text-white">4. 債券長短利差 (10Y-3M) & VIX 多空轉折時機：</strong>
          當 <span className="text-emerald-300">VIX &lt; 18 且低於 10MA</span> 為順勢偏多；當 <span className="text-rose-300">VIX 站上 10MA (&ge; 19.5) 且期貨破線</span>，代表避險加碼，為<strong>反彈做空時機</strong>；而當 <span className="text-emerald-300">VIX 衝高 (&ge; 22) 後開始單日回落、且期貨/TSM 止跌翻紅</span>，則是跌勢中最佳的<strong>恐慌見底反轉做多時機</strong>。
        </div>
        {market !== 'CRYPTO' && (
          <div className="md:col-span-2">
            <strong className="text-white">5. 台指夜盤與 AI 半導體連動 (台積電 ADR TSM & 費半 ^SOX)：</strong>
            台指期夜盤與隔日台股開盤有逾 65% 權重受 <span className="text-cyan-300">台積電 ADR (TSM)</span> 與 <span className="text-cyan-300">費城半導體 (^SOX)</span> 連動。當 TSM 與費半同步跌破 10MA 或重挫逾 1.2%，夜盤與隔日現貨極易開低承壓（適合逢反彈壓力避險／做空）；反之當 TSM 與費半率先端出破底翻紅，即為台指夜盤領先止跌訊號。
          </div>
        )}
        {market !== 'CRYPTO' && (
          <div className="md:col-span-2">
            <strong className="text-white">6. 油價 (WTI／布蘭特原油期貨)：</strong>
            油價上行會增加燃料、運輸與通膨壓力，但能源業可能受惠；油價回落可降低成本，急跌卻也可能反映需求轉弱。
            以單日 ±3%、雙油高於 10MA 5% 提示急變或成本壓力；雙油回落至少 0.5% 且低於 10MA，並搭配 NQ／ES 未跌、VIX 未升溫，才提示成本緩和。
            這些是未經回測的觀察門檻，無法辨識供需成因；油價卡不列入總分及看漲／中性／看跌計數，報價為 Yahoo 近月期貨，可能受換月影響。
            <span className="block mt-1">
              原理參考：<a className="text-cyan-300 underline" href="https://www.eia.gov/energyexplained/oil-and-petroleum-products/prices-and-outlook.php" target="_blank" rel="noreferrer">EIA 油價供需說明</a>
              {' ／ '}<a className="text-cyan-300 underline" href="https://libertystreeteconomics.newyorkfed.org/2013/03/a-new-approach-for-identifying-demand-and-supply-shocks-in-the-oil-market/" target="_blank" rel="noreferrer">紐約聯準銀行供需衝擊研究</a>。
            </span>
          </div>
        )}
      </div>
    </details>
  );
}
