import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { Question, LawRefs } from '../../lib/types';
import { $progress, $bookmarks, recordAnswer, toggleBookmark, type Rec } from '../../store/progress';
import { linkifyLawRefs, resolveLaw, type LawCard } from '../../lib/lawref';
import AiExplainButton from './AiExplainButton';

interface Props {
  q: Question;
  lawRefs: LawRefs;
  mode?: 'page' | 'practice';
  onAnswered?: (ok: boolean, rec: Rec) => void;
}

function styleObj(s: string) {
  const o: Record<string, string> = {};
  for (const [k, v] of s.split(';').map((x) => x.split(':').map((y) => y.trim()))) if (k && v) o[k === 'border-color' ? 'borderColor' : k] = v;
  return o;
}

// 1 問ぶんのカード。問題文 → 図表 → 判断材料 → 解答肢 → 判定 → 解説 の順。
// 解説は解答前でも DOM には入れておき（検索エンジンに読ませるため）、ぼかしで覆うだけにする。
export default function QuestionCard({ q, lawRefs, mode = 'page', onAnswered }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [law, setLaw] = useState<LawCard | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const prog = useStore($progress);
  const bms = useStore($bookmarks);
  const explRef = useRef<HTMLDivElement>(null);
  const prev = mounted ? prog[q.id] : undefined;
  const marked = mounted && bms.includes(q.id);
  // React 19 は dangerouslySetInnerHTML のオブジェクトが別物になるたびに innerHTML を
  // 書き直す。解説は linkify で DOM を書き換えるので、オブジェクトを固定して再描画で
  // 条文ボタンが消えないようにする。
  // 規則改正の札は解説の先頭に入っている。解く前から見えるよう、解説（隠れる部分）の外へ出す
  const [notice, explBody] = useMemo(() => {
    const m = q.explanationHtml.match(/^<div class="notice">([\s\S]*?)<\/div>\n?/);
    return m ? [m[1], q.explanationHtml.slice(m[0].length)] : [null, q.explanationHtml];
  }, [q.explanationHtml]);
  const explHtml = useMemo(() => ({ __html: explBody }), [explBody]);
  const stmtHtml = useMemo(() => ({ __html: q.statementHtml }), [q.statementHtml]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setPicked(null); setRevealed(false); }, [q.id]);
  useEffect(() => {
    if (explRef.current) linkifyLawRefs(explRef.current, lawRefs, (h) => setLaw(resolveLaw(lawRefs, h)));
  }, [q.id, lawRefs]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLaw(null); setZoom(null); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  // PC のキー操作: 1〜5（記号が a〜e の問題は a〜e も）で解答、Enter・→ で次の問題、← で前の問題（data-key の付いたボタンを押す）
  const pickRef = useRef<(key: string) => void>(() => {});
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || law || zoom) return;
      const t = document.activeElement;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (/^[1-5a-e]$/.test(e.key)) { pickRef.current(e.key); return; }
      const dir = e.key === 'ArrowRight' || e.key === 'Enter' ? 'next' : e.key === 'ArrowLeft' ? 'prev' : null;
      // Enter は押しているボタンの上ではそのボタンに任せる
      if (!dir || (e.key === 'Enter' && t && /^(A|BUTTON|SUMMARY)$/.test(t.tagName))) return;
      const b = document.querySelector<HTMLElement>(`[data-key="${dir}"]:not([disabled])`);
      if (b) { e.preventDefault(); b.click(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [law, zoom]);

  const answered = picked !== null;
  const ok = answered && picked === q.answer;
  const pick = (v: number) => {
    if (answered) return;
    setPicked(v);
    setRevealed(true);
    const rec = recordAnswer(q.id, v, q.answer);
    onAnswered?.(v === q.answer, rec);
  };
  pickRef.current = (key: string) => {
    const c = q.choices.find((c) => c.key === key) ?? (/\d/.test(key) ? q.choices.find((c) => c.value === Number(key)) : undefined);
    if (c) pick(c.value);
    else if (q.choiceStyle === 'none' && /\d/.test(key)) pick(Number(key));
  };
  const cls = (v: number, extra = '') =>
    'choice' + extra + (answered ? (v === q.answer ? ' is-correct' : v === picked ? ' is-wrong' : ' is-muted') : '');
  const markText = (v: number) => (answered && (v === q.answer || v === picked) ? (v === q.answer ? '○' : '×') : '');
  const answerLabel = (() => {
    const c = q.choices.find((c) => c.value === q.answer);
    if (!c) return `選択肢 ${q.answer}`;
    return q.choiceStyle === 'combo' ? `${c.key}（${c.text}）` : `選択肢 ${c.key}`;
  })();
  const catStyle = styleObj(q.categoryStyle);

  return (
    <article className="card p-5 md:p-7">
      {mode === 'page' && (
        <header className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <span className="font-bold">{q.yearLabel} 第{q.num}問</span>
          <span className="chip" style={catStyle}>{q.categoryIcon} {q.category}</span>
          {prev?.answered && (
            <span className="text-xs text-ink-faint">前回：{prev.correct ? '正解' : '不正解'}（{prev.attempts}回目）</span>
          )}
          <button type="button" className={'ml-auto btn btn-ghost btn-sm' + (marked ? ' text-shu border-shu' : '')} onClick={() => toggleBookmark(q.id)}>
            {marked ? '★ 要復習に入れた' : '☆ 要復習に入れる'}
          </button>
        </header>
      )}

      <div className="qhtml">
        <p className="text-[1.04rem]" dangerouslySetInnerHTML={stmtHtml} />
        {q.tablesHtml.map((t, i) => <div key={i} dangerouslySetInnerHTML={{ __html: t }} />)}
        {q.figure?.essential && (
          <figure className="my-3">
            <img src={q.figure.src} alt={`第${q.num}問の図表`} loading="lazy"
              className="max-w-full h-auto border border-line rounded-dojo bg-white cursor-zoom-in" onClick={() => setZoom(q.figure!.src)} />
            <figcaption className="text-xs text-ink-faint mt-1">図表をクリックすると拡大します</figcaption>
          </figure>
        )}
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
        <div className="text-sm font-bold text-moss-deep mb-1">👇 解答を選ぶ<span className="hidden md:inline font-normal text-xs text-ink-faint ml-2">キー 1〜5 で選択・Enter で次へ</span></div>
        {q.choiceStyle === 'sentence' && q.choices.map((c) => (
          <button key={c.key} type="button" className={cls(c.value)} disabled={answered} onClick={() => pick(c.value)}>
            <span className="mark">{markText(c.value)}</span>
            <span><b className="mr-1">{c.key}．</b><span dangerouslySetInnerHTML={{ __html: c.html }} /></span>
          </button>
        ))}
        {q.choiceStyle === 'combo' && (
          <div className="flex flex-wrap">
            {q.choices.map((c) => (
              <button key={c.key} type="button" className={cls(c.value, ' choice-combo')} disabled={answered} onClick={() => pick(c.value)}>
                <span className="mark">{markText(c.value)}</span>
                <span><b className="mr-1">{c.key}.</b><span dangerouslySetInnerHTML={{ __html: c.html }} /></span>
              </button>
            ))}
          </div>
        )}
        {q.choiceStyle === 'none' && (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" className={cls(v, ' choice-num')} disabled={answered} onClick={() => pick(v)}>{v}</button>
            ))}
          </div>
        )}
        {answered && (
          <div className={'mt-3 px-4 py-3 rounded-dojo font-bold flex flex-wrap items-center gap-3 ' + (ok ? 'bg-moss-pale text-moss-deep' : 'bg-shu-pale text-shu')}>
            <span>{ok ? '正解！' : `不正解 … 正解は ${answerLabel}`}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>もう一度</button>
          </div>
        )}
      </div>

      {q.figure && !q.figure.essential && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-soft">📄 原典の問題ページ（画像）を見る</summary>
          <img src={q.figure.src} alt={`${q.yearLabel} 第${q.num}問 原典`} loading="lazy"
            className="mt-2 max-w-full h-auto border border-line rounded-dojo bg-white cursor-zoom-in" onClick={() => setZoom(q.figure!.src)} />
        </details>
      )}

      {notice && <div className="qhtml mt-4"><div className="notice">{notice}</div></div>}

      <section className={'relative mt-6 pt-5 border-t-2 border-line' + (revealed ? '' : ' expl-veiled')}>
        <h2 className="text-lg mb-2">解説</h2>
        <div key={q.id} ref={explRef} className="expl-body">
          {q.hint && <div className="qhtml"><div className="keybox text-[.95rem]">💡 {q.hint}</div></div>}
          <div className="qhtml" dangerouslySetInnerHTML={explHtml} />
        </div>
        {!revealed && (
          <div className="expl-veil">
            <button type="button" className="btn btn-ghost bg-card" onClick={() => setRevealed(true)}>解答せずに解説を読む</button>
          </div>
        )}
        {revealed && <div className="mt-4 no-print"><AiExplainButton q={q} /></div>}
      </section>

      {law && (
        <div className="modal-bg" onClick={() => setLaw(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button className="modal-x" onClick={() => setLaw(null)} aria-label="閉じる">×</button>
            <h3 className="text-xl mb-0.5">{law.title}</h3>
            <div className="text-xs text-ink-soft mb-3">{law.name}</div>
            <div className="bg-ai-pale border-l-4 border-ai rounded-dojo px-4 py-3 text-[.95rem] leading-relaxed mb-4">{law.summary}</div>
            <a className="btn btn-primary btn-sm" href={law.href} target="_blank" rel="noopener">📖 {law.linkText} →</a>
            <p className="text-xs text-ink-faint mt-3 leading-relaxed">※ {law.note}</p>
          </div>
        </div>
      )}
      {zoom && (
        <div className="modal-bg cursor-zoom-out" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-w-[96vw] max-h-[92vh] bg-white rounded-dojo shadow-lift" />
        </div>
      )}
    </article>
  );
}
