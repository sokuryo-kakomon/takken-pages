import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Exam, Question, QuestionIndex, Site } from '../../lib/types';
import { showExam } from '../../lib/examui';
import { $progress, $bookmarks, isWeak, toggleBookmark } from '../../store/progress';
import QuestionCard from './QuestionCard';

// 演習画面。条件を選ぶ → 1問ずつ解く → 結果、の3画面。
// 問題本文は /data/q/<id>.json を1問ずつ取りに行く（全問を最初に読むと数MBになるため）。

const S = siteJson as unknown as Site;
const EXAM_NAME: Record<Exam, string> = { shi: '宅建', hoshi: '（未使用）' };
const yearsOf = (e: Exam) => (e === 'hoshi' ? S.hoshiYears : S.years);
type Mode = 'order' | 'random' | 'unanswered' | 'wrong' | 'weak' | 'bookmark';
const MODES: { v: Mode; label: string; hint: string }[] = [
  { v: 'order', label: '出題順', hint: '年度・問番号の順に' },
  { v: 'random', label: 'ランダム', hint: '順番を混ぜて' },
  { v: 'unanswered', label: '未回答のみ', hint: 'まだ解いていない問題だけ' },
  { v: 'wrong', label: '前回不正解', hint: '直近で間違えた問題だけ' },
  { v: 'weak', label: '要復習', hint: '間違えたことがあり、まだ2回連続で正解していない' },
  { v: 'bookmark', label: '★ 印をつけた問題', hint: '自分で要復習に入れた問題' },
];

