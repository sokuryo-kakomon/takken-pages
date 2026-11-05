"""未確認の問を本人が PDF と見較べて直す1枚の HTML を作る（takken-pages の外に置く）。

使い方: python tools/naoshi_html.py <出力フォルダ>
- 問ごとに「今の文（直す欄）／本人の元の文／OCR 2回／PDF のその問の画像」を並べ、OCR のどちらとも合わない字に色を付ける
- 直したら「PDF と見較べた」に印→「書き出す」で tegaki_naoshi.json が落ちる→ python tools/apply_hand.py ocr/genbun.jsonl <その json>
- 打った途中の文はブラウザに残る（同じ問の元の文が変わったら消える）
"""
import csv
import difflib
import glob
import html
import json
import os
import re
import sys
import unicodedata

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from apply_hand import body, md5  # noqa: E402
from write_txt import label  # noqa: E402

ORDER = ['r07', 'r06', 'r05', 'r04', 'r03-12', 'r03-10', 'r02-12', 'r02-10', 'r01', 'h30', 'h29', 'h28', 'h27']


def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))


def ocr_q(base, y):
    """OCR の文を【問N】で問ごとに切る。{問: (行の並び, ページの集まり)}"""
    out, qn = {}, 0
    for pg in sorted(glob.glob(os.path.join(base, y, 'p*.txt'))):
        for raw in open(pg, encoding='utf-8'):
            line = norm(raw)
            m = re.match(r'^【?[問間]?(\d+)】', line)
            if m and qn < int(m.group(1)) <= qn + 3:
                qn = int(m.group(1))
            if qn and line:
                lines, pages = out.setdefault(qn, ([], set()))
                lines.append(line)
                pages.add(os.path.basename(pg)[:-4])
    return out


def crop(y, q, pages, dest):
    """PDF のページ画像から、その問の所を切り出して1枚にする。見出しが読めていなければページを丸ごと。"""
    rows = [l.split('\t') for l in open(f'ocr/lines/{y}.tsv', encoding='utf-8').read().split('\n') if l]
    rows = [(p, int(b), int(d), norm(t)) for p, a, b, c, d, t in rows]
    hd = [x for x in rows if re.match(rf'^【?[問間]?{q}】', x[3])]
    nx = [x for x in rows if re.match(rf'^【?[問間]?{q + 1}】', x[3])]
    parts = []
    if hd:
        p0, y0 = hd[0][0], hd[0][1] - 15
        p1, y1 = (nx[0][0], nx[0][1] - 10) if nx and nx[0][0] >= p0 else (p0, None)
        for pi in range(int(p0[1:]), int(p1[1:]) + 1):
            im = Image.open(f'ocr/_work/{y}/p{pi:02d}.png')
            top = y0 if pi == int(p0[1:]) else 100
            bot = (y1 if y1 else max(x[2] for x in rows if x[0] == p0) + 10) if pi == int(p1[1:]) else im.height - 120
            if bot > top:
                parts.append(im.crop((80, top, im.width - 60, bot)))
    else:
        parts = [Image.open(f'ocr/_work/{y}/{p}.png') for p in sorted(pages)]
    if not parts:
        return False
    w, h = max(i.width for i in parts), sum(i.height for i in parts)
    out, yy = Image.new('L', (w, h), 255), 0
    for i in parts:
        out.paste(i.convert('L'), (0, yy))
        yy += i.height
    out.resize((int(w * 0.6), int(h * 0.6))).save(dest, optimize=True)
    return True


def marked(text, refs):
    """text の字のうち、refs（OCR 2回）のどちらとも並ばなかった字に色を付けた HTML。改行は残す。"""
    flat = text.replace('\n', '')
    ok = [False] * len(flat)
    for ref in refs:
        sm = difflib.SequenceMatcher(None, norm(flat), ref, autojunk=False)
        for a, _, n in sm.get_matching_blocks():
            if n >= 3:
                for i in range(a, a + n):
                    ok[i] = True
    out, i = [], 0
    for ch in text:
        if ch == '\n':
            out.append('<br>')
            continue
        e = html.escape(ch)
        out.append(e if ok[i] else f'<mark>{e}</mark>')
        i += 1
    return ''.join(out).replace('</mark><mark>', '')


def main():
    dest = sys.argv[1]
    os.makedirs(os.path.join(dest, 'img'), exist_ok=True)
    rows = [json.loads(l) for l in open('ocr/genbun.jsonl', encoding='utf-8')]
    users = {(r['y'], r['q']): r for r in (json.loads(l) for l in open('ocr/questions.jsonl', encoding='utf-8'))}
    ask = {}
    for x in csv.DictReader(open('ocr/kakunin.tsv', encoding='utf-8'), delimiter='\t'):
        ask.setdefault((x['年'], x['問']), []).append(x)
    todo = sorted((r for r in rows if not r['verified'] and r['y'] in ORDER),
                  key=lambda r: (ORDER.index(r['y']), r['q']))
    reads = {}
    cards = []
    for r in todo:
        y, q = r['y'], r['q']
        for d in ('ocr', 'ocr2'):
            if (d, y) not in reads:
                reads[d, y] = ocr_q(d, y)
        o1, o2 = (reads[d, y].get(q, ([], set())) for d in ('ocr', 'ocr2'))
        img = f'img/{y}_{q:02d}.png'
        has_img = crop(y, q, o1[1] | o2[1], os.path.join(dest, img))
        text = body(r)
        why = []
        if r.get('yomezu'):
            why.append(f'OCR と並ばなかった字 {len(r["yomezu"])}か所（原文に無い書き足しのことがある）')
        for x in ask.get((y, str(q)), []):
            why.append(f'決まらなかった所: 本人「{x["本人"]}」／読み1「{x["読み1"]}」／読み2「{x["読み2"]}」')
        for n in r['needs']:
            why.append(n)
        cards.append({
            'key': f'{y}:{q}', 'title': f'{label(y)} 問{q}', 'base': md5(text), 'text': text,
            'why': why, 'now': marked(text, [''.join(o1[0]), ''.join(o2[0])]),
            'user': html.escape(body(users[y, q])).replace('\n', '<br>') if (y, q) in users else '',
            'o1': html.escape('\n'.join(o1[0])).replace('\n', '<br>'),
            'o2': html.escape('\n'.join(o2[0])).replace('\n', '<br>'),
            'img': img if has_img else '',
        })
    page = open(os.path.join(os.path.dirname(__file__), 'naoshi_template.html'), encoding='utf-8').read()
    page = page.replace('/*DATA*/[]', json.dumps(cards, ensure_ascii=False).replace('</', '<\\/'))
    with open(os.path.join(dest, '宅建_直す表.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    print(len(cards), '問', dest)


if __name__ == '__main__':
    main()
