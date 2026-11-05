"""肢1〜4が無い問（「いくつあるか」と組合せ）に肢を入れる。

使い方: python tools/fill_choices.py ocr/genbun.jsonl ocr ocr2
- 「いくつあるか」は 1 一つ 2 二つ 3 三つ 4 四つ（4 が「なし」の年があるので、OCR の問の尻で決める）
- 組合せ（と OCR で決まらなかった「いくつ」）は PDF を見て起こした tools/choices_kumiawase.tsv から
- 入れられなかった問は needs に残す
"""
import csv
import json
import os
import re
import sys
import unicodedata


def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))


def ocr_tail(base, y, q):
    """OCR のその問の文（【問q】から【問q+1】の前まで）。"""
    text, on = '', False
    d = os.path.join(base, y)
    for name in sorted(os.listdir(d)):
        if not name.endswith('.txt'):
            continue
        for raw in open(os.path.join(d, name), encoding='utf-8'):
            m = re.match(r'^【?[問間]?(\d+)】', norm(raw))
            if m:
                on = int(m.group(1)) == q
            if on:
                text += norm(raw)
    return text


def main():
    src, bases = sys.argv[1], sys.argv[2:]
    here = os.path.dirname(__file__)
    combo = {(r['年'], int(r['問'])): [r['肢%d' % i] for i in range(1, 5)]
             for r in csv.DictReader(open(os.path.join(here, 'choices_kumiawase.tsv'), encoding='utf-8'), delimiter='\t')}
    rows = [json.loads(l) for l in open(src, encoding='utf-8')]
    n = {'いくつ': 0, 'なし': 0, '組合せ': 0, '残り': 0}
    for r in rows:
        if [c[0] for c in r['choices']] == ['1', '2', '3', '4']:
            continue
        key = (r['y'], r['q'])
        if key in combo:
            r['choices'] = [[str(i + 1), c] for i, c in enumerate(combo[key])]
            n['組合せ'] += 1
        elif 'いくつ' in r['stem'] and r['y'] != 'r08':
            tails = [ocr_tail(b, *key)[-30:] for b in bases if os.path.isdir(os.path.join(b, r['y']))]
            # 「一つ二つ三つなし」は「つつつし」「14なし」、「四つ」は「つつつつ」とも読まれる
            nashi = any(re.search(r'(つ|\d|ー|-)なし|つつつし', t) for t in tails)
            yon = any(re.search(r'四つ|つつつつ', t) for t in tails)
            if nashi == yon:
                n['残り'] += 1
                r['needs'] = [x for x in r['needs'] if not x.startswith('選択肢')] + ['選択肢4が四つかなしか']
                continue
            r['choices'] = [['1', '一つ'], ['2', '二つ'], ['3', '三つ'], ['4', 'なし' if nashi else '四つ']]
            n['いくつ'] += 1
            n['なし'] += nashi
        else:
            n['残り'] += 1
            continue
        r['needs'] = [x for x in r['needs'] if not x.startswith('選択肢')]
    with open(src, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(n)


if __name__ == '__main__':
    main()