function shuffle<T>(a: T[]) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export default function PracticeApp() {
  const [index, setIndex] = useState<QuestionIndex[] | null>(null);
  const [exam, setExam] = useState<Exam>('shi');
  const [year, setYear] = useState('all');
  const [cat, setCat] = useState('all');
  const [mode, setMode] = useState<Mode>('order');
  const [session, setSession] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [cur, setCur] = useState<Question | null>(null);
  const [cache] = useState(() => new Map<string, Question>());
  const [finished, setFinished] = useState(false);
  // トップの「ランダム10問」用: ?n=10 で問題数を絞り、?go=1 で条件を選ばずにすぐ始める
  const [limit, setLimit] = useState(0);
  const autoGo = useRef(false);
  const prog = useStore($progress);
  const bms = useStore($bookmarks);

  useEffect(() => {
    fetch('/data/index.json').then((r) => r.json()).then(setIndex);
    const p = new URLSearchParams(location.search);
    if (p.get('exam') === 'hoshi') setExam('hoshi');
    if (p.get('year')) setYear(p.get('year')!);
    if (p.get('cat')) setCat(p.get('cat')!);
    const m = p.get('mode') as Mode | null;
    if (m && MODES.some((x) => x.v === m)) setMode(m);
    if (Number(p.get('n')) > 0) setLimit(Number(p.get('n')));
    autoGo.current = p.get('go') === '1';
  }, []);

  const filtered = useMemo(() => {
    if (!index) return [];
    return index.filter((x) =>
      x.exam === exam &&
      (year === 'all' || x.year === year) &&
      (cat === 'all' || x.categorySlug === cat) &&
      (mode === 'unanswered' ? !prog[x.id]?.answered
        : mode === 'wrong' ? !!prog[x.id]?.answered && !prog[x.id]?.correct
        : mode === 'weak' ? isWeak(prog[x.id])
        : mode === 'bookmark' ? bms.includes(x.id)
        : true));
  }, [index, exam, year, cat, mode, prog, bms]);

  const start = () => {
    let ids = filtered.map((x) => x.id);
    if (mode === 'random') ids = shuffle(ids);
    if (limit) ids = ids.slice(0, limit);
    setSession(ids); setI(0); setResults({}); setFinished(false);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (index && autoGo.current) { autoGo.current = false; start(); }
  }, [index]);
  const quit = () => { setSession(null); setCur(null); setFinished(false); };

  useEffect(() => {
    if (!session) return;
    const id = session[i];
    if (!id) return;
    if (cache.has(id)) { setCur(cache.get(id)!); return; }
    setCur(null);
    fetch(`/data/q/${id}.json`).then((r) => r.json()).then((q: Question) => { cache.set(id, q); setCur(q); });
    const nid = session[i + 1];
    if (nid && !cache.has(nid)) fetch(`/data/q/${nid}.json`).then((r) => r.json()).then((q: Question) => cache.set(nid, q));
  }, [session, i]);

  if (!index) return <div className="card p-6 text-ink-soft">読み込み中…</div>;

  // ---------- 結果 ----------
  if (session && finished) {
    const done = session.filter((id) => id in results);
    const correct = done.filter((id) => results[id]).length;
    const byCat = S.categories.map((c) => {
      const ids = done.filter((id) => index.find((x) => x.id === id)?.categorySlug === c.slug);
      return { c, n: ids.length, ok: ids.filter((id) => results[id]).length };
    }).filter((r) => r.n > 0);
    const wrong = done.filter((id) => !results[id]).map((id) => index.find((x) => x.id === id)!);
    return (
      <div className="space-y-5">
        <div className="card p-6 text-center">
          <div className="eyebrow mb-2">結果</div>
          <div className="serif text-5xl text-moss-deep">{correct}<span className="text-2xl text-ink-soft"> / {done.length}</span></div>
          <div className="text-ink-soft mt-1">正答率 {done.length ? Math.round((correct / done.length) * 100) : 0}%{done.length < session.length && `（${session.length}問中 ${done.length}問を解答）`}</div>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <button className="btn btn-primary" onClick={start}>同じ条件でもう一度</button>
            <button className="btn btn-ghost" onClick={quit}>条件を選び直す</button>
            <a className="btn btn-ghost" href="/progress/">成績表を見る</a>
          </div>
        </div>
        {byCat.length > 0 && (
          <div className="card p-5">
            <h2 className="text-lg mb-3">分野別</h2>
            <div className="space-y-2">
              {byCat.map(({ c, n, ok }) => (
                <div key={c.slug} className="grid grid-cols-[8.5rem_1fr_4rem] items-center gap-3 text-sm">
                  <span>{c.icon} {c.name}</span>
                  <div className="bar"><i style={{ width: (ok / n) * 100 + '%' }} /></div>
                  <span className="text-right text-ink-soft">{ok}/{n}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {wrong.length > 0 && (
          <div className="card p-5">
            <h2 className="text-lg mb-3 text-shu">間違えた問題 {wrong.length}問</h2>
            <ul className="divide-y divide-line">
              {wrong.map((x) => (
                <li key={x.id} className="py-2 text-sm flex gap-3">
                  <a href={x.url} className="font-bold shrink-0 no-underline">{x.exam === 'hoshi' ? '補 ' : ''}{yearsOf(x.exam).find((y) => y.id === x.year)?.short} 問{x.num}</a>
                  <span className="text-ink-soft min-w-0 truncate">{x.excerpt}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ---------- 出題中 ----------
  if (session) {
    const id = session[i];
    const answeredHere = id in results;
    const marked = bms.includes(id);
    return (
      <div className="space-y-4">
        <div className="card px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="serif text-lg">{i + 1} <span className="text-ink-faint text-sm">/ {session.length}</span></span>
          <div className="bar flex-1 min-w-24"><i style={{ width: ((i + (answeredHere ? 1 : 0)) / session.length) * 100 + '%' }} /></div>
          <span className="text-ink-soft">正解 {Object.values(results).filter(Boolean).length} ・ 不正解 {Object.values(results).filter((v) => !v).length}</span>
          <button type="button" className={'btn btn-ghost btn-sm' + (marked ? ' text-shu border-shu' : '')} onClick={() => toggleBookmark(id)}>{marked ? '★ 要復習' : '☆ 要復習'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFinished(true)}>終了</button>
        </div>
        {cur ? (
          <>
            <div className="text-sm text-ink-soft">{cur.exam === 'hoshi' ? '測量士補 ' : ''}{cur.yearLabel} 問{cur.num} ・ {cur.categoryIcon} {cur.category} ・ <a href={cur.url}>この問題のページ</a></div>
            <QuestionCard q={cur} lawRefs={S.lawRefs} mode="practice" onAnswered={(ok) => setResults((r) => ({ ...r, [id]: ok }))} />
          </>
        ) : (
          <div className="card p-6 text-ink-soft">読み込み中…</div>
        )}
        <div className="flex justify-between gap-3">
          <button type="button" data-key="prev" className="btn btn-ghost flex-1" disabled={i === 0} onClick={() => { setI(i - 1); window.scrollTo(0, 0); }}>← 前の問題</button>
          {i < session.length - 1
            ? <button type="button" data-key="next" className={'btn flex-1 ' + (answeredHere ? 'btn-primary' : 'btn-ghost')} onClick={() => { setI(i + 1); window.scrollTo(0, 0); }}>次の問題 →</button>
            : <button type="button" data-key="next" className="btn btn-primary flex-1" onClick={() => setFinished(true)}>結果を見る</button>}
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
        {/* 試験が1つ（宅建だけ）のときは出さない */}
        {index.some((x) => x.exam === 'hoshi') && <>
        <div className="font-bold mb-2">試験</div>
        <div className="flex flex-wrap gap-2 mb-5">
          {(['shi', 'hoshi'] as Exam[]).filter((e) => index.some((x) => x.exam === e)).map((e) => (
            <button key={e} className={sel + (exam === e ? on : off)} onClick={() => { setExam(e); setYear('all'); showExam(e); }}>{EXAM_NAME[e]}</button>
          ))}
        </div>
        </>}
        <div className="font-bold mb-2">年度</div>
        <div className="flex flex-wrap gap-2">
          <button className={sel + (year === 'all' ? on : off)} onClick={() => setYear('all')}>すべて</button>
          {yearsOf(exam).filter((y) => index.some((x) => x.exam === exam && x.year === y.id)).map((y) => <button key={y.id} className={sel + (year === y.id ? on : off)} onClick={() => setYear(y.id)}>{y.label}</button>)}
        </div>
        <div className="font-bold mt-5 mb-2">分野</div>
        <div className="flex flex-wrap gap-2">
          <button className={sel + (cat === 'all' ? on : off)} onClick={() => setCat('all')}>すべて</button>
          {S.categories.filter((c) => index.some((x) => x.exam === exam && x.categorySlug === c.slug)).map((c) => <button key={c.slug} className={sel + (cat === c.slug ? on : off)} onClick={() => setCat(c.slug)}>{c.icon} {c.name}</button>)}
        </div>
        <div className="font-bold mt-5 mb-2">出し方</div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => <button key={m.v} className={sel + (mode === m.v ? on : off)} title={m.hint} onClick={() => setMode(m.v)}>{m.label}</button>)}
        </div>
        <div className="text-xs text-ink-faint mt-1">{MODES.find((m) => m.v === mode)?.hint}</div>
      </div>
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div className="serif text-3xl">{limit ? Math.min(limit, filtered.length) : filtered.length}<span className="text-base text-ink-soft"> 問</span></div>
        <button className="btn btn-primary text-lg px-8" disabled={filtered.length === 0} onClick={start}>演習を始める</button>
        {filtered.length === 0 && <span className="text-sm text-ink-soft">この条件に当てはまる問題はありません。</span>}
      </div>
    </div>
  );
}
