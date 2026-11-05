import type { APIRoute } from 'astro';
import { questions, toIndex } from '../../lib/data';

// 演習・成績表が使う軽い一覧（本文は含まない）
export const GET: APIRoute = () =>
  new Response(JSON.stringify(questions.map(toIndex)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
