import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Exam, Question, QuestionIndex, Site } from '../../lib/types';
import { showExam } from '../../lib/examui';
import { $progress, $bookmarks, isWeak, needsReview, toggleBookmark } from '../../store/progress';
import QuestionCard from './QuestionCard';

// 演習画面。条件を選ぶ → 1問ずつ解く → 結果、の3画面。
// 問題本文は /data/q/<id>.json を1問ずつ取りに行く（全問を最初に読むと数MBになるため）。

const S = siteJson as unknown as Site;
const EXAM_NAME: Record<Exam, string> = { shi: '宅建', hoshi: '（未使用）' };
const yearsOf = (e: Exam) => (e === 'hoshi' ? S.hoshiYears : S.years);
type Mode = 'order' | 'random' | 'unanswered' | 'miss' | 'wrong' | 'weak' | 'bookmark';
// 画面の札は order・random・unanswered・miss の4つと ★印の1行。
// wrong・weak・bookmark は成績表・弱点まとめのリンク（?mode=）から来た時だけ使う。数がずれないよう絞り方は前と同じ。
const MODE_LABEL: Record<Mode, string> = {
  order: '最初から順に', random: 'ランダム', unanswered: 'まだ解いていない', miss: '間違えた問題',
  wrong: '前回不正解', weak: '要復習', bookmark: '★印の問題',
};
const URL_MODES: Mode[] = ['order', 'random', 'unanswered', 'miss', 'wrong', 'weak', 'bookmark'];
// 年度の短い名前（R3.12 → R3 12月）
const shortYear = (s: string) => { const [m, sub] = s.split('.'); return sub ? `${m} ${sub}月` : m; };

