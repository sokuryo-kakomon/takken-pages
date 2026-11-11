import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { $aiCode, AI_ENDPOINT, normalizeCode, postJson } from '../../store/ai';

type Status = { active: boolean; todayLeft: number; monthLeft: number };

// /ai/ ページの申し込み・コード入力・契約管理。
export default function AiPlan() {
  const code = useStore($aiCode);
  const [status, setStatus] = useState<Status | null>(null);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code || !AI_ENDPOINT) { setStatus(null); return; }
    postJson<Status>('/status', { code }).then(({ ok, data }) => {
      if (ok) setStatus(data); else { setStatus(null); setMsg(data.error || ''); }
    });
  }, [code]);

  if (!AI_ENDPOINT) return <p className="text-sm text-ink-soft">有料プランは準備中です。</p>;

  const buy = async () => {
    setBusy(true); setMsg('');
    const { ok, data } = await postJson<{ url: string }>('/checkout', {});
    if (ok && data.url) location.href = data.url; else { setMsg(data.error || '支払い画面を開けませんでした。'); setBusy(false); }
  };
  const manage = async () => {
    setBusy(true); setMsg('');
    const { ok, data } = await postJson<{ url: string }>('/portal', { code });
    if (ok && data.url) location.href = data.url; else { setMsg(data.error || '契約の画面を開けませんでした。'); setBusy(false); }
  };
  const save = () => { const c = normalizeCode(input); if (c) { $aiCode.set(c); setInput(''); setMsg(''); } };

  return (
    <div className="space-y-6">
      {code ? (
        <div className="card p-5">
          <div className="text-sm text-ink-soft">このブラウザの利用コード</div>
          <div className="font-mono text-lg tracking-wider my-1">{code}</div>
          {status && (status.active
            ? <p className="text-sm">有料プラン利用中：今日の残り <b>{status.todayLeft}</b> 回・今月の残り <b>{status.monthLeft}</b> 回</p>
            : <p className="text-sm text-[#a33]">このコードは停止中です（解約済み、またはお支払いが確認できていません）。</p>)}
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={manage}>契約の確認・カード変更・解約</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('このブラウザからコードを消します。コードを控えていれば、後でまた入れられます。')) $aiCode.set(''); }}>このブラウザから外す</button>
          </div>
        </div>
      ) : (
        <div className="card p-5">
          <button className="btn btn-primary" disabled={busy} onClick={buy}>月額 980円（税込）で申し込む</button>
          <p className="text-xs text-ink-faint mt-2">Stripe の画面でカード払い。申し込むと利用コードが表示されます。<a href="/tokushoho/">特定商取引法に基づく表記</a></p>
        </div>
      )}
      <div className="card p-5">
        <div className="text-sm mb-2">利用コードをお持ちの方（別のブラウザやスマホで使う場合）</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input className="flex-1 border border-line rounded-dojo px-3 py-2 text-sm bg-white font-mono" placeholder="XXXX-XXXX-XXXX-XXXX"
            value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={!input.trim()}>このブラウザで使う</button>
        </form>
      </div>
      {msg && <p className="text-sm text-[#a33]">{msg}</p>}
    </div>
  );
}
