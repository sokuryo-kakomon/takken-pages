# 宅建 過去問ドリル（takken-kakomon-drill.com）

宅地建物取引士資格試験の過去問 平成27年度〜令和7年度（13回分・650問）の演習サイト。測量士 過去問ドリル（sokuryo-pages）のコードを写して作った。Astro + React で静的生成し、GitHub Pages で配信する。

## 問題文と正解番号

- 問題文は一般財団法人 不動産適正取引推進機構（RETIO）公表の PDF の原文のまま。各問題のページに出典を出す
- 作り方: 本人の手入力の文を Windows の文字読み取り2回（ocr/・ocr2/）の多数決で原文に戻し、PDF の画像と見較べて確認済みにした（tools/ の clean_questions → merge_ocr → fill_choices → apply_hand → write_txt）
- 正解番号は各 PDF の最後のページの正解番号表を画像で読んだもの（tools/answers_src.txt）。0＝正解なし（全員正解）、(23)＝複数正解
- サイトのデータは `python tools/site_data.py` で ocr/genbun.jsonl と answers_src.txt から src/data/questions.json・site.json を作る。載せるのは確認済み（verified）の問だけ

## 構成

```
src/data/questions.json  650問（tools/site_data.py が作る。手で直さない）
src/data/site.json       年度・分野・出典
src/data/pages.json      運営者情報・プライバシーポリシー本文
src/pages/[year]/[q]     /r07/q1/  問題ページ（令和2・3年度は /r03-12/q1/ のように10月・12月で分ける）
src/pages/practice/      演習（React）
src/pages/progress/      成績表
src/store/progress.ts    学習記録（localStorage キー takken_q_v1）
```

hoshi（測量士補）の仕組みは写した名残で、データは空。

## 開発

```
npm ci
npm run dev        # http://localhost:4321
npm run build      # dist/ に出力
```

## デプロイ

`main` に push すると `.github/workflows/deploy.yml` がビルドして GitHub Pages に配信する。公開は 2026/11/12 以降。
