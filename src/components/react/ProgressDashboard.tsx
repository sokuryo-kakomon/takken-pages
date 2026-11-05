import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import siteJson from '../../data/site.json';
import type { Exam, QuestionIndex, Site } from '../../lib/types';
import { showExam } from '../../lib/examui';
import { $progress, $bookmarks, $days, isWeak, resetProgress, streak, summarize } from '../../store/progress';

const S = siteJson as unknown as Site;

function Row({ label, s, href }: { label: string; s: ReturnType<typeof summarize>; href: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr_7rem] md:grid-cols-[11rem_1fr_9rem_6rem] items-center gap-3 text-sm py-1.5">
      <a href={href} className="no-underline text-ink hover:underline truncate">{label}</a>
      <div className="bar" title={`解答済み ${s.coverage}%`}><i style={{ width: s.coverage + '%' }} /></div>
      <span className="text-ink-soft text-right">{s.answered}/{s.total}問 ・ {s.rate}%</span>
      <span className="hidden md:inline text-right text-xs text-shu">{s.weak > 0 ? `要復習 ${s.weak}` : ''}</span>
    </div>
  );
}

export default function ProgressDashboard() {
  const [full, setFull] = useState<QuestionIndex[] | null>(null);
  const [exam, setExam] = useState<Exam>('shi');
  const prog = useStore($progress);
  const bms = useStore($bookmarks);
  const days = useStore($days);
  useEffect(() => {
    fetch('/data/index.json').then((r) => r.json()).then(setFull);
    if (new URLSearchParams(location.search).get('exam') === 'hoshi') setExam('hoshi');
  }, []);
  if (!full) return <div className="card p-6 text-ink-soft">読み込み中…</div>;
  // 測量士と測量士補は別々に集計する
  const index = full.filter((x) => x.exam === exam);
  const hasHoshi = full.some((x) => x.exam === 'hoshi');
  const ys = (exam === 'hoshi' ? S.hoshiYears : S.years).filter((y) => index.some((x) => x.year === y.id));
  const q = exam === 'hoshi' ? 'exam=hoshi&' : '';

  const ids = (f: (x: QuestionIndex) => boolean) => index.filter(f).map((x) => x.id);
  const all = summarize(index.map((x) => x.id), prog);
  const st = streak(days, prog);
  const weak = index.filter((x) => isWeak(prog[x.id]));
  const marked = index.filter((x) => bms.includes(x.id));
  const recent = index.filter((x) => prog[x.id]?.at).sort((a, b) => prog[b.id].at! - prog[a.id].at!).slice(0, 8);
  const yLabel = (y: string) => ys.find((v) => v.id === y)?.short ?? y;
  const link = (x: QuestionIndex) => (
    <li key={x.id} className="py-1.5 text-sm flex gap-3 items-baseline">
      <a href={x.url} className="font-bold shrink-0 no-underline">{yLabel(x.year)} 問{x.num}</a>
      <span className="text-xs text-ink-faint shrink-0">{x.category}</span>
      <span className="text-ink-soft min-w-0 truncate">{x.excerpt}</span>
    </li>
  );

  return (
    <div className="space-y-5">
      {hasHoshi && (
        <div className="inline-grid grid-cols-2 gap-1 p-1 rounded-dojo bg-paper-deep text-sm">
          {(['shi', 'hoshi'] as Exam[]).map((e) => (
            <button key={e} type="button" onClick={() => { setExam(e); showExam(e); }}
              className={'px-5 py-1.5 rounded-dojo ' + (exam === e ? 'bg-card text-ink font-bold shadow-sm' : 'text-ink-soft')}>
              {e === 'shi' ? '測量士' : '測量士補'}
            </button>
          ))}
        </div>
      )}
      <div className="card p-6">
        <div className="flex flex-wrap items-end gap-6">
          <div><div className="text-xs text-ink-soft">解答済み</div><div className="serif text-4xl">{all.answered}<span className="text-lg text-ink-soft"> / {all.total}問</span></div></div>
          <div><div className="text-xs text-ink-soft">正答率</div><div className="serif text-4xl text-moss-deep">{all.rate}<span className="text-lg">%</span></div></div>
          <div><div className="text-xs text-ink-soft">要復習</div><div className="serif text-4xl text-shu">{all.weak}<span className="text-lg">問</span></div></div>
          <div title={st.n > 0 && !st.today ? '今日解くと続きます' : undefined}><div className="text-xs text-ink-soft">連続</div><div className="serif text-4xl text-moss-deep">{st.n}<span className="text-lg">日</span></div></div>
          <div className="ml-auto flex gap-2">
            <a className="btn btn-primary btn-sm" href={`/practice/?${q}mode=weak`}>要復習を解く</a>
            <a className="btn btn-ghost btn-sm" href={`/practice/?${q}mode=unanswered`}>未回答を解く</a>
          </div>
        </div>
        <div className="bar mt-4"><i style={{ width: all.coverage + '%' }} /></div>
      </div>

      <div className="card p-5">
        <h2 className="text-lg mb-2">年度別</h2>
        {ys.map((y) => <Row key={y.id} label={y.label} s={summarize(ids((x) => x.year === y.id), prog)} href={`/practice/?${q}year=${y.id}`} />)}
      </div>
      <div className="card p-5">
        <h2 className="text-lg mb-2">分野別</h2>
        {S.categories.filter((c) => index.some((x) => x.categorySlug === c.slug)).map((c) => <Row key={c.slug} label={`${c.icon} ${c.name}`} s={summarize(ids((x) => x.categorySlug === c.slug), prog)} href={`/practice/?${q}cat=${c.slug}`} />)}
      </div>

      {weak.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg mb-1 text-shu">要復習 {weak.length}問</h2>
          <p className="text-xs text-ink-faint mb-2">間違えたことがあり、まだ 2 回連続で正解できていない問題です。</p>
          <ul className="divide-y divide-line">{weak.map(link)}</ul>
        </div>
      )}
      {marked.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg mb-2">★ 印をつけた問題 {marked.length}問</h2>
          <ul className="divide-y divide-line">{marked.map(link)}</ul>
        </div>
      )}
      {recent.length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg mb-2">最近解いた問題</h2>
          <ul className="divide-y divide-line">{recent.map(link)}</ul>
        </div>
      )}

      <div className="text-right">
        <button className="btn btn-ghost btn-sm text-shu" onClick={() => { if (confirm('学習記録をすべて消します。元に戻せません。よろしいですか？')) resetProgress(); }}>記録をすべて消す</button>
      </div>
    </div>
  );
}
