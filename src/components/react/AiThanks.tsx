import { useEffect, useState } from 'react';
import { $aiCode, AI_ENDPOINT } from '../../store/ai';

// Stripe の支払い後に戻ってくるページ。支払いを確かめて利用コードを出し、このブラウザに保存する。
export default function AiThanks() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('session_id');
    if (!id || !AI_ENDPOINT) { setErr('支払いの情報が見つかりません。'); return; }
    let tries = 0;
    const load = async () => {
      const r = await fetch(`${AI_ENDPOINT}/code?session_id=${encodeURIComponent(id)}`);
      const d = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
      if (r.ok && d.code) { setCode(d.code); $aiCode.set(d.code); return; }
      // 支払い直後は完了の確認が数秒遅れることがある
      if (r.status === 409 && ++tries < 5) { setTimeout(load, 2000); return; }
      setErr(d.error || '利用コードを取得できませんでした。');
    };
    load();
  }, []);

  if (err) return <p className="text-sm text-[#a33]">{err} お支払いが済んでいる場合は、運営者情報のお問い合わせからご連絡ください。</p>;
  if (!code) return <p className="text-sm text-ink-soft">お支払いを確認しています…</p>;
  return (
    <div className="card p-6">
      <p className="mb-2">お申し込みありがとうございます。あなたの利用コードです。</p>
      <div className="font-mono text-2xl tracking-wider my-3">{code}</div>
      <p className="text-sm text-ink-soft">
        このブラウザには自動で保存しました。<b>別のブラウザやスマホで使うとき・解約するときに必要なので、必ず控えてください</b>（スクリーンショットで構いません）。
      </p>
      <a className="btn btn-primary mt-4 inline-block no-underline" href="/practice/">演習に戻る</a>
    </div>
  );
}
