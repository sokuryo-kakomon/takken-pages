import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import type { Question } from '../../lib/types';
import { $aiCode, AI_ENDPOINT } from '../../store/ai';

// 「AI に質問」。中継サーバー（worker/）の URL が PUBLIC_AI_ENDPOINT に入っていれば、
// その場で AI とやりとりする。入っていなければ、従来どおり質問文をコピーして外の AI に貼る形。
const ENDPOINT = AI_ENDPOINT;
// 無料の質問は Cloudflare Turnstile で人間か確かめる（キーが無ければ省く）
const TURNSTILE_KEY: string | undefined = import.meta.env.PUBLIC_TURNSTILE_SITEKEY;

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: object) => string; reset: (id: string) => void } }
}

function useTurnstile(enabled: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const [token, setTokenState] = useState('');
  const tokenRef = useRef('');
  const setToken = (t: string) => { tokenRef.current = t; setTokenState(t); };
  useEffect(() => {
    if (!enabled || !TURNSTILE_KEY || !box.current) return;
    const draw = () => {
      if (!window.turnstile || !box.current || id.current) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_KEY, appearance: 'interaction-only', callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(''),
      });
    };
    if (window.turnstile) draw();
    else {
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.async = true; sc.onload = draw; document.head.appendChild(sc);
    }
  }, [enabled]);
  // トークンは1回きりなので、使ったら取り直す
  const used = () => { setToken(''); if (id.current && window.turnstile) window.turnstile.reset(id.current); };
  // 確認が済むまで待つ（最初の数秒はまだ済んでいないので、押されたらここで待つ）
  const wait = async (ms = 20000) => {
    const t0 = Date.now();
    while (!tokenRef.current && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200));
    return tokenRef.current;
  };
  return { box, token, used, wait, needed: enabled && !!TURNSTILE_KEY };
}

export function buildPrompt(q: Question) {
  const lines = [`【${q.title}】`, '', q.statementText, ''];
  if (q.items.length) { lines.push(...q.items.map((i) => `${i.key}. ${i.text}`)); lines.push(''); }
  if (q.choices.length) lines.push(...q.choices.map((c) => `${c.key}. ${c.text}`));
  lines.push('', `正解：${q.answer}`, '',
    'この問題について、なぜその答えになるのかを、途中の考え方を省略せずに説明してください。',
    '誤りの選択肢についても、どこが・なぜ誤りかを述べてください。');
  return lines.join('\n');
}

type Msg = { role: 'user' | 'assistant'; content: string };

// AI の答えの簡単な Markdown（見出し・箇条書き・太字・表）を表示用に組み立てる。HTML は通さない。
function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((t, i) =>
    t.startsWith('**') && t.endsWith('**') && t.length > 4 ? <strong key={i} className="text-ink">{t.slice(2, -2)}</strong>
      : t.startsWith('`') && t.endsWith('`') && t.length > 2 ? <code key={i} className="text-[.85em] bg-paper px-1 rounded">{t.slice(1, -1)}</code>
        : t);
}

function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) { out.push(<div key={i} className="font-bold text-moss mt-3 mb-1 first:mt-0">{inline(h[1])}</div>); i++; continue; }
    if (/^\s*([-*・]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*・]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*・]|\d+[.)])\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      out.push(<Tag key={i} className={(ordered ? 'list-decimal' : 'list-disc') + ' pl-5 my-1.5 space-y-1 marker:text-moss'}>
        {items.map((t, k) => <li key={k}>{inline(t)}</li>)}</Tag>);
      continue;
    }
    if (l.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      out.push(<div key={i} className="overflow-x-auto my-2"><table className="text-xs border-collapse">
        <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, m) =>
          k === 0 ? <th key={m} className="border border-line px-2 py-1 bg-paper">{inline(c)}</th>
            : <td key={m} className="border border-line px-2 py-1">{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*・]|\d+[.)])\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={i} className="my-1.5 first:mt-0">{para.map((t, k) => <span key={k}>{k > 0 && <br />}{inline(t)}</span>)}</p>);
  }
  return <>{out}</>;
}

