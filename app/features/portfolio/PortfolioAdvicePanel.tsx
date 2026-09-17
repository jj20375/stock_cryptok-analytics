/** @file AI 汰弱留強建議面板；只呈現既有診斷 API 的結果。 */
interface PortfolioAdvicePanelProps {
  diagnosisData: any;
  isLoading: boolean;
}

/** 後端尚未回傳時保留明確空狀態，避免把分析中的資料誤顯示為交易建議。 */
export function PortfolioAdvicePanel({ diagnosisData, isLoading }: PortfolioAdvicePanelProps) {
  return (
    <div className="lg:col-span-2 border border-[#141414] bg-white p-8 relative overflow-hidden">
      <div className="flex justify-between items-center border-b border-[#141414]/10 pb-4 mb-6">
        <div>
          <h3 className="font-serif italic text-lg flex items-center gap-2"><span>🤖</span> AI 汰弱留強換股助手</h3>
          <p className="text-xs text-gray-500 mt-0.5">基於多因子技術面、籌碼流向及機會成本的動態調倉建議。</p>
        </div>
        {isLoading && <span className="text-xs text-gray-400 animate-pulse">● 分析中...</span>}
      </div>

      {diagnosisData?.advice ? (
        <div className="space-y-6">
          <div className="bg-[#141414]/5 rounded-lg p-5 text-sm leading-relaxed text-[#141414]">
            <span className="font-bold block mb-1">💡 智投顧問操作指引：</span>
            {diagnosisData.advice.aiAdvice}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-rose-200 bg-rose-50/30 rounded-lg p-4">
              <span className="text-xs font-bold text-rose-800 uppercase block mb-3 font-mono">⚠️ 建議汰弱 (持倉診斷較弱)</span>
              {diagnosisData.advice.diagnoses.filter((item: any) => item.isWeak).length === 0 ? (
                <p className="text-xs text-gray-500 italic">目前持倉中無明顯破位或籌碼流出標的。</p>
              ) : (
                <div className="space-y-3">
                  {diagnosisData.advice.diagnoses.filter((item: any) => item.isWeak).map((item: any) => (
                    <div key={item.symbol} className="border-b border-rose-100 last:border-b-0 pb-2 last:pb-0">
                      <div className="flex justify-between text-xs font-bold text-rose-900"><span>{item.name} ({item.symbol})</span><span>${item.price.toFixed(1)}</span></div>
                      <div className="text-[10px] text-rose-700/80 mt-1 space-y-0.5">{item.reasons.map((reason: string, index: number) => <div key={index}>• {reason}</div>)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-emerald-200 bg-emerald-50/30 rounded-lg p-4">
              <span className="text-xs font-bold text-emerald-800 uppercase block mb-3 font-mono">⭐ 建議留強 (市場多頭熱門)</span>
              {diagnosisData.advice.strongCandidates.length === 0 ? (
                <p className="text-xs text-gray-500 italic">暫無合適的強勢股候選。</p>
              ) : (
                <div className="space-y-3">
                  {diagnosisData.advice.strongCandidates.map((item: any) => (
                    <div key={item.symbol} className="border-b border-emerald-100 last:border-b-0 pb-2 last:pb-0">
                      <div className="flex justify-between text-xs font-bold text-emerald-900"><span>{item.name} ({item.symbol})</span></div>
                      <p className="text-[10px] text-emerald-700/80 mt-1 leading-relaxed">{item.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-xs opacity-40 italic">{isLoading ? '正在讀取 AI 智投換股資料...' : '尚未載入診斷結果，請添加持股或重試。'}</div>
      )}
    </div>
  );
}
