import type { APIRoute } from 'astro';
import { questions } from '../../lib/data';
import { oxItems } from '../../lib/ox';

// 一問一答（肢ごとの○×）の材料。/ox/ が最初に1回だけ読む
export const GET: APIRoute = () =>
  new Response(JSON.stringify(oxItems(questions, '宅建')), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
