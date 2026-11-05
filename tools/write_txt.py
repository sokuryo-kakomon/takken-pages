"""genbun.jsonl を本人のテキストと同じ形（【宅建過去問 令和7年－問1】…）に書き出す。確認表も Excel で開ける CSV にする。

使い方: python tools/write_txt.py ocr/genbun.jsonl ocr/kakunin.tsv <出力 txt> <出力 csv>
- 照合のために半角にした字を、RETIO の PDF の書き方に戻す（英字・かっこは全角、数字は半角、m2 は ㎡）
"""
import csv
import json
import re
import sys

ERA = {'r': '令和', 'h': '平成'}
ZEN = str.maketrans({**{chr(c): chr(c + 0xFEE0) for c in range(ord('A'), ord('Z') + 1)},
                     **{chr(c): chr(c + 0xFEE0) for c in range(ord('a'), ord('z') + 1)},
                     '(': '（', ')': '）', '~': '～'})


def pdf_style(s):
    s = re.sub(r'(?<=\d)m2', '㎡', s)
    return s.translate(ZEN).replace('ｍ２', '㎡')


def label(y):
    m = re.match(r'([rh])(\d+)(?:-(\d+))?', y)
    n = int(m.group(2))
    return ERA[m.group(1)] + ('元' if n == 1 else str(n)) + '年' + (m.group(3) + '月' if m.group(3) else '')


def main():
    src, table, out_txt, out_csv = sys.argv[1:5]
    rows = [json.loads(l) for l in open(src, encoding='utf-8')]
    with open(out_txt, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(f"【宅建過去問 {label(r['y'])}－問{r['q']}】{pdf_style(r['stem'])}\n\n")
            for t in r['extra']:
                f.write(pdf_style(t) + '\n')
            for k, t in r['items']:
                f.write(f'{k}　{pdf_style(t)}\n')
            for k, t in r['choices']:
                f.write(f"{chr(ord(k) + 0xFEE0)}　{pdf_style(t)}\n")
            f.write('\n')
    with open(out_csv, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['年', '問', '所', 'PDFの枚目', '本人の字', '読み取り1', '読み取り2', '前後（本人の文・［］が違う所）', '正しい字（PDF を見て書く）'])
        for x in csv.DictReader(open(table, encoding='utf-8'), delimiter='\t'):
            w.writerow([label(x['年']) if x['年'] != '?' else '?', x['問'], x['所'], x['ページ'].replace('p', ''),
                        x['本人'], x['読み1'], x['読み2'], x['前後（本人の字）'], ''])
        for r in rows:
            for n in r['needs']:
                w.writerow([label(r['y']), r['q'], '', '', '', '', '', n, ''])
            for g in r.get('yomezu', []):
                w.writerow([label(r['y']), r['q'], '', '', g, '', '',
                            'OCR と並ばなかった本人の字（原文に無い書き足しのことがある・PDF と見較べる）', ''])
            if 'ocr_cover' not in r and r['q'] == 1:
                w.writerow([label(r['y']), '全問', '', '', '', '', '', 'RETIO の PDF が未公表のため突き合わせていない', ''])


if __name__ == '__main__':
    main()
