"""解説の書き手に渡す入力（tools/kaisetsu/in/<年>_NN-NN.json）を作る。答えが RETIO と参考サイトで食い違う問を出す。
使い方: python tools/kaisetsu/make_in.py <年 r06 など>
"""
import csv
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
y = sys.argv[1]
qs = {q['id']: q for q in json.load(open(os.path.join(ROOT, 'src/data/questions.json'), encoding='utf-8'))}
sh = {r['問']: r for r in csv.DictReader(open(os.path.join(ROOT, f'tools/kaisetsu/shougou_{y}.tsv'), encoding='utf-8'), delimiter='\t')}
bad = []
for lo in range(1, 51, 10):
    out = []
    for n in range(lo, lo + 10):
        q = qs[f'{y}-q{n}']
        s = sh[str(n)]
        if s['siken答え'] != str(q['answer']) or not s['success答え'].startswith(str(q['answer'])):
            bad.append((n, q['ok'], s['siken答え'], s['success答え']))
        out.append({'id': f'{y}-{n}', 'year': q['yearLabel'], 'num': n, 'category': q['category'],
                    'stem': q['statementText'], 'extra': q['tablesHtml'],
                    'items': [[i['key'], i['text']] for i in q['items']],
                    'choices': [[c['key'], c['text']] for c in q['choices']],
                    'answer_retio': q['ok'],
                    'site_verdicts': {'siken': s['siken肢'], 'success': s['success肢']}})
    json.dump(out, open(os.path.join(ROOT, f'tools/kaisetsu/in/{y}_{lo:02d}-{lo + 9:02d}.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
print(y, '答えが食い違う問:', bad)
