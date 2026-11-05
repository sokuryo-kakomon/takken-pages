"""本人の問題文と OCR 2回分（ocr/・ocr2/）の3つで多数決して、原文に戻した問題文を作る。

使い方: python tools/merge_ocr.py ocr/questions.jsonl ocr ocr2 <出力 jsonl> <確認表 tsv>
- 違う所ごとに「本人・読み1・読み2」の3つを並べ、2つ以上が同じならそれにする
  （OCR 2回が同じで本人だけ違う＝本人の側の書き換えか打ち間違い→OCR にする）
- 決まらない所（3つとも違う・OCR が片方しか読めていない）は本人の字のまま残し、確認表に出す
- 本人の文を OCR がどちらも読めていない所は本人の字のまま（数は確認表の頭に出す）
"""
from Bio import Align
import glob
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(__file__))
from diff_ocr import norm  # noqa: E402


def segments(r):
    segs = [('問い', r['stem'])] + [('文%d' % i, t) for i, t in enumerate(r['extra'])]
    segs += [(k, k + t) for k, t in r['items']] + [('肢' + k, k + t) for k, t in r['choices']]
    return [(n, norm(t)) for n, t in segs if norm(t)]


def read_edits(base, y, user, qspan):
    """1回分の OCR を【問N】で問ごとに切り、本人のその問の文と丸ごと並べる。
    (始め, 終わり, OCR の字, ページ) の直しと、読めた所の印を返す。"""
    edits, covered = [], [False] * len(user)
    qn, per_q, keys = 1, {}, {}
    OCRQ[base, y] = per_q
    for pg in sorted(glob.glob(os.path.join(base, y, 'p*.txt'))):
        for raw in open(pg, encoding='utf-8').read().split('\n'):
            m = re.match(r'^【?[問間](\d+)】', norm(raw))
            if m and qn < int(m.group(1)) <= qn + 3 and int(m.group(1)) in qspan:
                qn = int(m.group(1))
            line = norm(re.sub(r'^【?[問間]\d+】', '', norm(raw)))
            line = line.replace('この間において', 'この問において').replace('似下この', '(以下この')  # よくある読み違い
            if len(line) < 3 or re.fullmatch(r'[-‐ー一\d]+', line):
                continue  # ページ番号など
            k = re.match(r'^([1-4]|[アイウエ])(?=\D)', line)
            if k:
                keys.setdefault(qn, []).append(k.group(1))
            text, pages = per_q.setdefault(qn, ['', set()])
            per_q[qn][0] += line
            pages.add(os.path.basename(pg)[:-4])
    for q, ks in keys.items():  # 肢の番号が 1→4・ア→エ の順に出てこない問＝行の順が入れ替わったページ
        num = [k for k in ks if k.isdigit()]
        kat = [k for k in ks if not k.isdigit()]
        if num != sorted(num) or kat != sorted(kat, key='アイウエ'.index):
            SCRAMBLED.add((y, q))
    for q, (a, b) in qspan.items():
        ed, cov = fit(user, a, b, *per_q.get(q, ['', set()]))
        if len(cov) < (b - a) * 0.85:
            # OCR が【問N】を読み落とすと、その問の字は前の問に入る→前後の問の OCR もつないで並べ直す
            near = [per_q[x] for x in (q - 1, q, q + 1) if x in per_q]
            ed2, cov2 = fit(user, a, b, ''.join(x[0] for x in near), set().union(*(x[1] for x in near)))
            if len(cov2) > len(cov):
                ed, cov = ed2, cov2
                SCRAMBLED.add((y, q))  # 前後をつないだ時は決まった型の直しだけにする
        edits += ed
        for i in cov:
            covered[i] = True
    return edits, covered


def fit(user, a, b, ocr, pages):
    """本人の問 user[a:b] と OCR の文を並べ、直しと読めた所（位置の集まり）を返す。"""
    if not ocr:
        return [], set()
    ops = align(user[a:b], ocr)
    pg = '・'.join(sorted(pages))
    # 6字以上の一致に挟まれた直しの束だけを使う（OCR の行の入れ替えで別の文が当たった所を除く）
    runs, cur = [], []
    for op in ops:
        if op[3] and op[1] - op[0] >= 6:
            runs.append((cur, op))
            cur = []
        else:
            cur.append(op)
    edits, cov, prev_long = [], set(), False
    for run, long_eq in runs:
        ulen = sum(x[1] - x[0] for x in run)
        olen = sum(len(x[2]) for x in run)
        good = prev_long and ulen <= 30 and olen <= 70
        for a1, a2, o, same in (run if good else []) + [long_eq]:
            cov.update(range(a + a1, a + a2))
            if not same:
                edits.append((a + a1, a + a2, o, pg))
        prev_long = True
    return edits, cov


