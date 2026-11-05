import type { APIRoute } from 'astro';
import { questions } from '../../../lib/data';

// 1 問ぶんの本文。演習画面が /data/q/r07-q1.json のように 1 問ずつ取りに来る
export function getStaticPaths() {
  return questions.map((q) => ({ params: { id: q.id }, props: { q } }));
}
export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.q), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
