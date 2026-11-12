import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Site } from '../../lib/types';
import type { OxItem } from '../../lib/ox';
import { $progress, isWeak } from '../../store/progress';
import { $ox, $oxDay, FREE_OX_PER_DAY, countOx, oxUsedToday, recordOx } from '../../store/drill';
import { $aiCode, checkPaid, type PaidState } from '../../store/ai';

// 一問一答（肢ごとの○×）。過去問の肢を1つずつ「正しい／誤り」で答える。
// 材料は解説で正誤を確かめ済みの肢だけ（/data/ox.json。src/lib/ox.ts で作る）。
// 無料は1日10肢まで、有料プランは無制限。

const S = siteJson as unknown as Site;
type Mode = 'random' | 'fromWrong' | 'oxWrong' | 'fresh';
const MODES: { v: Mode; label: string; hint: string }[] = [
  { v: 'random', label: 'ランダム', hint: 'すべての肢から順番を混ぜて' },
  { v: 'fromWrong', label: '間違えた問題の肢', hint: '演習で間違えた・要復習の問題の肢だけ' },
  { v: 'oxWrong', label: '○×で間違えた肢', hint: 'この一問一答で前回間違えた肢だけ' },
  { v: 'fresh', label: 'まだの肢', hint: 'この一問一答でまだ答えていない肢だけ' },
];

