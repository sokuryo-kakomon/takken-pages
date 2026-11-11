import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Question, Site } from '../../lib/types';
import { $progress, isWeak, recordAnswer, type Progress } from '../../store/progress';
import { $mogiTrial } from '../../store/drill';
import { $aiCode, checkPaid, type PaidState } from '../../store/ai';

// 模擬試験。過去問から本番と同じ分野の並び・同じ問題数・同じ時間で1回分を組み、最後にまとめて採点する。
// 中身は「間違えた問題」を優先して選ぶ（直近で不正解 → 要復習 → 未回答 → 正解済みの古い順）。
// 新しい問題は作らない（答えは不動産適正取引推進機構の発表のまま）。
// 無料は「分野を1つ選んだ短い回」を1回だけ。有料プランは全問の回も分野の回も何度でも。

const S = siteJson as unknown as Site;
// 本番の形（宅建: 50問・2時間・1問1点。合格点は年度ごとに発表されるので数字は持たない）
const CONF = {
  name: '宅建', minutes: 120, choices: 4, choicePt: 1, tashiPt: 0, kijutsuPt: 0, totalRatio: 0,
  parts: [] as { name: string; cats: string[]; include: boolean; ratio: number }[],
  modelLabel: '', selectNote: '',
  line: '本番は50問・2時間・1問1点。合格点は年度により異なります（公表は試験の後）。',
};
const KEY = 'takken_mogi_now';
const PICKED = { borderColor: 'var(--color-ai)', background: 'var(--color-ai-pale)' };

