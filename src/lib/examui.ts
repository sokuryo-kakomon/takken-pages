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
