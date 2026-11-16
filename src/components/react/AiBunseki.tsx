import { useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { QuestionIndex, Site } from '../../lib/types';
import { $aiCode, $aiLog, $analysis, $bunsekiOk, postJson } from '../../store/ai';
import { $progress, needsReview } from '../../store/progress';

// AI の弱点分析（有料プラン・質問1回分）。
// 送る物：間違えた・要復習の問題の番号（新しい順に30まで）、AI に聞いた問題の番号と質問文の抜粋（15件まで・150字まで）、分野ごとの正答率。
// 各問の要点は中継サーバーがサイトの hints.json から引く。結果はこの端末にだけ残す。
const S = siteJson as unknown as Site;
const NEED = 10; // 前の分析から、新しく何問解いたらまた押せるか
type Res = { summary: string; points: { title: string; why: string; qids: string[]; cat: string }[]; next: string };

export default function AiBunseki({ index, cats, answered, q, guide }: {
  index: QuestionIndex[]; cats: { slug: string; n: number; rate: number }[]; answered: number; q: string; guide: boolean;
}) {
  const code = useStore($aiCode);
  const prog = useStore($progress);
  const log = useStore($aiLog);
  const last = useStore($analysis);
  const ok = useStore($bunsekiOk);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState(false);

  const byId = new Map(index.map((x) => [x.id, x]));
  const yShort = (y: string) => [...S.years, ...(S.hoshiYears ?? [])].find((x) => x.id === y)?.short ?? y;
  const label = (id: string) => { const x = byId.get(id); return x ? `${yShort(x.year)} 問${x.num}` : id; };
  const catName = (slug: string) => S.categories.find((c) => c.slug === slug)?.name ?? '';
  const wrong = index.filter((x) => needsReview(prog[x.id])).sort((a, b) => (prog[b.id]?.at ?? 0) - (prog[a.id]?.at ?? 0)).slice(0, 30).map((x) => x.id);
  const asked = log.filter((x) => byId.has(x.qid)).slice(-15).reverse();
  const since = last && answered >= last.answered ? answered - last.answered : Infinity; // 成績をリセットした時は押せる
  const enough = wrong.length + asked.length >= 3;
  const can = enough && since >= NEED && !busy;

  const run = async (agreed = false) => {
    if (!ok && !agreed) { setAsk(true); return; }
    setBusy(true); setErr('');
    try {
      const r = await postJson<Res>('/analyze', { code, wrong, asked: asked.map(({ qid, q: t }) => ({ qid, q: t })), cats });
      if (r.ok) $analysis.set({ at: Date.now(), answered, res: r.data });
      else setErr(r.data.error || '分析できませんでした。');
    } catch { setErr('通信に失敗しました。電波の良い所でもう一度お試しください。'); }
    finally { setBusy(false); }
  };
  const res = last?.res as Res | undefined;

  return (
    <div className="mt-5 pt-4 border-t border-line">
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <h3 className="font-bold">🤖 AI の弱点分析</h3>
        <span className="text-xs text-ink-soft">間違えた問題と、AI に聞いた事から、つまずいている所をまとめます（質問1回分）</span>
      </div>
      {ask && !ok && (
        <div className="rounded-dojo bg-paper p-3 text-sm mb-3">
          <p className="font-bold mb-1">分析のとき、次の物を AI（Anthropic の Claude）に送ります</p>
          <ul className="list-disc pl-5 text-ink-soft space-y-0.5">
            <li>間違えた・要復習の問題の番号（{wrong.length}問）と分野ごとの正答率</li>
            <li>AI に質問した問題の番号と、質問文の抜粋（{asked.length}件・1件150字まで）</li>
          </ul>
          <p className="text-ink-soft mt-1">質問文に書いた内容は、抜粋のまま送られます。当サイトのサーバーには保存しません。結果はこの端末にだけ残ります。</p>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-primary btn-sm" onClick={() => { $bunsekiOk.set(true); setAsk(false); run(true); }}>わかった。分析する</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAsk(false)}>やめる</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={!can} onClick={() => run()}>{busy ? '分析しています…' : res ? 'もう一度分析する' : 'AI で分析する'}</button>
        <span className="text-xs text-ink-soft">
          {!enough ? '間違えた問題か AI への質問が、あと少し要ります。'
            : since < NEED ? `前の分析から新しく ${NEED}問解くと、また分析できます（あと ${NEED - since}問）。`
            : `材料：間違えた問題 ${wrong.length}問・AI への質問 ${asked.length}件`}
        </span>
      </div>
      {err && <p className="text-sm text-shu mt-2">{err}</p>}
      {res && (
        <div className="mt-3 rounded-dojo border border-line border-l-4 border-l-ai bg-white px-4 py-3 text-[.92rem] leading-relaxed">
          <p className="text-xs text-ink-faint mb-1">{new Date(last!.at).toLocaleDateString('ja-JP')} の分析（{last!.answered}問解いた時点）</p>
          <p>{res.summary}</p>
          {res.points.length > 0 && (
            <ol className="mt-2 space-y-2 list-decimal pl-5 marker:text-ai">
              {res.points.map((p, k) => (
                <li key={k}>
                  <b>{p.title}</b>{p.cat && <span className="text-xs text-ink-soft ml-1">（{catName(p.cat)}）</span>}
                  <div className="text-ink-soft text-sm">{p.why}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-0.5">
                    {p.qids.map((id) => byId.get(id) && <a key={id} href={byId.get(id)!.url}>{label(id)}</a>)}
                    {p.cat && guide && <a href={`/guide/${p.cat}/`}>📚 ガイドを読む</a>}
                    {p.cat && <a href={`/practice/?${q}cat=${p.cat}&mode=weak&go=1`}>この分野の要復習を解く ›</a>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2"><b>次にやること：</b>{res.next}</p>
          <p className="text-xs text-ink-faint mt-2">AI の分析は目安です。この端末の記録だけから作っています。</p>
        </div>
      )}
    </div>
  );
}
