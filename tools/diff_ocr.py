"""本人の問題文（questions.jsonl）と Windows の OCR（ocr/<年>/pNN.txt）を突き合わせ、違う所を一覧にする。

使い方: python tools/diff_ocr.py ocr/questions.jsonl ocr/diff.tsv
- OCR の1行ずつを、その年の本人の文の中で探して較べる（OCR は行の順を入れ替えたり行を落としたりするので、
  行ごとに探す。OCR に無い所は較べない＝「OCRの覆い」が低い問は目で見る）
- 種類: 抜け＝OCR にあり本人に無い／足し＝本人にあり OCR に無い／違い＝字が違う
- 正しいかどうかは PDF を見て決める（この道具は場所を出すだけ）
"""
import difflib
import glob
import json
import os
import re
import sys
import unicodedata


def norm(s):
    # 丸数字は残す（NFKC で ①→1 になり、h27 問3「①賃貸借契約」が「1賃貸借契約」になっていた）
    s = ''.join(p if re.fullmatch(r'[①-⑳]', p) else unicodedata.normalize('NFKC', p) for p in re.split(r'([①-⑳])', s))
    return re.sub(r'\s+', '', s)


def qtext(r):
    parts = [r['stem']] + r['extra'] + [k + t for k, t in r['items']] + [k + t for k, t in r['choices']]
    return norm(''.join(parts))


def locate(user, line, lo, hi, n=6):
    """OCR の1行が本人の文の lo〜hi のどこに当たるか（多数決・無ければ -1）。"""
    votes = {}
    for i in range(0, len(line) - n + 1, 2):
        g = line[i:i + n]
        p = user.find(g, lo, hi)
        hits = 0
        while p >= 0 and hits < 3:  # よくある言い回しは票にしない
            votes.setdefault((p - i) // 8, []).append(p - i)
            p = user.find(g, p + 1, hi)
            hits += 1
    if not votes:
        return -1, 0
    k = max(votes, key=lambda k: len(votes[k]) + len(votes.get(k - 1, [])) + len(votes.get(k + 1, [])))
    got = len(votes[k]) + len(votes.get(k - 1, [])) + len(votes.get(k + 1, []))
    return max(0, min(votes[k])), got


def main():
    src, out = sys.argv[1], sys.argv[2]
    rows = [json.loads(l) for l in open(src, encoding='utf-8')]
    base = os.path.dirname(src)
    res, cover = [], []
    for y in sorted({r['y'] for r in rows}):
        pages = sorted(glob.glob(os.path.join(base, y, 'p*.txt')))
        if not pages:
            continue
        qs = sorted((r for r in rows if r['y'] == y), key=lambda r: r['q'])
        texts = [qtext(r) for r in qs]
        user = ''.join(texts)
        starts, s = [], 0
        for t in texts:
            starts.append(s)
            s += len(t)
        covered = [False] * len(user)
        cur = 0  # ページは問の順に並ぶので、直前に当たった所の近くから探す
        for pg in pages:
            for raw in open(pg, encoding='utf-8').read().split('\n'):
                line = norm(re.sub(r'^【?問\d+】', '', norm(raw)))
                if len(line) < 8:
                    continue
                need = max(2, len(line) // 10)
                p, got = locate(user, line, max(0, cur - 1500), cur + 4000)
                if p < 0 or got < need:
                    p, got = locate(user, line, 0, len(user))
                    if p < 0 or got < max(need, len(line) // 4):
                        continue  # 本人の文に当たらない行（表紙・ページ番号・読めない行）
                cur = p
                win = user[p:p + len(line) + 12]
                sm = difflib.SequenceMatcher(None, line, win, autojunk=False)
                ops = sm.get_opcodes()
                # 窓の尻の余りは除く
                while ops and ops[-1][0] == 'insert':
                    ops.pop()
                if not ops:
                    continue
                end = p + ops[-1][4]
                for i in range(p, end):
                    covered[i] = True
                qi = max(i for i, st in enumerate(starts) if st <= p)
                for tag, a1, a2, b1, b2 in ops:
                    if tag == 'equal':
                        continue
                    kind = {'replace': '違い', 'delete': '抜け', 'insert': '足し'}[tag]
                    u0, u1 = p + b1, p + b2
                    ctx = user[max(starts[qi], u0 - 10):u0] + '［' + user[u0:u1] + '］' + user[u1:u1 + 10]
                    res.append((y, qs[qi]['q'], kind, user[u0:u1], line[a1:a2], ctx, os.path.basename(pg)[:-4]))
        for qi, r in enumerate(qs):
            a, b = starts[qi], starts[qi] + len(texts[qi])
            cover.append((y, r['q'], sum(covered[a:b]) / max(1, b - a)))
    with open(out, 'w', encoding='utf-8') as f:
        f.write('年\t問\t種類\t本人\tOCR\t前後（本人の字）\tページ\n')
        for x in sorted(res, key=lambda x: (x[0], x[1])):
            f.write('\t'.join(str(v) for v in x) + '\n')
    with open(out.replace('.tsv', '_覆い.tsv'), 'w', encoding='utf-8') as f:
        f.write('年\t問\tOCRの覆い\n')
        for y, q, c in cover:
            f.write(f'{y}\t{q}\t{c:.3f}\n')


if __name__ == '__main__':
    main()
