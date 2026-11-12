import type { Question } from './types';

// 一問一答（肢ごとの○×）の材料を、解説の <div class="opt"><b>肢1　誤り</b>　理由…</div> から作る。
// ビルド時専用。新しい問題を作るのではなく、解説で正誤を確かめ済みの肢だけを抜き出す。
// （div の class="correct" は「この問の答えの肢」の印で、記述の正誤ではない。正誤は <b> の見出しで見る）
// 出さないもの:
//  - 法改正の札（notice）がある問題・見出しに「（出題当時）」とある肢（今の法令と正誤が変わり得る）
//  - 表を見ないと判断できない問題
//  - 選択肢そのものが組合せの問題は、組合せでなく ア〜エ の記述を1つずつ出す（記述の見出しに正誤がある肢だけ）
//  - 見出しが正誤でない書き方の肢（「違反する」「対抗できない」など。問の聞き方しだいで○×が変わる）

export interface OxItem {
  id: string; q: string; exam: 'shi'; cat: string; key: string; ok: boolean;
  stem: string; html: string; reasonHtml: string; url: string; label: string;
}

const OPT = /<div class="opt(?: correct)?">\s*<b>([^<]*)<\/b>([\s\S]*?)<\/div>/g;
const TRUE = new Set(['正しい', '妥当', '適当', '適切', '正']);
const FALSE = new Set(['誤り', '妥当でない', '不適当', '不適切', '誤']);

function stemOf(q: Question) {
  // 問題文は前提（事案・「次の文章」・なお書き）まで全部出す。かっこ（「」・（））の中の「。」では切らない
  const t = q.statementText;
  const sents: string[] = [];
  let depth = 0, from = 0;
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (ch === '「' || ch === '（' || ch === '(') depth++;
    else if ((ch === '」' || ch === '）' || ch === ')') && depth > 0) depth--;
    else if (ch === '。' && depth === 0) { sents.push(t.slice(from, k + 1)); from = k + 1; }
  }
  if (from < t.length) sents.push(t.slice(from));
  // 「〜のうち、◯◯によれば、正しいものはどれか。」は○×では紛らわしいので「〜次の記述（◯◯によれば）」に直す
  const out = sents.map((x) => {
    const m = x.match(/(?:どれか|いくつあるか)([（(][^）)]*[）)])?。?$/);
    if (!m) return x;
    const note = m[1] ?? '';
    let b = x.replace(/([（(][^）)]*[）)])?。?$/, '').replace(/、?(?:[^、（(]|[（(][^）)]*[）)])*(?:どれか|いくつあるか)$/, '');
    const i = b.indexOf('のうち');
    if (i >= 0) { const mid = b.slice(i + 3).replace(/^、/, ''); b = b.slice(0, i) + (mid ? `（${mid}）` : ''); }
    b = b.replace(/次の[ア-オa-eＡ-Ｅ][～〜~－\-][ア-オa-eＡ-Ｅ]の/, '次の');
    return b ? b + '。' + note : note;
  }).join('');
  // 注（＊）の本文がデータに無い問は印だけ残ると紛らわしいので外す
  return (out.match(/＊/g) || []).length === 1 ? out.replace('＊', '') : out;
}

export function oxItems(qs: Question[], examName: string): OxItem[] {
  const out: OxItem[] = [];
  for (const q of qs) {
    if (((q as { kind?: string }).kind ?? 'choice') !== 'choice') continue;
    const h = q.explanationHtml;
    if (h.includes('class="notice"')) continue;
    if (q.figure?.essential || q.tablesHtml.length) continue;
    const src = new Map<string, string>();
    for (const c of q.choices) if (q.choiceStyle === 'sentence') src.set(c.key, c.html);
    for (const it of q.items) if (it.key) src.set(it.key, it.html);
    for (const m of h.matchAll(OPT)) {
      const head = m[1].replace(/\s+/g, ' ').trim();
      const hm = head.match(/^(?:肢\s*)?([0-9]+|[ア-オ]|[a-e])\s+(.+)$/);
      if (!hm) continue;
      const [, key, verdict] = hm;
      if (!src.has(key)) continue;
      const ok = TRUE.has(verdict) ? true : FALSE.has(verdict) ? false : null;
      if (ok === null) continue;
      const reason = m[2].trim();
      if (!reason) continue;
      out.push({
        id: `${q.id}-${key}`, q: q.id, exam: 'shi', cat: q.categorySlug, key, ok,
        stem: stemOf(q), html: src.get(key)!, reasonHtml: `<p>${reason}</p>`, url: q.url,
        label: `${examName} ${q.yearLabel} 第${q.num}問 ${/^[0-9]/.test(key) ? '肢' + key : key}`,
      });
    }
  }
  return out;
}
