/** @file 個股分析的題材、量價、籌碼與同業卡片；僅顯示既有分析結果。 */
import { Activity, BarChart3, Info, Newspaper } from 'lucide-react';

export function StockAnalysisDetails({ data, symbol, chipData, isLoadingChips }: {
  data: any; symbol: string; chipData: any; isLoadingChips: boolean;
}) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* 基本面與產業題材 */}
                <div className="border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-6">
                    <Newspaper className="w-6 h-6" />
                    <h3 className="font-serif italic text-xl">基本面與產業題材</h3>
                  </div>
                  <p className="text-sm leading-relaxed opacity-80 group-hover:opacity-100">
                    {data.aiAnalysis.fundamentalsAndNews}
                  </p>
                  {data.raw.newsHeadlines && data.raw.newsHeadlines.length > 0 && (
                    <div className="mt-6 space-y-2 border-t border-current/20 pt-4">
                      <p className="text-[10px] font-bold uppercase opacity-50 mb-2">相關時事新聞</p>
                      {data.raw.newsHeadlines.slice(0, 3).map((h: string, i: number) => (
                        <div key={i} className="text-xs truncate font-mono flex items-center gap-2">
                          <div className="w-1 h-1 bg-current rounded-full" />
                          {h}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 量價訊號分析 */}
                <div className="border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-6">
                    <Activity className="w-6 h-6" />
                    <h3 className="font-serif italic text-xl">量價訊號 (量大不漲)</h3>
                  </div>
                  <p className="text-sm leading-relaxed opacity-80 group-hover:opacity-100 mb-6">
                    {data.aiAnalysis.volumeAnalysis}
                  </p>
                  
                  <div className="space-y-4">
                    <div className={`p-4 border border-current font-mono flex justify-between items-center ${data.raw.volumeSignal?.isTriggered ? 'bg-red-500/10' : 'opacity-60'}`}>
                      <div>
                        <span className="text-[10px] block opacity-50 uppercase">今日量能對比 (5日均)</span>
                        <span className="text-xs font-bold">{data.raw.volumeSignal?.isTriggered ? '⚠️ 觸發量能異常' : '目前量能平穩'}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] block opacity-50">倍數</span>
                        <span className="text-xl font-black">{data.raw.volumeSignal?.multiple?.toFixed(1)}x</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 border border-current/20 font-mono">
                        <span className="text-[10px] block opacity-50 uppercase">本週 vs 上週比例</span>
                        <span className="text-lg font-black text-blue-500">
                          {data.raw.volumeSignal?.weeklyComparison?.ratio?.toFixed(2)}x
                        </span>
                      </div>
                      <div className="p-3 border border-current/20 font-mono text-right">
                        <span className="text-[10px] block opacity-50 uppercase">本週總成交量</span>
                        <span className="text-sm font-bold">
                          {(data.raw.volumeSignal?.weeklyComparison?.thisWeekVol / 1000).toFixed(0)}K
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 籌碼面分析 */}
                <div className="md:col-span-2 border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center gap-3 mb-6">
                    <Info className="w-6 h-6" />
                    <h3 className="font-serif italic text-xl">大戶籌碼與融資融券動向</h3>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <p className="text-sm leading-relaxed opacity-80 group-hover:opacity-100">
                      {data.aiAnalysis.chipsAnalysis}
                    </p>
                    
                    {/* 【詳細繁體中文註解】：台股個股法人與信用交易籌碼可視化 */}
                    {symbol.includes(".TW") || /^\d{4,6}$/.test(symbol) ? (
                      <div className="border border-current/20 p-4 font-mono text-xs space-y-4">
                        <div className="font-bold border-b border-current/20 pb-2 flex justify-between items-center">
                          <span className="uppercase">📊 證交所籌碼日報 ({chipData?.date || "連線中..."})</span>
                          {isLoadingChips && <span className="animate-pulse">● 更新中...</span>}
                        </div>
                        {chipData ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2 border-b border-current/10 pb-2">
                              <div>
                                <span className="text-[10px] block opacity-50">外資買賣超</span>
                                <span className={`text-sm font-bold ${chipData.foreignBuySell >= 0 ? "text-red-500" : "text-green-500"}`}>
                                  {chipData.foreignBuySell >= 0 ? "+" : ""}{(chipData.foreignBuySell / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">投信買賣超</span>
                                <span className={`text-sm font-bold ${chipData.trustBuySell >= 0 ? "text-red-500" : "text-green-500"}`}>
                                  {chipData.trustBuySell >= 0 ? "+" : ""}{(chipData.trustBuySell / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">自營商買賣超</span>
                                <span className={`text-sm font-bold ${chipData.dealerBuySell >= 0 ? "text-red-500" : "text-green-500"}`}>
                                  {chipData.dealerBuySell >= 0 ? "+" : ""}{(chipData.dealerBuySell / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <span className="text-[10px] block opacity-50">融資餘額</span>
                                <span className="text-sm font-bold text-blue-500">
                                  {chipData.marginBalance.toLocaleString()} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">融券餘額</span>
                                <span className="text-sm font-bold text-purple-500">
                                  {chipData.shortBalance.toLocaleString()} 張
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] block opacity-50">券資比</span>
                                <span className={`text-sm font-bold ${chipData.shortMarginRatio > 20 ? "text-red-500" : "text-gray-500"}`}>
                                  {chipData.shortMarginRatio}%
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="py-4 text-center opacity-40 italic">
                            {isLoadingChips ? "讀取證交所籌碼資料中..." : "暫無最新籌碼數據"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="border border-current/20 p-4 font-mono text-[10px] space-y-2 opacity-60 group-hover:opacity-100 flex flex-col justify-center">
                        <p className="font-bold border-b border-current/20 pb-2 mb-2 uppercase">美股籌碼說明</p>
                        <p>目前未串接美股 13F 或盤中大宗交易資料，無法確認機構持股動向。</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 同業表現對比 */}
                <div className="md:col-span-2 border border-[#141414] bg-white p-8 group hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <BarChart3 className="w-6 h-6" />
                      <h3 className="font-serif italic text-xl">同業表現與連動對比</h3>
                    </div>
                    <span className="text-[10px] font-bold uppercase opacity-40">Sector Peers Analysis</span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.raw.peersData && data.raw.peersData.length > 0 ? (
                      data.raw.peersData.map((peer: any) => (
                        <div key={peer.symbol} className="border border-current/20 p-4 flex justify-between items-center group/item hover:border-current transition-colors">
                          <div>
                            <p className="text-xs font-bold truncate max-w-[120px]">{peer.name || peer.symbol}</p>
                            <p className="text-[10px] font-mono opacity-50 uppercase">{peer.symbol}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black font-mono">{peer.price?.toFixed(2)}</p>
                            <p className={`text-[10px] font-bold ${peer.changePercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {peer.changePercent >= 0 ? '+' : ''}{peer.changePercent?.toFixed(2)}%
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="col-span-full text-center text-xs opacity-40 py-8 italic">目前無相關同業數據</p>
                    )}
                  </div>
                  <p className="mt-6 text-[10px] opacity-40 leading-relaxed italic border-t border-current/10 pt-4">
                    註：同業名單由系統自動生成。透過觀察同類股的漲跌連動，可以判斷目前是「個股表現」還是「板塊集體發動」。
                  </p>
                </div>
              </div>;
}
