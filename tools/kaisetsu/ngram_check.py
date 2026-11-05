"""解説が参考サイトの文を写していないかを 8字の連なりで当てる。

使い方: python tools/kaisetsu/ngram_check.py <サイトの文の置き場 sankou/> <out の json ...>
- 解説（lead・notice・points・hint）の 8-gram のうち、問題文（RETIO の原文）に無く、サイトの解説文にある物を数える
- 続いた当たりは1つの字面にまとめて出す。条文の言い回し・判例の要旨など、誰が書いても同じになる所も当たるので、字面を見て決める
- 結果は1問1行: id・当たった字数・字面
"""
import json
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))


def grams(s):
    return {s[i:i + 8] for i in range(len(s) - 7)}


def spans(t, hit):
    out, i = [], 0
    while i < len(t) - 7:
        if t[i:i + 8] in hit:
            j = i
            while j < len(t) - 7 and t[j:j + 8] in hit:
                j += 1
            out.append(t[i:j + 7])
            i = j
        else:
            i += 1
    return out


def main():
    site_dir, files = sys.argv[1], sys.argv[2:]
    qs = {q['id']: q for q in json.load(open(os.path.join(ROOT, 'src', 'data', 'questions.json'), encoding='utf-8'))}
    for f in files:
        for i, k in json.load(open(f, encoding='utf-8')).items():
            y, n = i.rsplit('-', 1)
            q = qs[f'{y}-q{n}']
            src = norm(q['statementText'] + ''.join(q['tablesHtml']) + ''.join(x['text'] for x in q['items'] + q['choices']))
            mine = [k.get('lead', ''), k.get('notice') or '', k.get('hint', '')] + [p['t'] for p in k['points']]
            sites = ''
            for name in ('siken', 'success'):
                p = os.path.join(site_dir, y, f'{int(n):02d}_{name}.txt')
                if os.path.exists(p):
                    sites += norm(open(p, encoding='utf-8').read())
            sg, qg = grams(sites), grams(src)
            found = []
            for t in mine:
                t = norm(t)
                found += spans(t, (grams(t) & sg) - qg)
            print(i, sum(len(s) for s in found), ' | '.join(found), sep='\t')


if __name__ == '__main__':
    main()
