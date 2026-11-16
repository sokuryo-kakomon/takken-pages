import type { Exam } from './types';

// 演習・成績表など両方の試験で使うページで、ページの中で試験を切り替えたとき、
// 横のメニュー・上のメニュー・アドレスの ?exam= を合わせる（最初の表示は Base.astro と Header.astro の script）
export function showExam(e: Exam) {
  const hoshi = e === 'hoshi';
  if (hoshi) document.documentElement.dataset.exam = 'hoshi';
  else delete document.documentElement.dataset.exam;
  const u = new URL(location.href);
  if (hoshi) u.searchParams.set('exam', 'hoshi'); else u.searchParams.delete('exam');
  history.replaceState(history.state, '', u);
  document.querySelectorAll<HTMLAnchorElement>('a[data-exam-link]').forEach((a) => {
    a.href = a.dataset.examLink + (hoshi ? '?exam=hoshi' : '');
  });
}

// 答えた直後の結果の欄の「次へ」の名前。data-key="next" のボタン・リンクの字から作る。
// 1問のページ（下のナビは <a>「問42 →」）は番号入りの「問42へ →」にそろえ、演習（<button>）は「次の問題 →」のまま
export function nextLabelOf(b: HTMLElement): string {
  const t = (b.textContent ?? '').trim();
  if (/結果/.test(t)) return '結果を見る';
  if (b.tagName === 'A') { const n = t.replace(/\s*→\s*$/, ''); if (n && n !== '次の問題') return `${n}へ →`; }
  return '次の問題 →';
}

// 答えた直後の「解説を読む ↓」：解説の頭（id="kaisetsu"）へ。隠れたブラウザ欄でも動くよう smooth・rAF は使わない
export function toKaisetsu() {
  setTimeout(() => document.getElementById('kaisetsu')?.scrollIntoView({ block: 'start' }), 0);
}
