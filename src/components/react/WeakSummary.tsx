import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Exam, QuestionIndex, Site } from '../../lib/types';
import { $progress, needsReview, summarize } from '../../store/progress';
import { $aiCode, $aiLog, checkPaid, type PaidState } from '../../store/ai';
import AiBunseki from './AiBunseki';

// 弱点まとめ（有料プラン）。成績表の記録だけで出す（AI は使わない＝原価なし）。
// ・分野ごとの正答率を低い順に並べ、弱い分野を3つまで（10問解いたら出す）
// ・本番と同じ分野の割合で見た「いまの正答率の目安」（本番の問題数ぶん解いたら出す）
// ・間違えた問題だけの解き直しへ
// サイトごとの違いは props で: pass（基準の問題数）・showCount（○問中 約○問 を出すか）・label・note
const S = siteJson as unknown as Site;
const MIN = 3; // 分野の正答率を出すのに要る解答数（少ないと当てにならない）
const KIROKU = '記録はこの端末・このブラウザの中だけです。別の端末や、ブラウザの記録を消した時は引き継がれません。';

type Props = { index: QuestionIndex[]; exam: Exam; q: string; pass?: { n: number; label: string }; showCount?: boolean; label?: string; note?: string };

export default function WeakSummary({ index, exam, q, pass, showCount = true, label = 'いまの正答率の目安', note }: Props) {
  const prog = useStore($progress);
  const code = useStore($aiCode);
  const log = useStore($aiLog);
  const [paid, setPaid] = useState<PaidState>('checking');
  useEffect(() => { checkPaid(code).then(setPaid); }, [code]);

  const all = summarize(index.map((x) => x.id), prog);
  const cats = S.categories
    .map((c) => ({ c, s: summarize(index.filter((x) => x.categorySlug === c.slug).map((x) => x.id), prog) }))
    .filter((r) => r.s.total > 0);
  const rated = cats.filter((r) => r.s.answered >= MIN).sort((a, b) => a.s.rate - b.s.rate);
  const worst = rated.slice(0, 3);
  // 本番の分野の並び = 最新の回の分野。分野の正答率（解答が少ない分野は全体の正答率）で出す
  const ys = (exam === 'hoshi' ? S.hoshiYears ?? [] : S.years).map((y) => y.id);
  const latest = ys.find((y) => index.some((x) => x.year === y));
  const slots = index.filter((x) => x.year === latest).map((x) => x.categorySlug);
  const rateOf = (slug: string) => { const r = cats.find((x) => x.c.slug === slug); return r && r.s.answered >= MIN ? r.s.rate : all.rate; };
  const expect = slots.reduce((s, c) => s + rateOf(c) / 100, 0);
  const expectN = Math.round(expect);
  const expectPct = slots.length ? Math.round((expect / slots.length) * 100) : 0;
  const ready = slots.length > 0 && all.answered >= slots.length; // 目安は本番の問題数ぶん解いてから
  // 「間違えた問題だけで解き直し」と同じ数え方
  const weakN = index.filter((x) => needsReview(prog[x.id])).length;
  const runN = Math.min(weakN, slots.length);
  const mogi = `/mogi/?${q}range=weak`;

  const head = (
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="text-lg">弱点まとめ</h2>
      <span className="text-xs px-2 py-0.5 rounded-full bg-ai-pale text-ai font-bold">有料プラン</span>
    </div>
  );
  const foot = (
    <p className="text-xs text-ink-faint mt-4">{KIROKU}
      {log.length > 0 && <button type="button" className="underline ml-2" onClick={() => { if (confirm(`AI に聞いた記録（${log.length}件）を、この端末から消します。`)) $aiLog.set([]); }}>AI に聞いた記録（{log.length}件）を消す</button>}
    </p>
  );
  if (paid === 'checking') return null;
  if (paid !== 'paid') {
    return (
      <div className="card p-5">
        {head}
        <p className="text-sm text-ink-soft">有料プランに入ると、あなたの解答の記録から、ここに次の4つが出ます。</p>
        <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
          <li className="rounded-dojo bg-paper px-3 py-2">📉 正答率の低い分野（3つまで）</li>
          <li className="rounded-dojo bg-paper px-3 py-2">🎯 {label}</li>
          <li className="rounded-dojo bg-paper px-3 py-2">❗ 間違えた問題だけで解き直す</li>
          <li className="rounded-dojo bg-paper px-3 py-2">🤖 AI の弱点分析（つまずきを3つまで）</li>
        </ul>
        <a href="/ai/" className="inline-block mt-3 text-sm font-bold">有料プラン（月額980円）を見る →</a>
        {foot}
      </div>
    );
  }
  if (all.answered < 10) {
    return (
      <div className="card p-5">
        {head}
        <p className="text-sm text-ink-soft">まだ解いた問題が少ないので出せません（いま {all.answered}問）。10問ほど解くと、弱い分野が出ます。</p>
        {foot}
      </div>
    );
  }
  return (
    <div className="card p-5">
      {head}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs text-ink-soft mb-2">正答率の低い分野（{MIN}問以上解いた分野）</div>
          {worst.length === 0 ? <p className="text-sm text-ink-soft">まだ {MIN}問以上解いた分野がありません。</p> : (
            <ol className="space-y-2">
              {worst.map(({ c, s }, k) => (
                <li key={c.slug} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-ink-faint">{k + 1}.</span>
                  <span className="flex-1 min-w-0 truncate">{c.icon} {c.name}</span>
                  <span className="text-shu font-bold w-12 text-right">{s.rate}%</span>
                  <a className="text-xs whitespace-nowrap" href={`/practice/?${q}cat=${c.slug}${s.weak ? '&mode=weak' : ''}`}>{s.weak ? `要復習 ${s.weak}問を解く` : 'この分野を解く'} ›</a>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <div className="text-xs text-ink-soft mb-2">{label}（過去問の記録から・本番と同じ分野の割合で）</div>
          {!ready ? <p className="text-sm text-ink-soft">あと {slots.length - all.answered}問解くと出ます（本番の問題数ぶんの記録が要ります）。</p> : (
            <>
              <div className="serif text-3xl text-moss-deep">{expectPct}<span className="text-base">%</span>
                {showCount && <span className="text-base text-ink-soft ml-2">（{slots.length}問中 約{expectN}問）</span>}
              </div>
              {pass && <div className={'text-sm mt-1 font-bold ' + (expectN >= pass.n ? 'text-moss-deep' : 'text-shu')}>{expectN >= pass.n ? `${pass.label}に届く目安` : `${pass.label}まで あと約${pass.n - expectN}問`}</div>}
            </>
          )}
          {note && <p className="text-xs text-ink-soft mt-1">{note}</p>}
          <p className="text-xs text-ink-faint mt-1">解いた過去問の正答率から出した目安で、本番の点数を約束するものではありません。</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {weakN > 0 ? <a className="btn btn-primary btn-sm" href={mogi}>間違えた問題だけで解き直す（{runN < weakN ? `${weakN}問のうち最大${slots.length}問` : `${weakN}問`}）</a> : <span className="text-sm text-ink-soft">間違えた問題はいまありません。</span>}
      </div>
      <AiBunseki index={index} answered={all.answered} q={q} guide={true}
        cats={cats.filter((r) => r.s.answered > 0).map((r) => ({ slug: r.c.slug, n: r.s.answered, rate: r.s.rate }))} />
      {foot}
    </div>
  );
}
