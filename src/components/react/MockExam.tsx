import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Question, Site } from '../../lib/types';
import { $progress, isWeak, recordAnswer, type Progress, needsReview } from '../../store/progress';

// 模擬試験。年度を選んで、その年度の問題を順に、本番と同じ時間で解き、最後にまとめて採点する（無料で何回でも）。
// 「間違えた問題だけ」も無料（直近で不正解を先に、その中で古い順に）。新しい問題は作らない。

const S = siteJson as unknown as Site;
// 本番の形（宅建: 50問・2時間・1問1点。合格点は年度ごとに発表されるので数字は持たない）
const CONF = {
  name: '宅建', minutes: 120, choices: 4, choicePt: 1, tashiPt: 0, kijutsuPt: 0, totalRatio: 0,
  parts: [] as { name: string; cats: string[]; include: boolean; ratio: number }[],
  modelLabel: '', selectNote: '', countNote: '',
  // 免除科目（問46〜50）は番号ごとに中身が決まっている。統計（問48）は古い数字になるので最新の年度だけ
  byNum: ['menjo'], latestOnlyNums: [48],
  line: '本番は50問・2時間・1問1点。合格点は年度により異なります（公表は試験の後）。',
};
const FULL = 50; // 本番の問題数（時間はこの割合で）
// その年度の合格点（不動産適正取引推進機構の発表）
const PASSMARK: Record<string, number> = { r07: 33, r06: 37, r05: 36, r04: 36, 'r03-12': 34, 'r03-10': 34, 'r02-12': 36, 'r02-10': 38, r01: 35, h30: 37, h29: 35, h28: 35, h27: 31 };
const KEY = 'takken_mogi_now';
// 選んだ肢（正誤はまだ出さない）。スマホでも選んだと分かるように濃く（外に2pxの枠・太字）
const PICKED = { borderColor: 'var(--color-ai)', background: 'var(--color-ai-pale)', boxShadow: '0 0 0 2px var(--color-ai)', fontWeight: 700 };

type Kind = 'choice' | 'tashi' | 'kijutsu';
// /data/mogi.json の1行（本文は含まない軽い一覧）
interface Slim { id: string; year: string; num: number; cat: string; kind: Kind }
interface Slot { cat: string; kind: Kind; num: number }
type Ans = number | Record<string, number> | string;
interface Run { cat: string; ids: string[]; answers: Record<string, Ans>; self: Record<string, number>; start: number; limit: number }

const kindOf = (q: Question): Kind => ((q as { kind?: Kind }).kind ?? 'choice');
const blanksOf = (q: Question) => ((q as { blanks?: Record<string, number> }).blanks ?? {});
const wordsOf = (q: Question) => ((q as { words?: { key: string; text: string }[] }).words ?? []);
const modelOf = (q: Question) => ((q as { modelAnswer?: string }).modelAnswer ?? '');

