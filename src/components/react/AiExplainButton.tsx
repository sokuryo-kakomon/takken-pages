import { useState } from 'react';
import type { Question } from '../../lib/types';

// 「AI に深掘り質問」ボタン。API 連携は未実装なので、いまは質問文を組み立てて
// コピーできるところまで。将来はこの buildPrompt() の出力をそのまま API へ渡す。
export function buildPrompt(q: Question) {
  const lines = [`【${q.title}】`, '', q.statementText, ''];
  if (q.items.length) { lines.push(...q.items.map((i) => `${i.key}. ${i.text}`)); lines.push(''); }
  if (q.choices.length) lines.push(...q.choices.map((c) => `${c.key}. ${c.text}`));
  lines.push('', `正解：${q.answer}`, '',
    'この問題について、なぜその答えになるのかを、途中の考え方を省略せずに説明してください。',
    '誤りの選択肢についても、どこが・なぜ誤りかを述べてください。');
  return lines.join('\n');
}

export default function AiExplainButton({ q }: { q: Question }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const prompt = buildPrompt(q);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* 権限なし */ }
  };
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        🤖 AI に深掘り質問<span className="text-xs text-ink-faint ml-1">（準備中）</span>
      </button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button className="modal-x" onClick={() => setOpen(false)} aria-label="閉じる">×</button>
            <h3 className="text-lg mb-2">AI 解説（準備中）</h3>
            <p className="text-sm text-ink-soft mb-3">
              この問題について AI に追加の質問ができる機能を準備しています。いまは下の質問文をコピーして、お使いの AI（ChatGPT・Gemini・Claude など）に貼り付けてお使いください。
            </p>
            <pre className="text-xs whitespace-pre-wrap bg-paper border border-line rounded-dojo p-3 max-h-64 overflow-auto font-sans">{prompt}</pre>
            <div className="mt-3 flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={copy}>{copied ? 'コピーしました' : '質問文をコピー'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
