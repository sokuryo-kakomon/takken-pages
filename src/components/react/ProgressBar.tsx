import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { $progress, summarize } from '../../store/progress';

interface Props { ids: string[]; label?: string; compact?: boolean }

// localStorage はサーバーに無いので、マウント前は空の記録で描いて hydration のズレを避ける
export default function ProgressBar({ ids, label, compact }: Props) {
  const prog = useStore($progress);
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  const s = summarize(ids, m ? prog : {});
  return (
    <div className={compact ? 'text-xs' : 'text-sm'}>
      <div className="flex justify-between items-baseline mb-1 gap-2">
        <span className="font-bold">{label ?? '進捗'}</span>
        <span className="text-ink-soft">{s.answered}/{s.total}問 ・ 正答率 {s.rate}%</span>
      </div>
      <div className="bar"><i style={{ width: s.coverage + '%' }} /></div>
      {!compact && s.weak > 0 && <div className="text-xs text-shu mt-1">要復習 {s.weak}問</div>}
    </div>
  );
}
