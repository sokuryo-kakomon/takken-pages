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
    joints, prev = JOINTS.setdefault((base, y), set()), ''
    for pg in sorted(glob.glob(os.path.join(base, y, 'p*.txt'))):
        for raw in open(pg, encoding='utf-8').read().split('\n'):
            m = re.match(r'^【?[問間]?(\d+)】', norm(raw))
            if m and qn < int(m.group(1)) <= qn + 3 and int(m.group(1)) in qspan:
                qn = int(m.group(1))
            line = norm(re.sub(r'^【?[問間]?\d+】', '', norm(raw)))
            line = line.replace('この間において', 'この問において').replace('似下この', '(以下この')  # よくある読み違い
            for x, z in OCR_FIX.items():
                line = line.replace(x, z)
            if len(line) < 3 or re.fullmatch(r'[-‐ー一\d]+', line):
                continue  # ページ番号など
            k = re.match(r'^([1-4]|[アイウエ])(?=\D)', line)
            if k:
                keys.setdefault(qn, []).append(k.group(1))
            if prev:
                joints.add((prev[-4:], line[:4]))
            prev = line
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
JOINTS = {}  # (読みのフォルダ, 年) → 隣り合う行の継ぎ目 {(前の行の尻4字, 次の行の頭4字)}
# 行の順が入れ替わった問でも使ってよい直し（本人の文の元にしたサイトの決まった書き換えを戻すもの）
SAFE_DEL = {'宅地建物取引業者', '宅地建物取引業', '宅建'}
KAITEI = {('拘禁', '懲役'), ('工事', '造成')}  # サイトが今の法律に合わせた語→原文の語（odd で止めない）
SAFE_INS = re.compile(r'\(以下この問において「[^」]+」という。\)|\((令和|平成)[^()]{1,20}公表\)|(第\d+条(の\d+)?)?(第\d+項)?(第\d+号)?|1日|。')


# OCR が2回とも同じに読む異体字・読み違い（原文に出てこない字）
OCR_FIX = {'竸': '競', '暸': '瞭', 'カ晩許': 'が免許', 'カ坏': 'が不', '取引十': '取引士', '以下一問': '以下この問', '月1白': '月1日'}
# 本人の文に無いが、原文では正しい字（サイトの書き換え「拘禁」「建蔽」を「懲役」「建ぺい」「禁錮」に戻す・「タワー」）
ORIGINAL_ONLY = set('懲錮ぺワ')

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
    # 動いただけなら、その文は本人と OCR で同じ回数ある（h30 問19 は問いの頭の「建築基準法」があり、肢3の「建築基準」の書き足しを動いたと見ていた）
    # 足す文も、切れ端の半分以上が本人の別の所にある時だけ（r06 問46 は「エネルギー消費性能の」の1切れだけで、括弧書きの定義を落としていた）
    new = [o[i:i + 6] for i in range(0, len(o) - 5, 3) if o[i:i + 6] not in u]
    if len(o) - len(u) >= 6 and new and \
            sum(g in uq and uq.count(g) >= max(x.count(g) for x in ocrs) for g in new) * 2 >= len(new):
        return True
    return len(u) >= 4 and o == '' and any(u in x and x.count(u) >= uq.count(u) for x in ocrs)


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
                               '八ハ', '滅減', '上土', '己記', '問間', 'へヘ', 'りリ', 'ェエ', '工ェ', 'ぺペ', 'べベ',
                               '還遍', '遺遣', '圏圈']}


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
    if u == '' and o == '・':
        return True  # 紙のごみの点を中黒に読む（h29 問13「会議の・目的」）
    if o == '' and len(u) <= 4 and u.endswith('。'):
        return True  # 行の尻の短い字（「い。」など）を落とす
    return '開' in o and '0' in u  # 「00」を「開」と読む


