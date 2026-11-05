import type { APIRoute } from 'astro';
import { questions, hoshiQuestions, guides, site } from '../lib/data';

// Search Console に登録済みの /sitemap.xml をそのまま使い続ける。
// 成績表は個人の記録なので載せない。
export const GET: APIRoute = () => {
  const urls = [
    '/', '/practice/', '/guide/', '/books/', '/about/', '/privacy/',
    ...site.years.map((y) => `/${y.id}/`),
    ...(hoshiQuestions.length ? ['/hoshi/'] : []),
    ...site.hoshiYears.filter((y) => hoshiQuestions.some((q) => q.year === y.id)).map((y) => `/hoshi/${y.id}/`),
    ...guides.guides.map((g) => g.url),
    ...questions.map((q) => q.url),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${site.url}${u}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
