import type { APIRoute } from 'astro';
import { questions, categories } from '../../lib/data';

// AI の弱点分析で中継サーバー（worker）が引く、問題ごとの一言の要点と分野の名前。
// 端末から来る文は論点として使わず、要点はこの一覧から引く。
export const GET: APIRoute = () =>
  new Response(JSON.stringify({
    cats: Object.fromEntries(categories.map((c) => [c.slug, c.name])),
    q: Object.fromEntries(questions.map((q) => [q.id, [q.categorySlug, q.hint]])),
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
