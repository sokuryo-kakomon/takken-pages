// tools/site_data.py が出力する JSON の型。
// 問題文と解説は HTML のまま持つ（表・SVG・強調が多く、平文化すると失われる）。
// *Text は AI へ渡す用・検索用の平文。

export interface Choice { key: string; html: string; text: string; value: number }
export interface Item { key: string | null; html: string; text: string }
export interface Figure { src: string; essential: boolean }

export type Exam = 'shi' | 'hoshi';

export interface Question {
  id: string;            // "r07-q1"・"r03-12-q1"（令和2・3年度は10月と12月の2回）
  exam?: Exam;           // 'shi' だけ（測量士サイトから写した名残。questions.json は持たず、読み込み時に付ける）
  year: string;          // "r07"
  yearNum: number;
  yearLabel: string;     // "令和7年度"
  num: number;
  answer: number;        // 1〜4
  ok?: number[];         // 正解と扱う番号すべて（複数正解・正解なしの問。無ければ [answer]）
  source?: string;       // 原文の PDF
  category: string;
  categoryIcon: string;
  categorySlug: string;
  categoryStyle: string;
  title: string;
  description: string;
  statementHtml: string;
  statementText: string;
  items: Item[];         // 判断材料の記述 a〜e（押せない）
  choices: Choice[];     // 解答肢（押せる）。空なら 1〜4 の番号ボタンで答える
  choiceStyle: 'sentence' | 'combo' | 'none';
  tablesHtml: string[];
  figure: Figure | null; // essential=true は問題に必須の図、false は原典ページの控え
  explanationHtml: string;
  explanationText: string;
  hint: string;
  url: string;
  prev: string | null;
  next: string | null;
}

export interface QuestionIndex {
  id: string; exam: Exam; year: string; num: number; category: string; categorySlug: string; excerpt: string; url: string;
}

export interface Year {
  id: string; num: number; label: string; short: string; examDate: string; ad: number;
  pdf: { questions: string | null; answers: string | null };
  count: number;
}
export interface Category { name: string; icon: string; slug: string; bg: string; fg: string; count: number }
export interface LawRefs {
  laws: { key: string; name: string; url: string }[];
  summaries: Record<string, string>;
  junsokuPages: Record<string, number>;
  defaults?: Record<string, string>;  // 分野（categorySlug）→ 法令名の無い「第◯条」をどの法令とみるか
}
export interface Site {
  name: string; legacyName: string; url: string; adsenseClient: string; amazonTag: string;
  years: Year[]; hoshiYears: Year[]; categories: Category[]; lawRefs: LawRefs;
  source: { name: string; url: string };
}
export interface Guide {
  slug: string; name: string; short: string; category: string; description: string;
  leadHtml: string; bodyHtml: string; questionIds: string[]; url: string;
}
export interface Guides { indexLead: string; indexBodyHtml: string; guides: Guide[] }
export interface StaticPage { title: string; html: string; updated: string }
