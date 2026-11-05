// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// 旧サイトの URL（/r07/q1/ のような末尾スラッシュ付きディレクトリ形式）をそのまま維持する。
// Search Console の実績と被リンクを引き継ぐため、URL 構造は変えない。
// trailingSlash は 'ignore'（既定）のまま。'always' にすると dev サーバーが
// /data/q/r07-q1.json のような動的エンドポイントを末尾スラッシュ無しでは 404 にしてしまう。
// 本番（GitHub Pages）はディレクトリへのアクセスを自動でスラッシュ付きに寄せるので困らない。
export default defineConfig({
  site: 'https://takken-kakomon-drill.com',
  build: { format: 'directory' },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