type Kind = 'choice' | 'tashi' | 'kijutsu';
// /data/mogi.json の1行（本文は含まない軽い一覧）
interface Slim { id: string; year: string; num: number; cat: string; kind: Kind }
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
  return index.filter((x) => x.year === latest).sort((a, b) => a.num - b.num).map((x) => ({ cat: x.cat, kind: x.kind }));
}
function buildRun(index: Slim[], prog: Progress, cat: string): Run {
  const all = slotsOf(index);
  const slots = cat === 'all' ? all : all.filter((s) => s.cat === cat);
  const used = new Set<string>();
  const ids = slots.map((s) => {
    let pool = index.filter((x) => x.cat === s.cat && x.kind === s.kind && !used.has(x.id));
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
  const [i, setI] = useState(0);
  const [qs, setQs] = useState<Record<string, Question>>({});
  const [graded, setGraded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [paid, setPaid] = useState<PaidState>('checking');
  const code = useStore($aiCode);
  const prog = useStore($progress);
  const trial = useStore($mogiTrial);

  useEffect(() => {
    fetch('/data/mogi.json').then((r) => r.json()).then(setIndex);
    try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved?.ids) setRun({ self: {}, ...saved }); } catch { /* 無ければ新しく */ }
  }, []);
  useEffect(() => { checkPaid(code).then(setPaid); }, [code]);
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

  const canFull = paid === 'paid';
  const canCat = paid === 'paid' || !trial.shi;
  const begin = () => {
    if (cat === 'all' ? !canFull : !canCat) return;
    if (paid !== 'paid') $mogiTrial.set({ ...$mogiTrial.get(), shi: true });
    setRun(buildRun(index, prog, cat)); setI(0); setGraded(false); setNow(Date.now()); window.scrollTo(0, 0);
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
    const full = run.cat === 'all';
    const parts = CONF.parts.map((p) => ({ ...p, ...sum(rows.filter((r) => r.q && p.cats.includes(r.q.categorySlug) === p.include)) })).filter((p) => p.max > 0);
    const passTotal = total.max > 0 && total.pts / total.max >= CONF.totalRatio;
    const passParts = parts.every((p) => p.pts / p.max >= p.ratio);
    const byCat = S.categories.map((c) => ({ c, ...sum(rows.filter((r) => r.q?.categorySlug === c.slug)) })).filter((r) => r.max > 0);
    const kij = rows.filter((r) => r.q && kindOf(r.q) === 'kijutsu');
    return (
      <div className="space-y-5">
        <div className="card p-6 text-center">
          <div className="eyebrow mb-2">{CONF.name} 模擬試験の結果</div>
          <div className="serif text-5xl text-moss-deep">{total.pts}<span className="text-2xl text-ink-soft"> / {total.max}点</span></div>
          <div className="text-ink-soft mt-1">{run.ids.length}問</div>
          {parts.length > 1 && (
            <div className="flex flex-wrap justify-center gap-4 mt-2 text-sm">
              {parts.map((p) => <span key={p.name}>{p.name} <b>{p.pts}</b> / {p.max}点</span>)}
            </div>
          )}
          {pending > 0 && <p className="text-sm text-shu mt-2">記述 {pending}問 の自己採点がまだです（下で採点すると点数に入ります）。</p>}
          {full && CONF.totalRatio > 0 && pending === 0 && (
            <div className={'inline-block mt-3 px-4 py-2 rounded-dojo font-bold ' + (passTotal && passParts ? 'bg-moss-pale text-moss-deep' : 'bg-shu-pale text-shu')}>
              {passTotal && passParts ? '基準の目安に届いています' : '基準の目安に届いていません'}
            </div>
          )}
          <p className="text-xs text-ink-faint mt-2">{CONF.line} 過去問の組み直しなので、本番の点数を約束するものではありません。</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <button className="btn btn-primary" onClick={quit}>もう1回分つくる</button>
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
              const detail = !q ? '' : kd === 'choice' ? `あなた ${typeof a === 'number' ? a : '—'} ／ 正解 ${(q.ok?.length ? q.ok : [q.answer]).join('・')}`
                : `${pts ?? '—'} / ${max}点`;
              return (
                <li key={id} className="py-2 text-sm flex gap-3 items-baseline">
                  <span className={'w-6 shrink-0 font-bold ' + (pts === max ? 'text-moss-deep' : 'text-shu')}>{mark}</span>
                  <span className="w-10 shrink-0 text-ink-soft">{k + 1}.</span>
                  <a href={q?.url} className="shrink-0 no-underline">{q?.yearLabel} 第{q?.num}問</a>
                  <span className="text-ink-soft min-w-0 truncate">{detail}</span>
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
    return (
      <div className="space-y-4">
        <div className="card px-4 py-3 flex flex-wrap items-center gap-3 text-sm sticky top-16 z-10">
          <span className="serif text-lg">{i + 1} <span className="text-ink-faint text-sm">/ {run.ids.length}</span></span>
          <span className="text-ink-soft">解答済み {n}</span>
          <span className={'ml-auto font-mono text-base ' + (remain < 600 ? 'text-shu font-bold' : '')}>残り {fmt(remain)}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { if (n === run.ids.length || confirm(`まだ ${run.ids.length - n}問 答えていません。採点しますか？`)) grade(); }}>採点する</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {run.ids.map((x, k) => (
            <button key={x} type="button" onClick={() => { setI(k); window.scrollTo(0, 0); }}
              className={'w-8 h-8 text-xs rounded-dojo border ' + (k === i ? 'border-moss font-bold ' : 'border-line ') + (answered(qs[x], run.answers[x]) ? 'bg-moss-pale' : 'bg-card')}>{k + 1}</button>
          ))}
        </div>
        {q ? (
          <article className="card p-5 md:p-7">
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
          <button type="button" className="btn btn-ghost flex-1" disabled={i === 0} onClick={() => { setI(i - 1); window.scrollTo(0, 0); }}>← 前の問題</button>
          <button type="button" className="btn btn-ghost flex-1" disabled={i === run.ids.length - 1} onClick={() => { setI(i + 1); window.scrollTo(0, 0); }}>次の問題 →</button>
        </div>
        <div className="text-center"><button type="button" className="text-xs text-ink-faint underline" onClick={() => { if (confirm('この回をやめます（記録には残りません）。')) quit(); }}>この回をやめる</button></div>
      </div>
    );
  }

  // ---------- 条件選択 ----------
  const sel = 'px-3 py-1.5 rounded-dojo border text-sm cursor-pointer transition ';
  const on = 'bg-moss text-white border-moss';
  const off = 'bg-card border-line hover:border-ink-faint';
  const slots = slotsOf(index);
  const n = cat === 'all' ? slots.length : slots.filter((s) => s.cat === cat).length;
  const minutes = Math.round((CONF.minutes * n) / slots.length);
  const allowed = cat === 'all' ? canFull : canCat;
  const weakN = index.filter((x) => tier(prog, x.id) <= 1).length;
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="font-bold mb-2">範囲</div>
        <div className="flex flex-wrap gap-2">
          <button className={sel + (cat === 'all' ? on : off)} onClick={() => setCat('all')}>本番と同じ 全{slots.length}問</button>
          {cats.map((c) => <button key={c.slug} className={sel + (cat === c.slug ? on : off)} onClick={() => setCat(c.slug)}>{c.icon} {c.name}だけ</button>)}
        </div>
        <p className="text-xs text-ink-faint mt-3">
          本番と同じ分野の並びで、過去問から1回分を組みます。間違えた問題・要復習の問題（いま {weakN}問）を先に入れ、足りない分を未回答、解けた問題の順に足します。
          途中では正誤を出さず、最後にまとめて採点します。{CONF.selectNote}
        </p>
      </div>
      <div className="card p-5 flex flex-wrap items-center gap-4">
        <div className="serif text-3xl">{n}<span className="text-base text-ink-soft"> 問 ・ {minutes}分</span></div>
        <button className="btn btn-primary text-lg px-8" disabled={!allowed || paid === 'checking'} onClick={begin}>始める</button>
        <span className="text-sm text-ink-soft">
          {paid === 'paid' ? '有料プラン：何回でも'
            : cat === 'all' ? <>全{slots.length}問の回は有料プラン（月額980円）です。<a href="/ai/">有料プランを見る →</a> 無料では分野を1つ選んだ回を1回試せます。</>
            : canCat ? '無料のお試し（1回だけ）'
            : <>無料のお試しは使いました。<a href="/ai/">有料プランを見る →</a></>}
        </span>
      </div>
    </div>
  );
}
