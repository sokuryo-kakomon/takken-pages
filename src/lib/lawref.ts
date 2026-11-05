import type { LawRefs } from './types';

// 解説本文中の「第◯条」を押せるようにし、e-Gov の条文へのリンクを出す。
// 直前に出てきた法令名（民法／借地借家法／宅建業法 …）を文脈として持ち回る。
// 法令名がまだ出ていなければ、分野ごとの既定（権利関係→民法・宅建業法→宅建業法）を使い、それも無ければリンクにしない。

export interface LawHit { law: string; key: string; art: string }
export interface LawCard { title: string; name: string; summary: string; href: string; linkText: string; note: string }

// 長い名前を先に（「宅地建物取引業法施行規則」などは法律ではないので、名前の後ろに「施行」が続くときは外す）
const NAMES: [string, string][] = [
  ['建物の区分所有等に関する法律', 'kubun'], ['区分所有法', 'kubun'],
  ['借地借家法', 'shakuchi'], ['不動産登記法', 'fudosantouki'],
  ['宅地建物取引業法', 'takkengyoho'], ['宅建業法', 'takkengyoho'],
  ['都市計画法', 'toshikeikaku'], ['建築基準法', 'kenchikukijun'], ['国土利用計画法', 'kokudoriyo'],
  ['農地法', 'nochi'], ['宅地造成及び特定盛土等規制法', 'moridome'], ['盛土規制法', 'moridome'],
  ['土地区画整理法', 'kukakuseiri'], ['地価公示法', 'chikakoji'],
  ['住宅の品質確保の促進等に関する法律', 'hinkaku'], ['品確法', 'hinkaku'],
  ['特定住宅瑕疵担保責任の履行の確保等に関する法律', 'kashitanpo'], ['住宅瑕疵担保履行法', 'kashitanpo'],
  ['不当景品類及び不当表示防止法', 'keihyo'], ['景品表示法', 'keihyo'],
  ['独立行政法人住宅金融支援機構法', 'kikou'], ['租税特別措置法', 'sochi'], ['地方税法', 'chihozei'],
  ['印紙税法', 'inshi'], ['登録免許税法', 'tourokumenkyo'], ['所得税法', 'shotoku'], ['民法', 'minpo'],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 施行令・施行規則・規則・告示などの条番号は e-Gov の法律の条ではないので、出てきたらその後はリンクしない（次の法令名まで）
const TOK = new RegExp(`(${NAMES.map(([n]) => esc(n)).join('|')})(?!施行)|(施行令|施行規則|規則|告示|政令|省令|規約)|(第\\s*(\\d+)\\s*条(?:の(\\d+))?)`, 'g');
const KEY = new Map(NAMES);

export function linkifyLawRefs(root: HTMLElement, refs: LawRefs, onHit: (h: LawHit) => void, defaultLaw?: string) {
  if (root.dataset.lawified) return;
  root.dataset.lawified = '1';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  for (const tn of nodes) {
    // 肢ごとの段落で文脈を切る（前の肢の法令名を引きずらない）
    let cur: string | null = defaultLaw ?? null;
    const text = tn.nodeValue || '';
    const cites: { start: number; end: number; hit: LawHit }[] = [];
    let m: RegExpExecArray | null;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(text))) {
      if (m[1]) {
        cur = KEY.get(m[1]) ?? cur;
      } else if (m[2]) {
        cur = null;
      } else if (m[3] && cur && refs.laws.some((l) => l.key === cur)) {
        const key = m[4] + (m[5] ? '-' + m[5] : '');
        cites.push({ start: m.index, end: m.index + m[3].length, hit: { law: cur, key, art: m[3].replace(/\s+/g, '') } });
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
      b.title = '条文の公式リンクを表示';
      b.addEventListener('click', (e) => { e.stopPropagation(); onHit(c.hit); });
      frag.appendChild(b);
      last = c.end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    tn.parentNode.replaceChild(frag, tn);
  }
}

export function resolveLaw(refs: LawRefs, h: LawHit): LawCard {
  const info = refs.laws.find((l) => l.key === h.law)!;
  const summary = refs.summaries[h.law + '|' + h.key] || 'この条文の中身は下のリンクから e-Gov 法令検索で確認できます。';
  return {
    title: h.art, name: info.name, summary,
    href: info.url + '#Mp-At_' + h.key.replace('-', '_'),
    linkText: `e-Gov で${h.art}を見る`,
    note: 'リンク先は e-Gov 法令検索（現行の条文）で、この条文の位置に自動でジャンプします。出題当時から改正されていることがあります。',
  };
}