# 問1つ分を並べる。両端のはみ出し（OCR が落とした頭や尻・次の問の頭）は只
ALIGNER = Align.PairwiseAligner(mode='global', match_score=2, mismatch_score=-3,
                                open_gap_score=-2, extend_gap_score=-0.2)
ALIGNER.query_end_gap_score = 0
ALIGNER.target_end_gap_score = 0
LOCAL = Align.PairwiseAligner(mode="local", match_score=2, mismatch_score=-3,  # 確かめ用は穴を高く
                              open_gap_score=-4, extend_gap_score=-1)
OCRQ = {}  # (読みのフォルダ, 年) → {問: [OCR の文, ページ]}
SCRAMBLED = set()  # 行の順が入れ替わった問 (年, 問)
# 行の順が入れ替わった問でも使ってよい直し（本人の文の元にしたサイトの決まった書き換えを戻すもの）
SAFE_DEL = {'宅地建物取引業者', '宅地建物取引業', '宅建'}
SAFE_INS = re.compile(r'\(以下この問において「[^」]+」という。\)|(第\d+条(の\d+)?)?(第\d+項)?(第\d+号)?|1日|。')


KEYSLIP = {'工': 'エ', 'ェ': 'エ', 'l': '1', 'I': '1', '|': '1', 'ィ': 'イ', 'ゥ': 'ウ', 'ァ': 'ア'}


def keyfix(k, o):
    """肢の頭の OCR の字が番号の読み違いなら、本人の番号 k に置き換える。番号が無ければ（OCR が落とした）足す。"""
    if o and KEYSLIP.get(o[0], o[0]) == k:
        return k + o[1:]
    if o and KEYSLIP.get(o[0], o[0]) not in '1234アイウエオ':
        return k + o
    return o


def moved(u, o, uq, ocrs):
    """OCR の行の順のずれで、本人の別の所にある文を足す・OCR の別の所にある文を消す直しか。"""
    if o is None or safe_fix(u, o):
        return False
    new = [o[i:i + 6] for i in range(0, len(o) - 5, 3) if o[i:i + 6] not in u]
    if len(o) - len(u) >= 6 and any(g in uq for g in new):
        return True
    return len(u) >= 4 and o == '' and any(u in x for x in ocrs)


def safe_fix(u, o):
    return (o == '' and u in SAFE_DEL) or (u == '' and o != '' and SAFE_INS.fullmatch(o) is not None)


def align(win, line):
    """win（本人）に line（OCR）を並べ、(本人の始め, 終わり, OCR の字, 同じか) の並びを返す（両端のはみ出しは除く）。"""
    al = ALIGNER.align(win, line)[0]
    ops, pt, pq = [], None, 0
    for (t0, t1), (q0, q1) in zip(*al.aligned):
        if pt is not None and (t0 > pt or q0 > pq):
            ops.append((pt, t0, line[pq:q0], False))  # 間の穴
        i = 0
        while i < t1 - t0:  # 並んだ所は1字ずつ較べ、同じ／違うの続きにまとめる
            same = win[t0 + i] == line[q0 + i]
            j = i
            while j < t1 - t0 and (win[t0 + j] == line[q0 + j]) == same:
                j += 1
            ops.append((t0 + i, t0 + j, line[q0 + i:q0 + j], same))
            i = j
        pt, pq = t1, q1
    return ops


# OCR が2回とも同じに読み違える字（本人の字を正とする）
SMALL = dict(zip('っゃゅょぁぃぅぇぉッャュョァィゥェォ', 'つやゆよあいうえおツヤユヨアイウエオ'))
CONF = {frozenset(x) for x in ['力カ', '工エ', '乂又', 'cC', 'l1', 'I1', '口ロ', '二ニ', '一ー', '夕タ', '卜ト',
                               '八ハ', '滅減', '上土', '己記', '問間', 'へヘ', 'りリ', 'ェエ', '工ェ', 'ぺペ', 'べベ']}