function shuffle<T>(a: T[]) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export default function OxDrill() {
  const [items, setItems] = useState<OxItem[] | null>(null);
  const [cat, setCat] = useState('all');
  const [mode, setMode] = useState<Mode>('random');
  const [session, setSession] = useState<OxItem[] | null>(null);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [score, setScore] = useState({ ok: 0, ng: 0 });
  const [paid, setPaid] = useState<PaidState>('checking');
  const code = useStore($aiCode);
  const prog = useStore($progress);
  const ox = useStore($ox);
  useStore($oxDay);

  useEffect(() => {
    fetch('/data/ox.json').then((r) => r.json()).then(setItems);
    const p = new URLSearchParams(location.search);
    if (p.get('cat')) setCat(p.get('cat')!);
    const m = p.get('mode') as Mode | null;
    if (m && MODES.some((x) => x.v === m)) setMode(m);
  }, []);
  useEffect(() => { checkPaid(code).then(setPaid); }, [code]);

  const filtered = useMemo(() => (items ?? []).filter((x) =>
    (cat === 'all' || x.cat === cat) &&
    (mode === 'fromWrong' ? (!!prog[x.q]?.answered && !prog[x.q]?.correct) || isWeak(prog[x.q])
      : mode === 'oxWrong' ? ox[x.id] && !ox[x.id].ok
      : mode === 'fresh' ? !ox[x.id]
      : true)), [items, cat, mode, prog, ox]);

  const left = paid === 'paid' ? Infinity : Math.max(0, FREE_OX_PER_DAY - oxUsedToday());

  if (!items) return <div className="card p-6 text-ink-soft">読み込み中…</div>;

  const start = () => { setSession(shuffle(filtered)); setI(0); setAnswer(null); setScore({ ok: 0, ng: 0 }); window.scrollTo(0, 0); };
  const quit = () => { setSession(null); setAnswer(null); };

  // ---------- 出題中 ----------
  if (session) {
    const it = session[i];
    const done = i >= session.length;
    const blocked = answer === null && left <= 0;
    if (done || !it) {
      return (
        <div className="card p-6 text-center space-y-3">
          <div className="eyebrow">おつかれさまでした</div>
          <div className="serif text-4xl text-moss-deep">{score.ok}<span className="text-xl text-ink-soft"> / {score.ok + score.ng}</span></div>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary" onClick={() => { setMode('oxWrong'); quit(); }}>間違えた肢だけもう一度</button>
            <button className="btn btn-ghost" onClick={quit}>条件を選び直す</button>
          </div>
        </div>
      );
    }
    const pick = (v: boolean) => {
      if (answer !== null || left <= 0) return;
      setAnswer(v);
      const ok = v === it.ok;
      recordOx(it.id, ok);
      if (paid !== 'paid') countOx();
      setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), ng: s.ng + (ok ? 0 : 1) }));
    };
    const right = answer !== null && answer === it.ok;
    return (
      <div className="space-y-4">
        <div className="card px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="serif text-lg">{i + 1} <span className="text-ink-faint text-sm">/ {session.length}</span></span>
          <div className="bar flex-1 min-w-24"><i style={{ width: ((i + (answer !== null ? 1 : 0)) / session.length) * 100 + '%' }} /></div>
          <span className="text-ink-soft">○ {score.ok} ・ × {score.ng}</span>
          {paid !== 'paid' && <span className="text-ink-faint">今日の無料 残り {left}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={quit}>終了</button>
        </div>
        <article className="card p-5 md:p-7">
          {!blocked && <>
          <div className="text-xs text-ink-faint mb-2">{it.label}</div>
          <p className="text-sm text-ink-soft mb-3 whitespace-pre-line">{it.stem}</p>
          <div className="qhtml text-[1.1rem] px-4 py-3 bg-paper rounded-dojo" dangerouslySetInnerHTML={{ __html: it.html }} />
          <div className="text-sm font-bold text-moss-deep mt-5 mb-2">👇 この記述は？</div>
          <div className="grid grid-cols-2 gap-3">
            {[true, false].map((v) => (
              <button key={String(v)} type="button" disabled={answer !== null || blocked}
                className={'choice justify-center text-lg py-4' + (answer !== null ? (v === it.ok ? ' is-correct' : v === answer ? ' is-wrong' : ' is-muted') : '')}
                onClick={() => pick(v)}>
                {v ? '○ 正しい' : '× 誤り'}
              </button>
            ))}
          </div>
          </>}
          {blocked && (
            <div className="mt-4 px-4 py-3 rounded-dojo bg-paper-deep text-sm">
              今日の無料ぶん（{FREE_OX_PER_DAY}肢）を使い切りました。明日また解けます。<br />
              有料プラン（月額980円）なら一問一答と模擬試験は回数の制限なし、AI に質問は1日15回まで使えます。<a href="/ai/">有料プランを見る →</a>
            </div>
          )}
          {answer !== null && (
            <>
              <div className={'mt-4 px-4 py-3 rounded-dojo font-bold ' + (right ? 'bg-moss-pale text-moss-deep' : 'bg-shu-pale text-shu')}>
                {right ? '正解！' : '不正解'} … この記述は {it.ok ? '正しい' : '誤り'}
              </div>
              <div className="qhtml mt-3 text-[.97rem]" dangerouslySetInnerHTML={{ __html: it.reasonHtml }} />
              <div className="text-sm mt-3"><a href={it.url}>この問題のページで全体の解説を読む →</a></div>
            </>
          )}
        </article>
        <div className="flex justify-between gap-3">
          <button type="button" className="btn btn-ghost flex-1" disabled={i === 0} onClick={() => { setI(i - 1); setAnswer(null); window.scrollTo(0, 0); }}>← 前へ</button>
          <button type="button" className={'btn flex-1 ' + (answer !== null ? 'btn-primary' : 'btn-ghost')} onClick={() => { setI(i + 1); setAnswer(null); window.scrollTo(0, 0); }}>
            {i < session.length - 1 ? '次へ →' : '結果を見る'}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 条件選択 ----------
  const sel = 'px-3 py-1.5 rounded-dojo border text-sm cursor-pointer transition ';
  const on = 'bg-moss text-white border-moss';
  const off = 'bg-card border-line hover:border-ink-faint';
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="font-bold mb-2">分野</div>
        <div className="flex flex-wrap gap-2">
          <button className={sel + (cat === 'all' ? on : off)} onClick={() => setCat('all')}>すべて</button>
          {S.categories.filter((c) => items.some((x) => x.cat === c.slug)).map((c) => (
            <button key={c.slug} className={sel + (cat === c.slug ? on : off)} onClick={() => setCat(c.slug)}>{c.icon} {c.name}</button>
          ))}
        </div>
        <div className="font-bold mt-5 mb-2">出し方</div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => <button key={m.v} className={sel + (mode === m.v ? on : off)} title={m.hint} onClick={() => setMode(m.v)}>{m.label}</button>)}
        </div>
        <div className="text-xs text-ink-faint mt-1">{MODES.find((m) => m.v === mode)?.hint}</div>
      </div>
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div className="serif text-3xl">{filtered.length}<span className="text-base text-ink-soft"> 肢</span></div>
        <button className="btn btn-primary text-lg px-8" disabled={filtered.length === 0} onClick={start}>始める</button>
        <span className="text-sm text-ink-soft">
          {filtered.length === 0 ? 'この条件に当てはまる肢はありません。'
            : paid === 'paid' ? '有料プラン：回数の制限なし'
            : `無料：1日${FREE_OX_PER_DAY}肢まで（今日の残り ${left}）`}
        </span>
      </div>
    </div>
  );
}
