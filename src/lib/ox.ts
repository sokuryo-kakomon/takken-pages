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

// 問題文の頭（肢だけでは何の話か分からないので添える）。「〜のうち、正しいものはどれか。」は○×では紛らわしいので落とす
function stemOf(q: Question) {
  const t = q.statementText;
  // かっこ（「」・（））の中の「。」では切らない
  let depth = 0, i = -1;
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (ch === '「' || ch === '（' || ch === '(') depth++;
    else if ((ch === '」' || ch === '）' || ch === ')') && depth > 0) depth--;
    else if (ch === '。' && depth === 0) { i = k; break; }
  }
  let s = i > 0 && i < 200 ? t.slice(0, i + 1) : t.slice(0, 160) + '…';
  s = s.replace(/のうち、?((?:(?:[^、。（(]|[（(][^）)]*[）)])*(?:によれば|に照らし(?:て)?|によると|に基づけば))?)、?(?:[^、。（(]|[（(][^）)]*[）)])*(?:どれか|いくつあるか)。$/, (_m, p: string) => (p ? `（${p}）` : ''));
  return s;
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