def ocr_slip(u, o):
    """本人 u と OCR o の違いが、OCR のよくある読み違いか。"""
    if len(u) == 1 and len(o) == 1:
        if frozenset(u + o) in CONF or SMALL.get(u) == o or SMALL.get(o) == u:
            return True
        base = lambda c: unicodedata.normalize('NFD', c)[0]
        return base(u) == base(o)  # 濁点・半濁点だけの違い
    if re.fullmatch(r'[\d,]+', u) and o == '' or 'm' in u and 'm' not in o:
        return True  # OCR は「00」「㎡」を落としたり別の字に読んだりする
    if u == '' and len(o) >= 3 and re.fullmatch(r'[ぁ-ん]+', o):
        return True  # 振り仮名（「瑕疵」の「かし」など）
    if o == '' and len(u) <= 4 and u.endswith('。'):
        return True  # 行の尻の短い字（「い。」など）を落とす
    return '開' in o and '0' in u  # 「00」を「開」と読む


def apply(user, s, e, edits):
    """user[s:e] に edits を当てた字。"""
    out, i = [], s
    for a, b, o, _ in sorted(edits):
        out.append(user[i:a])
        out.append(o)
        i = b
    out.append(user[i:e])
    return ''.join(out)


def covers(cov, s, e):
    if s == e:
        return (s == 0 or cov[s - 1]) and (s >= len(cov) or cov[s])
    return all(cov[s:e])