// 途中の回（「終了」した・閉じた）。次に開いた時、4枚の札の上に「前回の続き」を出す。全部解き終えたら消す
const NOW_KEY = 'takken_practice_now';
interface Saved { exam: Exam; mode: Mode; ids: string[]; i: number; results: Record<string, boolean>; at: number }
function loadSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(NOW_KEY) || 'null');
    if (!s || !Array.isArray(s.ids) || !s.ids.length || typeof s.results !== 'object') return null;
    if (s.ids.every((id: string) => id in s.results)) { localStorage.removeItem(NOW_KEY); return null; }
    return s;
  } catch { return null; }
}
const clearSaved = () => { try { localStorage.removeItem(NOW_KEY); } catch { /* 無くてよい */ } };

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
  // ?mode=weak などで来た時の札（go=1 が無い時に一番上に出す）
  const [fromUrl, setFromUrl] = useState<Mode | null>(null);
  // 「条件を絞る」の開け閉め（URL で年度・分野が来た時は開いておく）
  const [openF, setOpenF] = useState(false);
  const [session, setSession] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [cur, setCur] = useState<Question | null>(null);
  const [cache] = useState(() => new Map<string, Question>());
  const [finished, setFinished] = useState(false);
  // トップの「ランダム10問」用: ?n=10 で問題数を絞り、?go=1 で条件を選ばずにすぐ始める
  const [limit, setLimit] = useState(0);
  const autoGo = useRef(false);
  const urlMode = useRef<Mode>('order');
  const prog = useStore($progress);
  const bms = useStore($bookmarks);
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => {
    fetch('/data/index.json').then((r) => r.json()).then(setIndex);
    const p = new URLSearchParams(location.search);
    if (p.get('exam') === 'hoshi') setExam('hoshi');
    if (p.get('year')) setYear(p.get('year')!);
    if (p.get('cat')) setCat(p.get('cat')!);
    const m = p.get('mode') as Mode | null;
    if (m && URL_MODES.includes(m)) { setMode(m); urlMode.current = m; if (m === 'wrong' || m === 'weak' || m === 'bookmark') setFromUrl(m); }
    if (p.get('year') || p.get('cat')) setOpenF(true);
    if (Number(p.get('n')) > 0) setLimit(Number(p.get('n')));
    autoGo.current = p.get('go') === '1';
    const sv = loadSaved();
    // トップの「演習の続きがあります ›」（?resume=1）から来た時は、選ぶ画面を出さずに保存した回をそのまま開く
    if (p.get('resume') === '1' && sv) { autoGo.current = false; resume(sv); history.replaceState(null, '', location.pathname + (sv.exam === 'hoshi' ? '?exam=hoshi' : '')); }
    else setSaved(sv);
  }, []);
  // 解いている回を保存（全部答えたら消す）
  useEffect(() => {
    if (!session) return;
    if (session.every((id) => id in results)) { clearSaved(); return; }
    try { localStorage.setItem(NOW_KEY, JSON.stringify({ exam, mode, ids: session, i, results, at: Date.now() })); } catch { /* 保存できなくても解ける */ }
  }, [session, i, results]);
  const resume = (sv: Saved) => {
    if (sv.exam !== exam) { setExam(sv.exam); showExam(sv.exam); }
    // 開く問題：保存した位置から先の最初の未回答（無ければ最初の未回答）
    let k = sv.ids.findIndex((id, n) => n >= sv.i && !(id in sv.results));
    if (k < 0) k = sv.ids.findIndex((id) => !(id in sv.results));
    setMode(sv.mode); setSession(sv.ids); setI(Math.max(0, k)); setResults(sv.results); setFinished(false); setSaved(null);
    window.scrollTo(0, 0);
  };

  // 年度・分野で絞った問題（出し方の前）
  const base = useMemo(() => (index ?? []).filter((x) =>
    x.exam === exam && (year === 'all' || x.year === year) && (cat === 'all' || x.categorySlug === cat)), [index, exam, year, cat]);
  const pick = (m: Mode) => base.filter((x) =>
    m === 'unanswered' ? !prog[x.id]?.answered
    : m === 'miss' ? needsReview(prog[x.id])
    : m === 'wrong' ? !!prog[x.id]?.answered && !prog[x.id]?.correct
    : m === 'weak' ? isWeak(prog[x.id])
    : m === 'bookmark' ? bms.includes(x.id)
    : true);
  // ランダムは問題数の指定が無ければ10問
  const sizeOf = (m: Mode, n: number) => (m === 'random' ? Math.min(limit || 10, n) : limit ? Math.min(limit, n) : n);

  const start = (m: Mode = mode) => {
    let ids = pick(m).map((x) => x.id);
    if (m === 'random') ids = shuffle(ids);
    ids = ids.slice(0, sizeOf(m, ids.length));
    if (!ids.length) return;
    setMode(m); setSession(ids); setI(0); setResults({}); setFinished(false); setSaved(null);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (index && autoGo.current) { autoGo.current = false; start(urlMode.current); }
  }, [index]);
  useEffect(() => {
    if (!index) return;
    if (year !== 'all' && !index.some((x) => x.exam === exam && x.year === year)) setYear('all');
    if (cat !== 'all' && !index.some((x) => x.exam === exam && x.categorySlug === cat)) setCat('all');
  }, [index, exam, year, cat]);
  const quit = () => { setSession(null); setCur(null); setFinished(false); setSaved(loadSaved()); };

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
    const again = sizeOf(mode, pick(mode).length);
    return (
      <div className="space-y-5">
        <div className="card p-6 text-center">
          <div className="eyebrow mb-2">結果</div>
          <div className="serif text-5xl text-moss-deep">{correct}<span className="text-2xl text-ink-soft"> / {done.length}</span></div>
          <div className="text-ink-soft mt-1">正答率 {done.length ? Math.round((correct / done.length) * 100) : 0}%{done.length < session.length && `（${session.length}問中 ${done.length}問を解答）`}</div>
          {(mode === 'miss' || mode === 'weak') && <p className="text-ink-soft mt-1">2回続けて正解すると、間違えた問題から外れます。</p>}
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <button className="btn btn-primary" disabled={!again} onClick={() => start(mode)}>{again ? `同じ条件でもう一度（${again}問）` : 'この条件の問題はもうありません'}</button>
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
          <button type="button" className={'btn btn-ghost btn-sm' + (marked ? ' text-shu border-shu' : '')} onClick={() => toggleBookmark(id)}>{marked ? '★ 印をつけた' : '☆ 印をつける'}</button>
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
  // 押せばすぐ始まる4枚。年度・分野・問題数は「条件を絞る」の中（試験は左の欄で決まる）
  const sel = 'px-3 py-1.5 rounded-dojo border text-sm cursor-pointer transition ';
  const on = 'bg-moss text-white border-moss';
  const off = 'bg-card border-line hover:border-ink-faint';
  const title = EXAM_NAME[exam].replace(/（.*）/, '');
  const other: Exam = exam === 'shi' ? 'hoshi' : 'shi';
  const hasOther = index.some((x) => x.exam === other);
  const years = yearsOf(exam).filter((y) => index.some((x) => x.exam === exam && x.year === y.id));
  const cats = S.categories.filter((c) => index.some((x) => x.exam === exam && x.categorySlug === c.slug));
  const yName = years.find((y) => y.id === year);
  const cName = cats.find((c) => c.slug === cat);
  const parts = [yName && yName.label, cName && cName.name, limit > 0 && `${limit}問ずつ`].filter(Boolean);
  const cards: { m: Mode; icon: string; label: string; sub: string }[] = [
    { m: 'order', icon: '▶', label: MODE_LABEL.order, sub: '年度・問番号の順に' },
    { m: 'random', icon: '🎲', label: `ランダム${limit || 10}問`, sub: yName || cName ? '絞った中から' : 'すべての年度から' },
    { m: 'unanswered', icon: '✏️', label: MODE_LABEL.unanswered, sub: 'はじめて解く問題' },
    { m: 'miss', icon: '❗', label: MODE_LABEL.miss, sub: '前回不正解と要復習' },
  ];
  const nBm = pick('bookmark').length;
  const nUrl = fromUrl ? sizeOf(fromUrl, pick(fromUrl).length) : 0;
  return (
    <div className="space-y-4">
      <div className="card p-5">
        {/* 試験は左の欄で決まる。スマホでは左の欄が畳まれているので、ここでも切り替えられるように */}
        {hasOther && (
          <div className="lg:hidden flex flex-wrap items-baseline justify-between gap-2 mb-3 text-sm">
            <span className="font-bold">{title}の問題から出します</span>
            <button type="button" className="text-moss underline" onClick={() => { setExam(other); setYear('all'); showExam(other); }}>{EXAM_NAME[other].replace(/（.*）/, '')}に切り替える</button>
          </div>
        )}

        {saved && (() => { const left = saved.ids.filter((id) => !(id in saved.results)).length; const done = saved.ids.length - left; return (
          <div className="mb-3 rounded-dojo border-2 border-moss bg-moss-pale px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1">
              <b className="block">前回の続き（残り {left}問）</b>
              <span className="block text-xs text-ink-soft mt-0.5">{saved.exam !== exam ? EXAM_NAME[saved.exam].replace(/（.*）/, '') + '・' : ''}{MODE_LABEL[saved.mode]}・{saved.ids.length}問中 {done}問 解答済み</span>
            </span>
            <button type="button" className="btn btn-primary" onClick={() => resume(saved)}>続きから解く</button>
          </div>
        ); })()}

        {fromUrl && (
          <button type="button" disabled={!nUrl} onClick={() => start(fromUrl)}
            className="w-full mb-3 rounded-dojo bg-moss text-white px-4 py-3.5 text-left font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed">
            {nUrl ? `${cName ? cName.name + 'の' : ''}${MODE_LABEL[fromUrl]} ${nUrl}問を解く →` : `${cName ? cName.name + 'の' : ''}${MODE_LABEL[fromUrl]}はいまはありません`}
          </button>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {cards.map(({ m, icon, label, sub }) => {
            const n = sizeOf(m, pick(m).length);
            return (
              <button key={m} type="button" disabled={!n} onClick={() => start(m)}
                className="flex items-center justify-between gap-3 text-left rounded-dojo border border-line bg-card px-4 py-3 transition hover:border-moss hover:bg-moss-pale disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-card">
                <span className="min-w-0">
                  <b className="block text-[.95rem]">{icon} {label}</b>
                  <span className="block text-xs text-ink-soft mt-0.5">{n ? sub : 'いまはありません'}</span>
                </span>
                <span className="serif text-xl font-bold text-moss-deep shrink-0">{n}<small className="text-xs text-ink-soft font-normal"> 問</small></span>
              </button>
            );
          })}
        </div>
        {nBm > 0 && fromUrl !== 'bookmark' && (
          <button type="button" className="mt-2.5 text-sm text-ink-soft underline" onClick={() => start('bookmark')}>★印の問題を解く（{sizeOf('bookmark', nBm)}問）</button>
        )}

        <details className="mt-4 border-t border-line pt-3" open={openF} onToggle={(e) => setOpenF((e.target as HTMLDetailsElement).open)}>
          <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer text-sm font-bold text-moss select-none">
            {parts.length ? `条件：${parts.join('・')}` : '条件を絞る（年度・分野・問題数）'} <span className="text-xs">{openF ? '▲' : '▼'}</span>
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-xs font-bold text-ink-soft mb-1.5">年度</div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={sel + (year === 'all' ? on : off)} onClick={() => setYear('all')}>すべて</button>
                {years.map((y) => <button type="button" key={y.id} title={y.label} className={sel + (year === y.id ? on : off)} onClick={() => setYear(y.id)}>{shortYear(y.short)}</button>)}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-ink-soft mb-1.5">分野</div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={sel + (cat === 'all' ? on : off)} onClick={() => setCat('all')}>すべて</button>
                {cats.map((c) => <button type="button" key={c.slug} className={sel + (cat === c.slug ? on : off)} onClick={() => setCat(c.slug)}>{c.icon} {c.name}</button>)}
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-ink-soft mb-1.5">1回の問題数</div>
              <div className="flex flex-wrap gap-1.5">
                {[0, 10, 20, 30].map((n) => <button type="button" key={n} className={sel + (limit === n ? on : off)} onClick={() => setLimit(n)}>{n ? `${n}問` : '指定なし'}</button>)}
              </div>
              <div className="text-xs text-ink-faint mt-1">指定なしの時、ランダムは10問・ほかは当てはまる問題を全部出します。</div>
            </div>
            {(() => { const m: Mode = fromUrl ?? 'order'; const k = sizeOf(m, pick(m).length); return <button type="button" className="btn btn-primary" disabled={!k} onClick={() => start(m)}>{fromUrl ? `この条件の${MODE_LABEL[m]} ${k}問を解く` : `この条件の全${k}問を順に解く`}</button>; })()}
          </div>
        </details>
        {base.length === 0 && <p className="text-sm text-ink-soft mt-3">この条件に当てはまる問題はありません。</p>}
      </div>
    </div>
  );
}
