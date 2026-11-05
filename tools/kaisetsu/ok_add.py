"""検証を通った解説を tools/kaisetsu/ok.tsv に載せる（id と解説の md5）。載った物だけがサイトに出る。
解説を後で書き換えると md5 が合わなくなり、サイトでは「準備中」に戻る（もう一度検証してから載せ直す）。

使い方: python tools/kaisetsu/ok_add.py <out の json> <id ...>   例: ... out/r07_01-10.json r07-1 r07-2
        id の代わりに all で、その json の全部
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from site_data import kmd5  # noqa: E402

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ok.tsv')
f, ids = sys.argv[1], sys.argv[2:]
d = json.load(open(f, encoding='utf-8'))
if ids == ['all']:
    ids = list(d)
rows = {}
if os.path.exists(P):
    for line in open(P, encoding='utf-8').read().split('\n')[1:]:
        if line.strip():
            rows[line.split('\t')[0]] = line
today = datetime.date.today().isoformat()
for i in ids:
    rows[i] = f'{i}\t{kmd5(d[i])}\t{today}'
with open(P, 'w', encoding='utf-8', newline='') as w:
    w.write('id\tmd5\t日付\n' + '\n'.join(rows[k] for k in sorted(rows)) + '\n')
print(len(ids), '問を載せた・計', len(rows))