def kaidai(r, ocrs):
    """改題の問（元にしたサイトが今の法律に合わせて書き換えた問）は本人の文を捨て、OCR 2回が同じならその文にする。
    目で PDF と見較べるまで未確認（tools/mokushi_ok.tsv に載せたら apply_hand.py が確認済みにする）。"""
    if not ocrs[0] or ocrs[0] != ocrs[1]:
        return
    o = re.sub(r'(?<![A-Za-z])([a-ln-z])(?![A-Za-z])', lambda m: m.group(1).upper(), ocrs[0])  # 「買主c」
    parts = re.split(r'(?<=。)([1-4])(?=\D)', o)
    keys = parts[1::2]
    if keys != ['1', '2', '3', '4']:
        return
    r['stem'], r['extra'], r['items'] = parts[0], [], []
    r['choices'] = [[k, t] for k, t in zip(keys, parts[2::2])]
    r['needs'] = [n for n in r['needs'] if not n.startswith('改題')]
    r['kaidai_ocr'] = True
    r['verified'] = False


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
    cover = {}  # (年, 問) → OCR のどちらかと並べられた字の割合
    gaps = {}  # (年, 問) → OCR のどちらとも並ばなかった本人の字の続き
    # 本人の文のどこにも無い字（OCR が2回とも同じに読み違えた「返遍」「遣産」「首都圈」など）を入れる直しは目で見る
    usertext = '|'.join(t for r in rows for _, t in segments(r))
    userchars = set(usertext)
    foreign = lambda o: any(ch not in userchars and ch not in ORIGINAL_ONLY for ch in o)  # noqa: E731

    def odd(user, s, e, o):
        """1字の置き換えで、前か後ろの隣との2字が、本人の字ならほかの所にも有り、OCR の字なら本人の文のどこにも無い
        （OCR が2回とも同じに読み違えた「返遠」「申人れ」「花高岩」「火山館」「及ばす」など）。数字は除く。
        本人の打ち間違い（「考盧」「理曲」）は本人の2字がほかに無いので OCR に直る。"""
        u = user[s:e]
        if not 1 <= len(u) == len(o) <= 3 or (u + o).isdigit():
            return False  # 同じ字数の置き換えだけ（「力上→カヒ」の2字も）
        if (u, o) in KAITEI:
            return False
        a, z = user[s - 1:s], user[e:e + 1]
        if not (a and z):
            return False
        x, w = a + u + z, a + o + z
        return any(usertext.count(x[i:i + 2]) >= 2 and usertext.count(w[i:i + 2]) == 0 for i in range(len(x) - 1))

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
        for q, (a, b) in qspan.items():
            cover[y, q] = sum(1 for i in range(a, b) if c1[i] or c2[i]) / max(1, b - a)
            # OCR のどちらとも並ばなかった本人の字の続き（原文に無い字＝元にしたサイトの書き足しのことがある）
            gaps[y, q] = [user[a + m.start():a + m.end()] for m in re.finditer(
                r'x+', ''.join('o' if c1[i] or c2[i] else 'x' for i in range(a, b)))]
            if os.environ.get('DEBUG_Q') == f'{y}:{q}':
                print('読めず', gaps[y, q])
                for x in sorted(e1 + e2):
                    if a <= x[0] < b:
                        print(' 直し', x[0] - a, repr(user[x[0]:x[1]]), '→', repr(x[2]))
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
                # 番号ごと落ちても、番号の後ろが決まった型の書き換え（宅地建物取引業者 など）だけなら番号は残して外す
                r1, r2 = (u[0] if x == '' and u[1:] in SAFE_DEL else x for x in (r1, r2))
                if r1 == '' or r2 == '':
                    stats['本人のまま'] += 1  # OCR が番号を落とした
                    continue
            # 1つの所の中に収まり、肢の番号（頭の字）は触らない
            inside = seg and e <= seg[3] and (seg[1] == '問い' or seg[1].startswith('文') or s > seg[2] or
                                              (is_key and r1 is not None and r1[:1] == u[:1]))
            # 行の尻・頭の字を OCR が落とした（継ぎ目の前後が本人の文と同じ）→消さない（r05 問19「なお、こ／の問」）
            # 1字は落ちたと見て本人のまま。2字は「Aの」が落ちた（h27 問11）のか「農地法→法」の書き換えを消すのか決まらない→目で見る
            joint = (user[max(0, s - 4):s], user[e:e + 4])
            at = [x == '' and joint in JOINTS.get((b, y), ()) for x, b in ((r1, b1), (r2, b2))]
            if any(at) and len(u) == 2 and u not in SAFE_DEL and not ocr_slip(u, '') and not (u == '農地' and user[e:e + 1] == '法'):
                stats['確認'] += 1
                q, name = (seg[0], seg[1]) if seg else ('?', '?')
                ask.append((y, q, name, u, '（行の尻で落ちたか）', '', user[max(0, s - 12):s] + '［' + u + '］' + user[e:e + 12], xs[0][3]))
                continue
            # 2回とも同じ1字を落とした継ぎ目は、落ちたのかサイトの書き足しか決まらない→目で見る（h30 問20「宅地造成［等］に伴う」が書き足しだった）
            if all(at) and len(u) == 1 and u not in '。':
                stats['確認'] += 1
                q, name = (seg[0], seg[1]) if seg else ('?', '?')
                ask.append((y, q, name, u, '（行の尻で2回とも落ちた）', '', user[max(0, s - 12):s] + '［' + u + '］' + user[e:e + 12], xs[0][3]))
                continue
            r1, r2 = (u if a and len(u) == 1 else x for x, a in zip((r1, r2), at))
            # 読みの中のごみの点は先に除く（h28 問43 は「宅地建物取引業者Ａ」が2回とも「.A」と読まれ、「.」に置き換わっていた）
            # 数字の隣は除かない（「3,000」が「3.000」と読まれた所）
            if '.' not in u and not re.search(r'\d', user[s - 1:s] + u + user[e:e + 1]):
                r1, r2 = (x.replace('.', '') if x and not re.search(r'\d', x) else x for x in (r1, r2))
            # 紙のごみの点を「.」に読む（h27 問2「Dに」→「D.に」）。数字の間（7.5%）は読みのとおり
            if u == '' and '.' in (r1, r2) and not (user[s - 1:s].isdigit() and user[e:e + 1].isdigit()):
                stats['本人のまま'] += 1
                continue
            if r1 in (u, None) and r2 in (u, None) and u in (r1, r2):  # 点を除くと本人と同じになった所（u が空）も
                stats['本人のまま'] += 1
                continue
            # 数字の隣に数字を足す直しは、OCR の「800→8開」の片割れ（r03-10 問16 が 8800 に）か本当の違いか決まらない→目で見る
            if u == '' and any(x and re.fullmatch(r'[\d,]+', x) for x in (r1, r2)) and (
                    user[s - 1:s].isdigit() or user[e:e + 1].isdigit()):
                stats['確認'] += 1
                q, name = (seg[0], seg[1]) if seg else ('?', '?')
                ask.append((y, q, name, u, r1 if r1 is not None else '（読めず）', r2 if r2 is not None else '（読めず）',
                            user[max(0, s - 12):s] + '［］' + user[e:e + 12], xs[0][3]))
                continue
            one = r1 if r2 is None else r2 if r1 is None else None  # 片方だけ読めた
            slip = r1 is not None and r1 == r2 and ocr_slip(u, r1)
            if slip or (one is not None and ocr_slip(u, one)) or \
                    (r1 is not None and r2 is not None and ocr_slip(u, r1) and ocr_slip(u, r2)):
                stats['本人のまま'] += 1
            elif one is not None and inside and safe_fix(u, one):
                decided.setdefault((y, seg[0], seg[1]), []).append((s - seg[2], e - seg[2], one))
                stats['OCRに'] += 1  # 片方だけでも決まった型の直し
            elif seg and moved(u, r1 if r1 is not None else r2, user[slice(*qspan[seg[0]])],
                               [OCRQ.get((d, y), {}).get(seg[0], [''])[0] for d in (b1, b2)]):
                stats['本人のまま'] += 1  # 行の順のずれで、文が別の肢へ動いただけ
            elif seg and (y, seg[0]) in SCRAMBLED and not (r1 is not None and r1 == r2):
                # 入れ替わったページで2回の読みが食い違う所は当て違いのことが多い→本人のまま
                # （2回が同じ読みの所は下のふつうの道へ。前は決まった型だけ通し、他は黙って本人のままにしていた＝r02-12 問19 の「等」が残った）
                stats['本人のまま'] += 1
            # 本人の字を13字以上消す・OCR の字を61字以上入れるのは、OCR の行落ちや順の入れ替えのことがあるので目で見る
            elif r1 is not None and r1 == r2 and r1 != u and inside and len(u) <= 12 and len(r1) <= 60 \
                    and not foreign(r1) and not odd(user, s, e, r1):
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
        if (r['y'], r['q']) in cover:
            r['ocr_cover'] = round(cover[r['y'], r['q']], 3)
        # 公開してよいのは、本人の字が全部 OCR と並び、確認表に残りが無い問だけ（直るまで「未確認」）
        # 並ばなかった字には、元にしたサイトの書き足し（「令和2年の法改正により…」など）が残っていることがある
        r['yomezu'] = [g for g in gaps.get((r['y'], r['q']), []) if not ocr_slip(g, '')]  # 行の尻の「い。」などは除く
        # 並ばなかった6字以上の続きが2回の読みのその問の文にそのまま有る＝行の順が崩れて並ばなかっただけ（r03-12 問49）
        ocrq = [OCRQ.get((d, r['y']), {}).get(r['q'], [''])[0] for d in (b1, b2)]
        def found(g):  # 肢の番号の所で切り、12字以上の切れは2回とも有り（短い切れは「宅地建物取引業者」などどこにでも有る）、他は「る。」だけ
            parts = [x for x in re.split(r'(?<=。)[1-4アイウエ]', g) if x]
            return len(g) >= 6 and all(all(x in o for o in ocrq) if len(x) >= 12 else len(x) <= 3 and x.endswith('。')
                                       for x in parts)
        same = [g for g in r['yomezu'] if found(g)]
        r['yomezu'] = [g for g in r['yomezu'] if g not in same]
        if same and 'ocr_cover' in r:
            r['ocr_cover'] = round(r['ocr_cover'] + sum(map(len, same)) / max(1, len(''.join(t for _, t in segments(r)))), 3)
        # 金額・面積の数字は、2回の読みのどちらかにそのまま有る物だけ（サイトが消費税10%に合わせて金額を書き換えている）
        body = '|'.join(norm(t) for t in [r['stem']] + r['extra'] + [t for _, t in r['items'] + r['choices']])  # 肢の番号は除く
        r['kazu'] = [x for x in re.findall(r'\d[\d,]*', body)
                     if len(x.replace(',', '')) >= 3 and not any(x in o.replace('開', '00').replace('.', ',') for o in ocrq)]
        r['verified'] = r.get('ocr_cover', 0) >= 0.85 and not r['yomezu'] and not r['kazu'] and not any(
            a[0] == r['y'] and str(a[1]) == str(r['q']) for a in ask)
        if any(n.startswith('改題') for n in r['needs']):
            kaidai(r, [OCRQ.get((d, r['y']), {}).get(r['q'], [''])[0] for d in (b1, b2)])
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