def main():
    src, b1, b2, out, table = sys.argv[1:6]
    rows = [json.loads(l) for l in open(src, encoding='utf-8')]
    decided, ask, stats = {}, [], {'OCRに': 0, '本人のまま': 0, '確認': 0, '読めず': 0}
    for y in sorted({r['y'] for r in rows}):
        if not glob.glob(os.path.join(b1, y, 'p*.txt')):
            continue
        qs = sorted((r for r in rows if r['y'] == y), key=lambda r: r['q'])
        spans, user, qspan = [], '', {}
        for r in qs:
            q0 = len(user)
            for name, t in segments(r):
                spans.append((r['q'], name, len(user), len(user) + len(t)))
                user += t
            qspan[r['q']] = (q0, len(user))
        e1, c1 = read_edits(b1, y, user, qspan)
        e2, c2 = read_edits(b2, y, user, qspan)
        stats['読めず'] += sum(1 for i in range(len(user)) if not c1[i] and not c2[i])
        # 重なる直しを1つの塊にする
        allx = sorted([(a, b, o, pg, 1) for a, b, o, pg in e1] + [(a, b, o, pg, 2) for a, b, o, pg in e2])
        clusters = []
        for x in allx:
            if clusters and x[0] <= clusters[-1][1]:
                clusters[-1][1] = max(clusters[-1][1], x[1])
                clusters[-1][2].append(x)
            else:
                clusters.append([x[0], x[1], [x]])
        for s, e, xs in clusters:
            u = user[s:e]
            if any(sorted(x[:2] for x in xs if x[4] == k) != sorted(set(x[:2] for x in xs if x[4] == k)) or
                   any(a[1] > b[0] for a, b in zip(sorted(x[:2] for x in xs if x[4] == k),
                                                  sorted(x[:2] for x in xs if x[4] == k)[1:]))
                   for k in (1, 2)):
                # 同じ読みの2行が本人の文の同じ所に当たった＝当て違い
                stats['確認'] += 1
                ask.append((y, '?', '?', u, '（重なり）', '（重なり）', user[max(0, s - 12):e + 12], xs[0][3]))
                continue
            r1 = apply(user, s, e, [x[:4] for x in xs if x[4] == 1]) if covers(c1, s, e) else None
            r2 = apply(user, s, e, [x[:4] for x in xs if x[4] == 2]) if covers(c2, s, e) else None
            seg = next((sp for sp in spans if sp[2] <= s < sp[3] or (s == e and sp[2] < s <= sp[3])), None)
            if seg and e > seg[3] and seg[3] - s <= 4 and u[:seg[3] - s].endswith('。') and \
                    not any(x is not None and x.startswith(u[:seg[3] - s]) for x in (r1, r2)):
                # 前の肢の尻（「い。」）を OCR が落とし、次の肢の頭と1つの塊になった→尻は本人のまま、次の肢だけ較べる
                s, u = seg[3], user[seg[3]:e]
                seg = next(sp for sp in spans if sp[2] == s)
            is_key = seg and s == seg[2] and not (seg[1] == '問い' or seg[1].startswith('文'))
            if is_key:
                # 肢の番号の所: OCR の番号の読み違い（工→エ など）は本人の番号に戻し、番号の後ろだけ較べる
                r1, r2 = (keyfix(u[0], x) if x is not None else None for x in (r1, r2))
                if r1 == '' or r2 == '':
                    stats['本人のまま'] += 1  # OCR が番号を落とした
                    continue
            # 1つの所の中に収まり、肢の番号（頭の字）は触らない
            inside = seg and e <= seg[3] and (seg[1] == '問い' or seg[1].startswith('文') or s > seg[2] or
                                              (is_key and r1 is not None and r1[:1] == u[:1]))
            one = r1 if r2 is None else r2 if r1 is None else None  # 片方だけ読めた
            slip = r1 is not None and r1 == r2 and ocr_slip(u, r1)
            if slip or (one is not None and ocr_slip(u, one)):
                stats['本人のまま'] += 1
            elif one is not None and inside and safe_fix(u, one):
                decided.setdefault((y, seg[0], seg[1]), []).append((s - seg[2], e - seg[2], one))
                stats['OCRに'] += 1  # 片方だけでも決まった型の直し
            elif seg and moved(u, r1 if r1 is not None else r2, user[slice(*qspan[seg[0]])],
                               [OCRQ.get((d, y), {}).get(seg[0], [''])[0] for d in (b1, b2)]):
                stats['本人のまま'] += 1  # 行の順のずれで、文が別の肢へ動いただけ
            elif seg and (y, seg[0]) in SCRAMBLED and not (r1 is not None and r1 == r2 and safe_fix(u, r1)):
                stats['本人のまま'] += 1  # 入れ替わったページは決まった型の直しだけ
            # 本人の字を13字以上消す・OCR の字を61字以上入れるのは、OCR の行落ちや順の入れ替えのことがあるので目で見る
            elif r1 is not None and r1 == r2 and r1 != u and inside and len(u) <= 12 and len(r1) <= 60:
                decided.setdefault((y, seg[0], seg[1]), []).append((s - seg[2], e - seg[2], r1))
                stats['OCRに'] += 1
            elif (r1 == u or r2 == u) and r1 != r2:
                stats['本人のまま'] += 1
            else:
                stats['確認'] += 1
                q, name = (seg[0], seg[1]) if seg else ('?', '?')
                ctx = user[max(0, s - 12):s] + '［' + u + '］' + user[e:e + 12]
                ask.append((y, q, name, u, r1 if r1 is not None else '（読めず）',
                            r2 if r2 is not None else '（読めず）', ctx, xs[0][3]))
    # 決まった直しを本人の文に当てる
    keymap = {}
    for r in rows:
        r = dict(r)
        segs = dict(segments(r))
        fixed = {}
        for name, t in segs.items():
            ed = sorted(decided.get((r['y'], r['q'], name), []), reverse=True)
            t0 = t
            for a, b, o in ed:
                t = t[:a] + o + t[b:]
            # 直した後の方が OCR から離れるなら、その所は直さない（2回とも同じに当て違えた時の止め）
            if ed:
                ocrs = [OCRQ.get((d, r['y']), {}).get(r['q'], [''])[0] for d in (b1, b2)]
                if any(o and (not t or LOCAL.score(t, o) < LOCAL.score(t0, o)) for o in ocrs):
                    # 決まった型の直し（略語を外す・「以下この問において」を戻す）だけは残す
                    keep = [x for x in ed if safe_fix(t0[x[0]:x[1]], x[2])]
                    t = t0
                    for a, b, o in keep:
                        t = t[:a] + o + t[b:]
                    if len(keep) < len(ed):
                        ask.append((r['y'], r['q'], name, t0[:40], '（直すと離れる）', t[:40], '', ''))
                        stats['確認'] += 1
                    stats['OCRに'] -= len(ed) - len(keep)
                    decided[r['y'], r['q'], name] = keep
            fixed[name] = t
        r['stem'] = fixed.get('問い', r['stem'])
        r['extra'] = [fixed.get('文%d' % i, t) for i, t in enumerate(r['extra'])]
        r['items'] = [[k, fixed.get(k, k + t)[len(k):]] for k, t in r['items']]
        r['choices'] = [[k, fixed.get('肢' + k, k + t)[len(k):]] for k, t in r['choices']]
        r['fixed'] = sum(len(decided.get((r['y'], r['q'], n), [])) for n in segs)
        keymap[(r['y'], r['q'])] = r
    with open(out, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(keymap[(r['y'], r['q'])], ensure_ascii=False) + '\n')
    with open(table, 'w', encoding='utf-8') as f:
        f.write('年\t問\t所\t本人\t読み1\t読み2\t前後（本人の字）\tページ\n')
        for x in ask:
            f.write('\t'.join(str(v) for v in x) + '\n')
    print(stats)


if __name__ == '__main__':
    main()
