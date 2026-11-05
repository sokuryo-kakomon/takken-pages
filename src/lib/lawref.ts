import type { LawRefs } from './types';

// 解説本文中の「第◯条」を押せるようにし、条文の要点と公式リンク（e-Gov / 準則PDF）を出す。
// 旧サイトの linkify を移植したもの。直前に出てきた法令名（測量法／準則／基本法）を
// 文脈として持ち回り、法令名が無い場合は条番号から推定する。

export interface LawHit { law: string; key: string; art: string }
export interface LawCard { title: string; name: string; summary: string; href: string; linkText: string; note: string }

const TOK = /(作業規程の準則|測量法|地理空間情報活用推進基本法|基本法|準則)|(第\s*(\d+)\s*条(?:の(\d+))?)/g;

function lawFromKeyword(w: string): string | null {
  if (w.includes('基本法')) return 'kihonho';
  if (w.includes('準則')) return 'junsoku';
  if (w.includes('測量法')) return 'sokuryoho';
  return null;
}

function fallbackLaw(refs: LawRefs, key: string): string {
  const s = refs.summaries['sokuryoho|' + key];
  const j = refs.summaries['junsoku|' + key];
  if (s && !j) return 'sokuryoho';
  if (j && !s) return 'junsoku';
  return parseInt(key, 10) < 60 ? 'sokuryoho' : 'junsoku';
}

export function linkifyLawRefs(root: HTMLElement, refs: LawRefs, onHit: (h: LawHit) => void) {
  if (root.dataset.lawified) return;
  root.dataset.lawified = '1';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  let cur: string | null = null;
  for (const tn of nodes) {
    const text = tn.nodeValue || '';
    const cites: { start: number; end: number; hit: LawHit }[] = [];
    let m: RegExpExecArray | null;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(text))) {
      if (m[1]) {
        const lw = lawFromKeyword(m[1]);
        if (lw) cur = lw;
      } else if (m[2]) {
        const key = m[3] + (m[4] ? '-' + m[4] : '');
        cites.push({ start: m.index, end: m.index + m[2].length, hit: { law: cur || fallbackLaw(refs, key), key, art: m[2].replace(/\s+/g, '') } });
      }
    }
    if (!cites.length || !tn.parentNode) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const c of cites) {
      if (c.start > last) frag.appendChild(document.createTextNode(text.slice(last, c.start)));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lawref';
      b.textContent = text.slice(c.start, c.end);
      b.title = '条文の要点と公式リンクを表示';
      b.addEventListener('click', (e) => { e.stopPropagation(); onHit(c.hit); });
      frag.appendChild(b);
      last = c.end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    tn.parentNode.replaceChild(frag, tn);
  }
}

export function resolveLaw(refs: LawRefs, h: LawHit): LawCard {
  const info = refs.laws.find((l) => l.key === h.law) || refs.laws.find((l) => l.key === 'junsoku')!;
  const summary = refs.summaries[h.law + '|' + h.key] || 'この条文の要点は解説本文を参照してください。下のリンクから公式の条文原文を確認できます。';
  let href = info.url, linkText = '', note = '';
  if (h.law === 'junsoku') {
    const pg = refs.junsokuPages[h.key];
    if (pg) {
      href += '#page=' + pg;
      linkText = `準則PDFの${h.art}へ`;
      note = `準則は国土地理院の告示です。全文PDF（約2MB）を開くと、この条文が載っている ${pg} ページ目へ自動でジャンプします。`;
    } else {
      linkText = '準則の全文PDFを見る';
      note = '準則には条文別のページがありません。全文PDF（約2MB）内でこの条番号を検索してください。';
    }
  } else {
    href += '#Mp-At_' + h.key.replace('-', '_');
    linkText = `e-Gov で${h.art}を見る`;
    note = 'リンク先は e-Gov 法令検索で、この条文の位置に自動でジャンプします。条番号は改正で変わることがあります。';
  }
  return { title: h.art, name: info.name, summary, href, linkText, note };
}
