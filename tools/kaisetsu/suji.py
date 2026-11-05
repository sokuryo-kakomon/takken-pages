"""解説の条番号の漢数字（第二十五条・第三項・条の二）を算用数字に直す。lawref.ts は施行令・規則の後をリンクしないので、漢数字で逃がす必要は無い。

使い方: python tools/kaisetsu/suji.py <out の json ...>
"""
import json
import re
import sys

D = {c: i for i, c in enumerate('〇一二三四五六七八九')}


def num(s):
    n, cur = 0, 0
    for c in s:
        if c in D:
            cur = D[c]
        else:
            n += (cur or 1) * {'十': 10, '百': 100, '千': 1000}[c]
            cur = 0
    return n + cur


def fix(t):
    t = re.sub(r'第([〇一二三四五六七八九十百千]+)(条|項|号)', lambda m: f'第{num(m.group(1))}{m.group(2)}', t)
    return re.sub(r'(条|項|号)の([〇一二三四五六七八九十]+)', lambda m: f'{m.group(1)}の{num(m.group(2))}', t)


for f in sys.argv[1:]:
    d = json.load(open(f, encoding='utf-8'))
    n = 0
    for k in d.values():
        for key in ('lead', 'notice', 'hint'):
            if k.get(key):
                new = fix(k[key]); n += new != k[key]; k[key] = new
        for p in k['points']:
            new = fix(p['t']); n += new != p['t']; p['t'] = new
    json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f, n, '箇所')
