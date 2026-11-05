"""目で PDF と見較べた問を genbun.jsonl に戻す（未確認→確認済み）。merge_ocr・fill_choices の後、write_txt の前に流す。

使い方: python tools/apply_hand.py ocr/genbun.jsonl [本人が直した json]
- tools/mokushi_ok.tsv: 文を変えずに PDF と1字ずつ見較べて一致した問（年・問・文の md5・日付）。
  後で道具を直して文が変わったら md5 が合わなくなり、未確認に戻る
- 本人が直した json（直す表の「書き出す」で落ちる tegaki_naoshi.json）: 問ごとの直した文で置き換え、確認済みにする
  形は {"h30:31": {"text": "問いの文\\n\\nア　…\\n1　…", "base": 直す前の文の md5}, ...}
"""
import csv
import hashlib
import json
import os
import re
import sys


def body(r):
    """1問の文を直す表と同じ形の1つの文字列にする（md5 と表の両方で使う）。"""
    lines = [r['stem'], ''] + list(r['extra']) + [f'{k}　{t}' for k, t in r['items']] + [f'{k}　{t}' for k, t in r['choices']]
    return '\n'.join(lines)


def md5(s):
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def parse(text):
    """直す表の文を stem・extra・items・choices に戻す。"""
    lines = [l.strip() for l in text.replace('\r', '').split('\n')]
    blank = lines.index('') if '' in lines else 1
    stem, rest = ''.join(lines[:blank]), [l for l in lines[blank:] if l]
    extra, items, choices = [], [], []
    for l in rest:
        m = re.match(r'^([アイウエオ]|[1-4１-４])[\s　]+(.*)$', l)
        if not m:
            extra.append(l)
        elif m.group(1) in 'アイウエオ':
            items.append([m.group(1), m.group(2)])
        else:
            choices.append([str('１２３４'.find(m.group(1)) + 1) if m.group(1) in '１２３４' else m.group(1), m.group(2)])
    return stem, extra, items, choices


def main():
    src = sys.argv[1]
    hand = sys.argv[2] if len(sys.argv) > 2 else None
    rows = [json.loads(l) for l in open(src, encoding='utf-8')]
    ok = {(x['年'], int(x['問'])): x['md5']
          for x in csv.DictReader(open(os.path.join(os.path.dirname(__file__), 'mokushi_ok.tsv'), encoding='utf-8'),
                                  delimiter='\t')}
    fixes = json.load(open(hand, encoding='utf-8')) if hand and os.path.exists(hand) else {}
    n = {'目視で一致': 0, '目視の後に文が変わった': 0, '本人が直した': 0, '直す前の文が変わった': 0}
    for r in rows:
        key = (r['y'], r['q'])
        f = fixes.get(f'{r["y"]}:{r["q"]}')
        if f:
            if f.get('base') and f['base'] != md5(body(r)):
                n['直す前の文が変わった'] += 1  # 道具を直して元の文が動いた→表を作り直して見てもらう
            else:
                r['stem'], r['extra'], r['items'], r['choices'] = parse(f['text'])
                r['verified'], r['hand'] = True, True
                n['本人が直した'] += 1
                continue
        if key in ok:
            if ok[key] == md5(body(r)):
                r['verified'], r['mokushi'] = True, True
                n['目視で一致'] += 1
            else:
                n['目視の後に文が変わった'] += 1
    with open(src, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(n)


if __name__ == '__main__':
    main()
