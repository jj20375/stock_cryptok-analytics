/**
 * @component AI 解說框：向 /api/metaphysics 取當日解說，與頁面主體分開載入，避免 AI 慢時拖住整頁。
 * 只取「今天」的解說；伺服器會快取，同一天重複開啟不會重複呼叫 AI。
 */
import { useEffect, useState } from 'react';

type NarrativeState = { status: 'loading' } | { status: 'done'; text: string; source: string } | { status: 'error'; message: string };

const SOURCE_LABEL: Record<string, string> = { ai: 'AI 解說', cache: 'AI 解說', template: '規則摘要（AI 暫時無法使用）' };

export function NarrativeBox({ kind }: { kind: string }) {
  const [state, setState] = useState<NarrativeState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/metaphysics?view=narrative&kind=${encodeURIComponent(kind)}`)
      .then(async (response) => {
        const body = await response.json() as { text?: string; source?: string; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.text) setState({ status: 'error', message: body.error ?? '解說載入失敗' });
        else setState({ status: 'done', text: body.text, source: body.source ?? 'template' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', message: '解說載入失敗' }); });
    return () => { cancelled = true; };
  }, [kind]);
  if (state.status === 'loading') return <p className="text-sm opacity-60">解說產生中…</p>;
  if (state.status === 'error') return <p className="text-sm text-rose-300">{state.message}</p>;
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      <p>{state.text}</p>
      <p className="text-[11px] opacity-50">{SOURCE_LABEL[state.source] ?? state.source}</p>
    </div>
  );
}
