import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { $progress, isWeak } from '../../store/progress';

// 一覧ページの各行（data-qid 付き要素）に正誤の印を付ける。
// 行ごとに island を置くと 28 個の React ルートができてしまうので、
// 1 つの island が DOM を走査して data 属性を書き、見た目は CSS に任せる。
export default function ListStatus() {
  const prog = useStore($progress);
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('[data-qid]').forEach((el) => {
      const r = prog[el.dataset.qid!];
      el.dataset.status = r?.answered ? (r.correct ? 'ok' : 'ng') : 'none';
      if (isWeak(r)) el.dataset.weak = '1'; else delete el.dataset.weak;
    });
  }, [prog]);
  return null;
}
