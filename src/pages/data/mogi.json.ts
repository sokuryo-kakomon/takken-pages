import type { APIRoute } from 'astro';
import { questions } from '../../lib/data';

// 模擬試験が組むのに使う軽い一覧（本文は含まない。問題の種類 kind つき）
export const GET: APIRoute = () =>
  new Response(JSON.stringify(questions.map((q) => ({
    id: q.id, year: q.year, num: q.num, cat: q.categorySlug, kind: (q as { kind?: string }).kind ?? 'choice',
  }))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
