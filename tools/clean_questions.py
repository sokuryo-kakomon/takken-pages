"""本人がまとめた問題文テキストを、RETIO の原文の書き方に戻して 1問1行の JSONL にする。

使い方: python tools/clean_questions.py <本人のテキスト> <出力 jsonl>
- 分野名だけの行（税その他・法令制限・宅建業法・権利関係）を消す
- 選択肢の頭（「１．」「１　」）をそろえる
- 略語（宅建士・宅建業者 など）を原文の言葉に戻す
- 選択肢が無い問・原文に無い語が残る問は needs に理由を入れる（直すのは本人）
"""
import json
import re
import sys

LABELS = {'税その他', '法令制限', '宅建業法', '権利関係'}
# 長い語から先に戻す
ABBR = [
    ('宅建業法', '宅地建物取引業法'),
    ('宅建士証', '宅地建物取引士証'),
    ('宅建士', '宅地建物取引士'),
    ('宅建業者', '宅地建物取引業者'),
    ('宅建業', '宅地建物取引業'),
]
ZEN = str.maketrans('０１２３４５６７８９－', '0123456789-')


def year_id(head):
    t = head.translate(ZEN)
    m = re.search(r'(令和|平成)(\d+|元)年(\d+)?月?\s*-\s*問(\d+)', t)
    n = 1 if m.group(2) == '元' else int(m.group(2))
    y = ('r' if m.group(1) == '令和' else 'h') + f'{n:02d}' + (f'-{m.group(3)}' if m.group(3) else '')
    return y, int(m.group(4))


def expand(text):
    for a, b in ABBR:
        text = text.replace(a, b)
    return text


def parse(body):
    lines = [l.rstrip() for l in body.split('\n')]
    stem = lines[0].strip()
    rest = [l.strip() for l in lines[1:] if l.strip() and l.strip() not in LABELS]
    items, choices, extra = [], [], []
    for l in rest:
        m = re.match(r'^([１-４1-4])[．.\s　]\s*(.*)$', l)
        k = re.match(r'^([アイウエオ])[\s　]+(.*)$', l)
        if m:
            choices.append([m.group(1).translate(ZEN), m.group(2)])
        elif k:
            items.append([k.group(1), k.group(2)])
        elif choices:
            choices[-1][1] += l  # 選択肢の続きの行
        elif items:
            items[-1][1] += l
        else:
            extra.append(l)  # （判決文）や表など、問いと肢の間の文
    return stem, extra, items, choices


def main():
    src, out = sys.argv[1], sys.argv[2]
    s = open(src, encoding='utf-8-sig').read()
    heads = list(re.finditer(r'【([^】]*)】', s))
    rows = []
    for i, h in enumerate(heads):
        y, q = year_id(h.group(1))
        end = heads[i + 1].start() if i + 1 < len(heads) else len(s)
        stem, extra, items, choices = parse(expand(s[h.end():end]))
        needs = []
        if [c[0] for c in choices] != ['1', '2', '3', '4']:
            needs.append('選択肢1〜4が無い')
        if '改題' in stem:
            needs.append('改題（原文に戻す）')
        rows.append({'y': y, 'q': q, 'stem': stem, 'extra': extra, 'items': items,
                     'choices': choices, 'needs': needs})
    with open(out, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(len(rows), 'questions,', sum(1 for r in rows if r['needs']), 'need fixes')


if __name__ == '__main__':
    main()