function suggestions(q: Question) {
  const k = (q as { kind?: string }).kind;
  if (k === 'tashi') return ['空欄アにこの語句が入る理由は？', 'まぎらわしい語句との違いは？', 'この判例・条文のポイントを3行で'];
  if (k === 'kijutsu') return ['正解例のどの語句が採点で大事？', '問題文のどこから答えを組み立てる？', 'この論点のポイントを3行で'];
  const s = ['この問題のポイントを3行で', '解説の分からない所をもっと噛み砕いて'];
  if (q.choices.length) s.unshift(`${q.choices[0].key} はなぜ正しい／誤り？`);
  else if (q.items.length) s.unshift(`${q.items[0].key} はなぜ正しい／誤り？`);
  s.push('似た問題で引っかからないコツは？');
  return s.slice(0, 4);
}

function Chat({ q, wide }: { q: Question; wide: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [upsell, setUpsell] = useState(false);
  const code = useStore($aiCode);
  const ts = useTurnstile(!code);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: t }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setInput(''); setBusy(true); setNotice(''); setUpsell(false);
    try {
      let tok: string | undefined;
      if (!code && ts.needed) {
        tok = ts.token || await ts.wait();
        if (!tok) {
          setNotice('確認が終わりませんでした。表示された確認があれば済ませてから、もう一度押してください。');
          setMsgs(history.slice(0, -1)); setInput(t);
          return;
        }
      }
      const res = await fetch(`${ENDPOINT}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qid: q.id, messages: history, code: code || undefined, turnstile: tok }),
      });
      if (!code) ts.used();
      const rem = res.headers.get('X-Remaining');
      if (rem !== null) setRemaining(rem);
      if (!res.ok || !res.body) {
        setNotice(await res.text());
        if (res.status === 429 && res.headers.get('X-Plan') === 'free') setUpsell(true);
        setMsgs(history.slice(0, -1)); // 送れなかった質問は入力欄へ戻す
        setInput(t);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...history, { role: 'assistant', content: acc }]);
      }
    } catch {
      setNotice('通信に失敗しました。電波の良い所でもう一度お試しください。');
      setMsgs(history.slice(0, -1)); setInput(t);
    } finally {
      setBusy(false);
    }
  };

  const full = msgs.length >= 12;
  return (
    <>
      <div className={(wide ? 'flex-1 min-h-0' : 'max-h-[55vh]') + ' overflow-auto space-y-3 mb-3'}>
        {msgs.length === 0 && (
          <>
            <p className="text-xs text-ink-faint">よくある質問（押すとそのまま聞けます）</p>
            <div className="flex flex-wrap gap-2">
              {suggestions(q).map((s) => (
                <button key={s} type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            {m.role === 'user' ? (
              <div className="inline-block text-left text-sm whitespace-pre-wrap rounded-dojo px-3 py-2 max-w-[92%] bg-moss-pale">{m.content}</div>
            ) : (
              <div className="text-left text-[.9rem] leading-relaxed text-ink bg-white border border-line border-l-4 border-l-moss rounded-dojo px-4 py-3">
                {m.content ? <Rich text={m.content} /> : (busy && i === msgs.length - 1 ? <span className="text-ink-faint">考えています…</span> : '')}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {notice && <p className="text-sm text-[#a33] mb-2">{notice}</p>}
      {upsell && (
        <p className="text-sm mb-2"><a href="/ai/" className="btn btn-primary btn-sm no-underline">有料プラン（月980円・より賢い AI・1日15回）を見る</a></p>
      )}
      <div ref={ts.box} />
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <label htmlFor={`ai-q-${q.id}`} className="block text-sm font-bold text-moss mb-1">✏️ 自分の言葉で質問する</label>
        <div className="flex gap-2 items-end">
          <textarea id={`ai-q-${q.id}`} rows={2} autoFocus
            className="flex-1 border-2 border-moss rounded-dojo px-3 py-2 text-[.95rem] bg-white resize-none focus:outline-none focus:ring-2 focus:ring-moss/40"
            maxLength={800}
            placeholder={full ? 'この問題のやりとりは上限に達しました' : 'ここに質問を書いてください（例：選択肢3はなぜ誤り？）'}
            value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || full}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); } }} />
          <button className="btn btn-primary" disabled={busy || full || !input.trim()}>{busy ? '…' : '送る'}</button>
        </div>
      </form>
      {!code && (
        <a href="/ai/" className="ai-upsell block mt-3 rounded-dojo border border-line overflow-hidden no-underline text-ink text-xs hover:border-moss">
          <table className="w-full border-collapse">
            <thead><tr><th className="py-1.5 px-2.5"></th><th className="py-1.5 px-2.5 text-left font-normal text-ink-soft">いまの無料</th><th className="py-1.5 px-2.5 text-left border-l-2 border-l-moss bg-[#fffdf7] text-moss-deep">有料プラン　月額980円（税込）</th></tr></thead>
            <tbody>
              <tr><td className="py-1.5 px-2.5 border-t border-line text-ink-soft whitespace-nowrap w-px">AI に質問</td><td className="py-1.5 px-2.5 border-t border-line text-ink-soft">標準の AI・1日2回</td><td className="py-1.5 px-2.5 border-t border-line border-l-2 border-l-moss bg-[#fffdf7] text-moss-deep font-bold">より詳しく答える AI・1日15回</td></tr>
              <tr><td className="py-1.5 px-2.5 border-t border-line text-ink-soft whitespace-nowrap w-px">模擬試験</td><td className="py-1.5 px-2.5 border-t border-line text-ink-soft">分野1つの回を1回だけ</td><td className="py-1.5 px-2.5 border-t border-line border-l-2 border-l-moss bg-[#fffdf7] text-moss-deep font-bold">本番形式で何回でも</td></tr>
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-line bg-[#fffdf7]"><span className="text-ink-soft">いつでも解約できます</span><span className="rounded-full bg-moss-deep text-white font-bold px-3.5 py-1 whitespace-nowrap">有料プランを見る →</span></div>
        </a>
      )}
      <p className="text-[.7rem] text-ink-faint mt-2 leading-snug">
        AI の答えは誤ることがあります。正解は不動産適正取引推進機構の発表が正です。{code ? '有料プラン（より詳しく答える AI）' : '無料（標準の AI）'}{remaining !== null && `・今日の残り ${remaining} 回`}。質問の内容は回答の作成にだけ使い、保存しません。
      </p>
    </>
  );
}

function CopyPrompt({ q }: { q: Question }) {
  const [copied, setCopied] = useState(false);
  const prompt = buildPrompt(q);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* 権限なし */ }
  };
  return (
    <>
      <p className="text-sm text-ink-soft mb-3">
        この問題について AI に追加の質問ができる機能を準備しています。いまは下の質問文をコピーして、お使いの AI（ChatGPT・Gemini・Claude など）に貼り付けてお使いください。
      </p>
      <pre className="text-xs whitespace-pre-wrap bg-paper border border-line rounded-dojo p-3 max-h-64 overflow-auto font-sans">{prompt}</pre>
      <div className="mt-3"><button className="btn btn-primary btn-sm" onClick={copy}>{copied ? 'コピーしました' : '質問文をコピー'}</button></div>
    </>
  );
}

export default function AiExplainButton({ q }: { q: Question }) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const wideStyle = wide ? { maxWidth: 'none', width: '100%', height: '100%', maxHeight: 'none', display: 'flex', flexDirection: 'column' as const } : undefined;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        🤖 AI に質問{!ENDPOINT && <span className="text-xs text-ink-faint ml-1">（準備中）</span>}
      </button>
      {open && (
        <div className="modal-bg" style={wide ? { padding: 0 } : undefined} onClick={() => setOpen(false)}>
          <div className="modal" style={wideStyle} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="absolute top-1 right-1 flex">
              <button type="button" className="w-10 h-9 grid place-items-center text-ink-soft hover:bg-paper hover:text-ink rounded"
                onClick={() => setWide(!wide)} aria-label={wide ? '元の大きさに戻す' : '全画面にする'} title={wide ? '元の大きさに戻す' : '全画面にする'}>
                {wide ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="3.5" width="9.5" height="9.5" /><path d="M3.5 3.5V1h9.5v9.5H10.5" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1.5" y="1.5" width="11" height="11" /></svg>
                )}
              </button>
              <button type="button" className="w-10 h-9 grid place-items-center text-ink-soft hover:bg-[#c42b1c] hover:text-white rounded"
                onClick={() => setOpen(false)} aria-label="閉じる" title="閉じる">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1.5 1.5l11 11M12.5 1.5l-11 11" /></svg>
              </button>
            </div>
            <h3 className="text-lg mb-2 pr-24">AI に質問（{q.yearLabel} 第{q.num}問）</h3>
            {ENDPOINT ? <Chat q={q} wide={wide} /> : <CopyPrompt q={q} />}
          </div>
        </div>
      )}
    </>
  );
}