function shuffle<T>(a: T[]) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
function tier(prog: Progress, id: string) {
  const r = prog[id];
  if (r?.answered && !r.correct) return 0;
  if (isWeak(r)) return 1;
  if (!r?.answered) return 2;
  return 3;
}
// 本番の分野の並び = 最新の1回分（年度の並びは site.json の years の順。令和2・3年の10月/12月も別の回）
function slotsOf(index: Slim[]) {
  const latest = S.years.map((y) => y.id).find((y) => index.some((x) => x.year === y))!;
  return index.filter((x) => x.year === latest).sort((a, b) => a.num - b.num).map((x): Slot => ({ cat: x.cat, kind: x.kind, num: x.num }));
}
const latestYear = (index: Slim[]) => S.years.map((y) => y.id).find((y) => index.some((x) => x.year === y))!;
function buildRun(index: Slim[], prog: Progress, cat: string): Run {
  const all = slotsOf(index);
  // 年度ごと（無料）: その年度の問題を順に、本番と同じ時間で
  if (cat.startsWith('y:')) {
    const ids = index.filter((x) => x.year === cat.slice(2)).sort((a, b) => a.num - b.num).map((x) => x.id);
    return { cat, ids, answers: {}, self: {}, start: Date.now(), limit: Math.round((CONF.minutes * 60 * ids.length) / FULL) };
  }
  // 間違えた問題だけ（無料）: 直近で不正解を先に、その中で古い順に、本番の問題数まで
  if (cat === 'weak') {
    const ids = shuffle(index.filter((x) => needsReview(prog[x.id])))
      .sort((a, b) => tier(prog, a.id) - tier(prog, b.id) || (prog[a.id]?.at ?? 0) - (prog[b.id]?.at ?? 0)).slice(0, all.length).map((x) => x.id);
    return { cat, ids, answers: {}, self: {}, start: Date.now(), limit: Math.round((CONF.minutes * 60 * ids.length) / all.length) };
  }
  const slots = cat === 'all' ? all : all.filter((s) => s.cat === cat);
  const used = new Set<string>();
  const ids = slots.map((s) => {
    let pool = index.filter((x) => x.cat === s.cat && x.kind === s.kind && !used.has(x.id) &&
      (!CONF.byNum.includes(s.cat) || x.num === s.num) && (!CONF.latestOnlyNums.includes(s.num) || !CONF.byNum.includes(s.cat) || x.year === latestYear(index)));
    if (!pool.length) pool = index.filter((x) => x.kind === s.kind && !used.has(x.id));
    pool = shuffle(pool);
    pool.sort((a, b) => tier(prog, a.id) - tier(prog, b.id) || (prog[a.id]?.at ?? 0) - (prog[b.id]?.at ?? 0));
    used.add(pool[0].id);
    return pool[0].id;
  });
  const limit = Math.round((CONF.minutes * 60 * slots.length) / all.length);
  return { cat, ids, answers: {}, self: {}, start: Date.now(), limit };
}
const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// 1問の満点と得点（記述は自己採点が済むまで null）
function maxOf(q: Question) {
  const k = kindOf(q);
  return k === 'tashi' ? Object.keys(blanksOf(q)).length * CONF.tashiPt : k === 'kijutsu' ? CONF.kijutsuPt : CONF.choicePt;
}
function ptsOf(q: Question, a: Ans | undefined, self: number | undefined): number | null {
  const k = kindOf(q);
  if (k === 'kijutsu') return self ?? null;
  if (k === 'tashi') {
    const b = blanksOf(q); const m = (a && typeof a === 'object') ? a : {};
    return Object.keys(b).filter((x) => m[x] === b[x]).length * CONF.tashiPt;
  }
  const ok = q.ok?.length ? q.ok : [q.answer];
  return typeof a === 'number' && ok.includes(a) ? CONF.choicePt : 0;
}
const answered = (q: Question | undefined, a: Ans | undefined) => {
  if (a === undefined || !q) return false;
  if (typeof a === 'number') return true;
  if (typeof a === 'string') return a.trim().length > 0;
  return Object.keys(a).length > 0;
};

