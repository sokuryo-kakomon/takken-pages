# 測量士 過去問ドリル（sokuryo-kakomon.com）

測量士試験 午前（択一式）令和4〜8年度 全140問の演習・解説サイト。Astro + React で静的生成し、GitHub Pages で配信する。

## 構成

```
src/data/            抽出済みデータ（唯一の情報源）
  questions.json     140問（問題文・選択肢・解説は HTML、AI用に平文も併記）
  site.json          年度・分野・条文リンク辞書・公式PDF
  guides.json        分野別ガイド 9本
  pages.json         運営者情報・プライバシーポリシー本文
src/pages/           ルーティング（URL は旧サイトと同一）
  index.astro        ランディング
  [year]/index       /r07/          年度別一覧
  [year]/[q]         /r07/q1/       問題ページ（SSG・SEO 対象）
  guide/[slug]       /guide/hoki/   分野別ガイド
  practice/          /practice/     演習（React SPA）
  progress/          /progress/     成績表
  data/              /data/index.json, /data/q/<id>.json  演習が読む API 相当の静的 JSON
  sitemap.xml.ts     /sitemap.xml
src/components/react/  QuestionCard（解答UI・解説・条文ポップ・AIボタン）、PracticeApp、ProgressDashboard
src/store/progress.ts  学習記録（localStorage キー sokuryo_q_v2、旧サイトと互換）
legacy/              旧サイトのソース（index.html ほか）。scripts/extract_data.py の入力
public/              画像（sokuryo_figures/）、CNAME、ads.txt、robots.txt
```

## 開発

```
npm install
npm run dev        # http://localhost:4321
npm run build      # dist/ に出力
```

## 内容の修正

問題文・解説を直すときは `src/data/questions.json` を直接編集する。`legacy/index.html` は参照用で、再抽出（`npm run extract`）すると JSON が上書きされるので注意。

## デプロイ

`main` に push すると `.github/workflows/deploy.yml` がビルドして GitHub Pages に配信する。
リポジトリの Settings → Pages → Source を **GitHub Actions** にしておくこと。
