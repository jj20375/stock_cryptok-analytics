/** @component 玄學羅盤免責聲明；頁首與首頁小卡共用，文案固定不可省略。 */
export function MetaphysicsDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) return <p className="text-[11px] opacity-60">玄學參考・非量化訊號・不構成投資建議</p>;
  return (
    <p role="note" className="rounded border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-200">
      玄學參考，非量化訊號，不構成投資建議。結果不會影響漲跌羅盤、選股、下單與風控；命中率分頁可查看歷史回測是否優於隨機。
    </p>
  );
}