export default function MockExam() {
  const [index, setIndex] = useState<Slim[] | null>(null);
  const [cat, setCat] = useState('all');
  const [run, setRun] = useState<Run | null>(null);
  // 途中で閉じた回（すぐには再開せず、先に「前回の続き」の札を出す）
  const [pending, setPending] = useState<Run | null>(null);
  const [i, setI] = useState(0);
  const [qs, setQs] = useState<Record<string, Question>>({});
  const [graded, setGraded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const prog = useStore($progress);

  useEffect(() => {
    fetch('/data/mogi.json').then((r) => r.json()).then(setIndex);
    const sp = new URLSearchParams(location.search);
    if (sp.get('range') === 'weak') setCat('weak');
    if (sp.get('year')) setCat('y:' + sp.get('year'));
    // 途中で閉じた回があれば続きから（前の作りの「分野の回・全問の回」は続きが無いので捨てる）
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      // すぐには再開せず、先に「前回の続き」の札を出して選ばせる
      if (saved?.ids && (saved.cat === 'weak' || String(saved.cat).startsWith('y:'))) { setPending({ self: {}, ...saved }); setCat(saved.cat); }
      else if (saved) localStorage.removeItem(KEY);
    } catch { /* 無ければ新しく */ }
  }, []);
  // 解いている間だけ印を付ける（下の案内を隠す）
  useEffect(() => {
    const on = !!run && !graded;
    if (on) document.documentElement.dataset.mogi = ''; else delete document.documentElement.dataset.mogi;
    return () => { delete document.documentElement.dataset.mogi; };
  }, [run, graded]);
  useEffect(() => { if (run && !graded) try { localStorage.setItem(KEY, JSON.stringify(run)); } catch { /* 保存できなくても続けられる */ } }, [run, graded]);
  useEffect(() => {
    if (!run || graded) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run, graded]);
  useEffect(() => {
    if (!run) return;
    for (const id of run.ids) if (!qs[id]) fetch(`/data/q/${id}.json`).then((r) => r.json()).then((q: Question) => setQs((m) => ({ ...m, [id]: q })));
  }, [run]);

  const remain = run ? Math.max(0, Math.round((run.start + run.limit * 1000 - now) / 1000)) : 0;
  useEffect(() => { if (run && !graded && remain === 0 && run.ids.every((id) => qs[id])) grade(); }, [remain, qs]);

  const cats = useMemo(() => (index ? S.categories.filter((c) => slotsOf(index).some((s) => s.cat === c.slug)) : []), [index]);
  if (!index) return <div className="card p-6 text-ink-soft">読み込み中…</div>;

  const ys = S.years.filter((y) => index.some((x) => x.year === y.id));
  // 選んでいる物（年度が未選択なら最新の年度）
  const cc = cat === 'weak' || (cat.startsWith('y:') && ys.some((y) => 'y:' + y.id === cat)) ? cat : 'y:' + ys[0].id;
  const resume = (r: Run) => { setPending(null); setRun(r); setI(0); setGraded(false); setNow(Date.now()); window.scrollTo(0, 0); };
  const leftOf = (r: Run) => Math.max(0, Math.round((r.start + r.limit * 1000 - Date.now()) / 1000));
  const begin = () => {
    setPending(null);
    setRun(buildRun(index, prog, cc)); setI(0); setGraded(false); setNow(Date.now()); window.scrollTo(0, 0);
  };
  function grade() {
    if (!run) return;
    for (const id of run.ids) {
      const a = run.answers[id]; const q = qs[id];
      if (!q || !answered(q, a)) continue;
      const k = kindOf(q);
      if (k === 'choice' && typeof a === 'number') recordAnswer(id, a, q.answer, q.ok?.length ? q.ok : [q.answer]);
      if (k === 'tashi') {
        const n = Object.keys(blanksOf(q)).length;
        recordAnswer(id, (ptsOf(q, a, undefined) ?? 0) / CONF.tashiPt, n, [n]);
      }
      // 記述は自己採点のときに記録する
    }
    setGraded(true);
    try { localStorage.removeItem(KEY); } catch { /* 無くてよい */ }
    window.scrollTo(0, 0);
  }
  const selfGrade = (id: string, v: number) => {
    if (!run) return;
    setRun({ ...run, self: { ...run.self, [id]: v } });
    // 成績表は 2＝書けた・1＝一部・0＝書けなかった（問題ページの自己採点と同じ）
    recordAnswer(id, v === CONF.kijutsuPt ? 2 : v > 0 ? 1 : 0, 2, [2]);
  };
  const quit = () => { setRun(null); setGraded(false); try { localStorage.removeItem(KEY); } catch { /* 無くてよい */ } };

  // ---------- 採点 ----------
  if (run && graded) {
    const rows = run.ids.map((id) => { const q = qs[id]; return { id, q, max: q ? maxOf(q) : 0, pts: q ? ptsOf(q, run.answers[id], run.self[id]) : 0 }; });
    const sum = (rs: typeof rows) => ({ pts: rs.reduce((s, r) => s + (r.pts ?? 0), 0), max: rs.reduce((s, r) => s + r.max, 0) });
    const total = sum(rows);
    const pending = rows.filter((r) => r.pts === null).length;
    const full = run.cat.startsWith('y:');
    const yName = full ? ys.find((y) => 'y:' + y.id === run.cat)?.label ?? '' : '間違えた問題の解き直し';
    const parts = CONF.parts.map((p) => ({ ...p, ...sum(rows.filter((r) => r.q && p.cats.includes(r.q.categorySlug) === p.include)) })).filter((p) => p.max > 0);
    const passTotal = total.max > 0 && total.pts / total.max >= CONF.totalRatio;
    const passParts = parts.every((p) => p.pts / p.max >= p.ratio);
    const byCat = S.categories.map((c) => ({ c, ...sum(rows.filter((r) => r.q?.categorySlug === c.slug)) })).filter((r) => r.max > 0);
    const kij = rows.filter((r) => r.q && kindOf(r.q) === 'kijutsu');
    return (
      <div className="space-y-5">
        <div className="card p-6 text-center">
          <div className="eyebrow mb-2">{CONF.name} {yName}の結果</div>
          <div className="serif text-5xl text-moss-deep">{total.pts}<span className="text-2xl text-ink-soft"> / {total.max}点</span></div>
          <div className="text-ink-soft mt-1">{run.ids.length}問</div>
          {parts.length > 1 && (
            <div className="flex flex-wrap justify-center gap-4 mt-2 text-sm">
              {parts.map((p) => <span key={p.name}>{p.name} <b>{p.pts}</b> / {p.max}点</span>)}
            </div>
          )}
          {full && PASSMARK[run.cat.slice(2)] !== undefined && (
            <div className={'inline-block mt-3 px-4 py-2 rounded-dojo font-bold ' + (total.pts >= PASSMARK[run.cat.slice(2)] ? 'bg-moss-pale text-moss-deep' : 'bg-shu-pale text-shu')}>
              この年度の合格点は {PASSMARK[run.cat.slice(2)]}点{total.pts >= PASSMARK[run.cat.slice(2)] ? '。届いています' : `。あと ${PASSMARK[run.cat.slice(2)] - total.pts}点`}
            </div>
          )}
          {pending > 0 && <p className="text-sm text-shu mt-2">記述 {pending}問 の自己採点がまだです（下で採点すると点数に入ります）。</p>}
          {full && CONF.totalRatio > 0 && pending === 0 && (
            <div className={'inline-block mt-3 px-4 py-2 rounded-dojo font-bold ' + (passTotal && passParts ? 'bg-moss-pale text-moss-deep' : 'bg-shu-pale text-shu')}>
              {passTotal && passParts ? '基準の目安に届いています' : '基準の目安に届いていません'}
            </div>
          )}
          <p className="text-xs text-ink-faint mt-2">{CONF.line} {full ? 'その年度の問題を本番と同じ時間の割合で解いた結果です。' : '過去問の組み直しなので、本番の点数を約束するものではありません。'}</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <button className="btn btn-primary" onClick={quit}>ほかの年度を解く</button>
            {total.pts < total.max && <button className="btn btn-ghost" onClick={() => { quit(); setCat('weak'); }}>間違えた問題を解き直す</button>}
            <a className="btn btn-ghost" href="/progress/">成績表を見る</a>
          </div>
        </div>
        {kij.length > 0 && (
          <div className="card p-5 space-y-5">
            <h2 className="text-lg">記述式の自己採点</h2>
            {kij.map(({ id, q }) => (
              <div key={id} className="border-t border-line pt-4 first:border-0 first:pt-0">
                <div className="text-sm font-bold mb-1"><a href={q!.url}>{q!.yearLabel} 第{q!.num}問</a></div>
                <div className="text-sm bg-paper rounded-dojo px-3 py-2 mb-2 whitespace-pre-wrap"><span className="text-ink-faint">あなたの答え：</span>{(run.answers[id] as string) || '（未記入）'}</div>
                <div className="qhtml"><div className="keybox text-[.95rem]"><b>{CONF.modelLabel}</b><br />{modelOf(q!).split(/(?=正解例\d)/).map((s, k) => <div key={k}>{s}</div>)}</div></div>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
                  <span className="font-bold">自分で採点：</span>
                  {[[CONF.kijutsuPt, '◎ 要点は書けた'], [CONF.kijutsuPt / 2, '△ 一部書けた'], [0, '× 書けなかった']].map(([v, l]) => (
                    <button key={v} type="button" className="btn btn-ghost btn-sm" style={run.self[id] === v ? PICKED : undefined} onClick={() => selfGrade(id, v as number)}>{l}（{v}点）</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="card p-5">
          <h2 className="text-lg mb-3">分野別</h2>
          <div className="space-y-2">
            {byCat.map(({ c, pts, max }) => (
              <div key={c.slug} className="grid grid-cols-[8.5rem_1fr_5rem] items-center gap-3 text-sm">
                <span>{c.icon} {c.name}</span>
                <div className="bar"><i style={{ width: (pts / max) * 100 + '%' }} /></div>
                <span className="text-right text-ink-soft">{pts}/{max}点</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-lg mb-3">1問ずつ（解説は問題のページで）</h2>
          <ul className="divide-y divide-line">
            {rows.map(({ id, q, pts, max }, k) => {
              const a = run.answers[id];
              const kd = q ? kindOf(q) : 'choice';
              const mark = pts === null ? '…' : pts === max ? '○' : pts > 0 ? '△' : '×';
              const tm = (a && typeof a === 'object') ? a : {};
              const detail = !q ? '' : kd === 'choice' ? `あなた ${typeof a === 'number' ? a : '—'} ／ 正解 ${(q.ok?.length ? q.ok : [q.answer]).join('・')}`
                : kd === 'tashi' ? Object.entries(blanksOf(q)).map(([b, v]) => `${b}: あなた ${tm[b] ?? '—'}${tm[b] === v ? '○' : ''} ／ 正解 ${v}`).join('　') + `（${pts} / ${max}点）`
                : `${pts ?? '—'} / ${max}点`;
              return (
                <li key={id} className="py-2 text-sm flex gap-3 items-baseline">
                  <span className={'w-6 shrink-0 font-bold ' + (pts === max ? 'text-moss-deep' : 'text-shu')}>{mark}</span>
                  <span className="w-10 shrink-0 text-ink-soft">{k + 1}.</span>
                  <a href={q?.url} className="shrink-0 no-underline">{q?.yearLabel} 第{q?.num}問</a>
                  <span className={'text-ink-soft min-w-0 ' + (kd === 'tashi' ? '' : 'truncate')}>{detail}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  // ---------- 受験中 ----------
  if (run) {
    const id = run.ids[i];
    const q = qs[id];
    const n = run.ids.filter((x) => answered(qs[x], run.answers[x])).length;
    const set = (v: Ans) => setRun({ ...run, answers: { ...run.answers, [id]: v } });
    const picked = run.answers[id];
    const kd = q ? kindOf(q) : 'choice';
    const tash = (picked && typeof picked === 'object') ? picked : {};
    // 次へ・番号を押したら、ページの頭でなく問題の頭へ（上の帯の下）
    const toQ = () => setTimeout(() => { const el = document.getElementById('mogi-q'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 130); }, 0);
    return (
      <div className="space-y-4">
        <div className="card px-3 py-2 md:px-4 md:py-3 flex items-center gap-3 text-sm sticky top-14 md:top-16 z-10">
          <span className="serif text-lg">{i + 1} <span className="text-ink-faint text-sm">/ {run.ids.length}</span></span>
          <span className="text-ink-soft text-xs leading-tight">{run.cat === 'weak' ? '間違えた問題' : ys.find((y) => 'y:' + y.id === run.cat)?.label}<span className="hidden sm:inline">・解答済み {n}</span></span>
          <span className={'ml-auto font-mono text-base ' + (remain < 600 ? 'text-shu font-bold' : '')}>残り {fmt(remain)}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { if (n === run.ids.length || confirm(`まだ ${run.ids.length - n}問 答えていません。採点しますか？`)) grade(); }}>採点する</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {run.ids.map((x, k) => (
            <button key={x} type="button" onClick={() => { setI(k); toQ(); }}
              className={'min-w-10 h-10 px-1 text-sm rounded-dojo border ' + (k === i ? 'border-moss font-bold ' : 'border-line ') + (answered(qs[x], run.answers[x]) ? 'bg-moss text-white border-moss' : 'bg-card')}>{k + 1}</button>
          ))}
        </div>
        {q ? (
          <article id="mogi-q" className="card p-5 md:p-7">
            <div className="text-xs text-ink-faint mb-2">第{i + 1}問 ・ {q.categoryIcon} {q.category}{kd === 'tashi' ? '（多肢選択式）' : kd === 'kijutsu' ? '（記述式）' : ''}（出典は採点のあとに出ます）</div>
            <div className="qhtml">
              <p className="text-[1.04rem]" dangerouslySetInnerHTML={{ __html: q.statementHtml }} />
              {q.tablesHtml.map((t, k) => <div key={k} dangerouslySetInnerHTML={{ __html: t }} />)}
              {q.figure?.essential && <img src={q.figure.src} alt={`第${i + 1}問の図表`} className="my-3 max-w-full h-auto border border-line rounded-dojo bg-white" />}
              {q.items.length > 0 && (
                <div className="my-3 space-y-1.5">
                  {q.items.map((it) => (
                    <div key={it.key} className="flex gap-2 px-3 py-2 bg-paper rounded-dojo text-[.97rem] text-ink-soft">
                      <b className="text-ink shrink-0">{it.key}．</b><span dangerouslySetInnerHTML={{ __html: it.html }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4">
              {kd === 'choice' && q.choiceStyle === 'sentence' && q.choices.map((c) => (
                <button key={c.key} type="button" className="choice" style={picked === c.value ? PICKED : undefined} onClick={() => set(c.value)}>
                  <span className="mark">{picked === c.value ? '●' : ''}</span>
                  <span><b className="mr-1">{c.key}．</b><span dangerouslySetInnerHTML={{ __html: c.html }} /></span>
                </button>
              ))}
              {kd === 'choice' && q.choiceStyle === 'combo' && (
                <div className="flex flex-wrap">
                  {q.choices.map((c) => (
                    <button key={c.key} type="button" className="choice choice-combo" style={picked === c.value ? PICKED : undefined} onClick={() => set(c.value)}>
                      <span className="mark">{picked === c.value ? '●' : ''}</span>
                      <span><b className="mr-1">{c.key}.</b><span dangerouslySetInnerHTML={{ __html: c.html }} /></span>
                    </button>
                  ))}
                </div>
              )}
              {kd === 'choice' && q.choiceStyle === 'none' && (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: CONF.choices }, (_, k) => k + 1).map((v) => <button key={v} type="button" className="choice choice-num" style={picked === v ? PICKED : undefined} onClick={() => set(v)}>{v}</button>)}
                </div>
              )}
              {kd === 'tashi' && (
                <div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[.93rem] bg-paper rounded-dojo px-3 py-2 mb-3">
                    {wordsOf(q).map((w) => <div key={w.key}><b className="mr-1">{w.key}</b>{w.text}</div>)}
                  </div>
                  <div className="space-y-2">
                    {Object.keys(blanksOf(q)).map((k) => (
                      <label key={k} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-dojo border border-line bg-card">
                        <span className="blank">{k}</span>
                        <select className="border border-line rounded-dojo px-2 py-1 bg-white text-sm min-w-[12rem]"
                          value={tash[k] ?? ''} onChange={(e) => { const m = { ...tash }; if (e.target.value) m[k] = Number(e.target.value); else delete m[k]; set(m); }}>
                          <option value="">選ぶ</option>
                          {wordsOf(q).map((w) => <option key={w.key} value={w.key}>{w.key}　{w.text}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {kd === 'kijutsu' && (
                <div>
                  <textarea className="w-full border border-line rounded-dojo px-3 py-2 bg-white text-[1rem] leading-relaxed" rows={3} maxLength={120}
                    placeholder="40字程度で書く（句読点も1字）" value={typeof picked === 'string' ? picked : ''} onChange={(e) => set(e.target.value)} />
                  <div className="text-sm text-ink-soft mt-1">{[...(typeof picked === 'string' ? picked : '').replace(/\s/g, '')].length}字 ・ 採点のあとに{CONF.modelLabel}と見比べて自分で採点します</div>
                </div>
              )}
            </div>
          </article>
        ) : <div className="card p-6 text-ink-soft">読み込み中…</div>}
        <div className="flex justify-between gap-3">
          <button type="button" className="btn btn-ghost flex-1" disabled={i === 0} onClick={() => { setI(i - 1); toQ(); }}>← 前の問題</button>
          <button type="button" className="btn btn-primary flex-1" disabled={i === run.ids.length - 1} onClick={() => { setI(i + 1); toQ(); }}>次の問題 →</button>
        </div>
        <div className="text-center"><button type="button" className="text-xs text-ink-faint underline" onClick={() => { if (confirm('この回をやめます（記録には残りません）。')) quit(); }}>この回をやめる</button></div>
      </div>
    );
  }

  // ---------- 年度を選ぶ ----------
  // 年度を押すと、すぐ下の「始める」が その年度に変わる（スマホでは画面の下に貼り付く）
  const MIN = CONF.minutes;
  const weakN = index.filter((x) => needsReview(prog[x.id])).length;
  const yLabel = ys.find((y) => 'y:' + y.id === cc)?.label ?? '';
  const n = cc === 'weak' ? Math.min(weakN, FULL) : index.filter((x) => 'y:' + x.year === cc).length;
  const minutes = Math.round((MIN * n) / FULL);
  const tile = 'text-left rounded-dojo border px-4 py-3 transition ';
  const on = 'bg-moss text-white border-moss';
  const off = 'bg-card border-line hover:border-ink-faint';
  const pend = pending;
  return (
    <div className="space-y-5">
      {pend && (() => { const left = leftOf(pend); const k = Object.keys(pend.answers).length; return (
        <div className="card p-5 border-2 border-moss">
          <div className="font-bold text-lg mb-1">前回の続きがあります</div>
          <p className="text-[.95rem] mb-3">{pend.cat === 'weak' ? '間違えた問題' : ys.find((y) => 'y:' + y.id === pend.cat)?.label} ・ 解答済み {k}/{pend.ids.length}問 ・ {left > 0 ? `残り ${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}` : '時間切れ（開くと採点します）'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary text-base px-6" onClick={() => resume(pend)}>続きから解く</button>
            <button type="button" className="btn btn-ghost" onClick={() => { if (confirm('前回の回をやめて、選び直します（記録には残りません）。')) { quit(); setPending(null); } }}>やめて選び直す</button>
          </div>
        </div>
      ); })()}
      <div className="card p-5">
        <div className="font-bold mb-1">年度を選ぶ</div>
        <p className="text-sm text-ink-soft mb-3">その年度の問1〜問50を順に、本番と同じ2時間で解きます。途中では正誤を出さず、最後にまとめて採点し、その年度の合格点と並べます。無料で何回でも使えます。</p>
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-3">
          {ys.map((y) => { const k = index.filter((x) => x.year === y.id).length; return (
            <button key={y.id} type="button" className={tile + (cc === 'y:' + y.id ? on : off)} onClick={() => setCat('y:' + y.id)}>
              <div className="font-bold">{y.label}</div>
              <div className="text-xs opacity-80">{k}問 ・ {Math.round((MIN * k) / FULL)}分</div>
            </button>
          ); })}
          <button type="button" className={tile + 'col-span-2 lg:col-span-3 ' + (cc === 'weak' ? on : off)} onClick={() => setCat('weak')}>
            <div className="font-bold">❗ 間違えた問題だけ</div>
            <div className="text-xs opacity-80">間違えた問題・要復習（いま {weakN}問）を、間違えた問題を先に、古い順に最大{FULL}問</div>
          </button>
        </div>
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 px-5 py-3 bg-card/95 backdrop-blur border-t border-line rounded-b-dojo flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary text-base px-6 flex-1 sm:flex-none" disabled={n === 0} onClick={begin}>
            {cc === 'weak' ? '間違えた問題' : yLabel}を始める（{n}問・{minutes}分）
          </button>
          {cc === 'weak' && n === 0 && <span className="text-sm text-ink-soft">間違えた問題はいまありません。</span>}
        </div>
      </div>
    </div>
  );
}
