"""Windows の OCR が行を下から上などの崩れた順で返したページを、紙の上の位置（上から下・同じ高さは左から右）に並べ直す。

使い方: python tools/ocr/narabe.py <ocr か ocr2>
- 位置は <ocr か ocr2>/lines/<年>.tsv（tools/ocr/ocr_lines.ps1 で同じ画像から取ったもの）
- 並べ直すのは、隣の行で上へ戻る所が2割を超えるページだけ（ふつうのページは触らない）
- 直す前の txt は <ocr か ocr2>/_narabe_mae/<年>/ に残す
"""
import glob
import os
import shutil
import sys


def rows_in_order(rows):
    """(x0, y0, x1, y1, 字) を、縦に重なる行どうしを1段にまとめて上から、段の中は左から並べる。"""
    rows = sorted(rows, key=lambda r: (r[1] + r[3]) / 2)
    bands = []
    for r in rows:
        mid = (r[1] + r[3]) / 2
        if bands and abs(mid - bands[-1][0]) < (r[3] - r[1]) * 0.5:
            bands[-1][1].append(r)
        else:
            bands.append([mid, [r]])
    return [r for _, b in bands for r in sorted(b, key=lambda r: r[0])]


def main():
    base = sys.argv[1]
    n_pages = n_fixed = 0
    for tsv in sorted(glob.glob(os.path.join(base, 'lines', '*.tsv'))):
        y = os.path.basename(tsv)[:-4]
        pages = {}
        for l in open(tsv, encoding='utf-8').read().split('\n'):
            if l:
                p, a, b, c, d, t = l.split('\t')
                pages.setdefault(p, []).append((int(a), int(b), int(c), int(d), t))
        for p, rows in pages.items():
            f = os.path.join(base, y, f'{p}.txt')
            if not os.path.exists(f):
                continue
            n_pages += 1
            now = open(f, encoding='utf-8').read().split('\n')
            if [r[4] for r in rows] != now:
                print('字が合わない（触らない）', y, p)
                continue
            back = sum(1 for i in range(len(rows) - 1) if rows[i + 1][1] < rows[i][1] - 30)
            if back <= len(rows) * 0.2:
                continue
            keep = os.path.join(base, '_narabe_mae', y)
            os.makedirs(keep, exist_ok=True)
            if not os.path.exists(os.path.join(keep, f'{p}.txt')):
                shutil.copy2(f, keep)
            with open(f, 'w', encoding='utf-8', newline='') as w:
                w.write('\n'.join(r[4] for r in rows_in_order(rows)))
            n_fixed += 1
            print('並べ直した', y, p, f'上へ戻る {back}/{len(rows)}')
    print(f'{base}: {n_fixed} / {n_pages} ページ')


if __name__ == '__main__':
    main()
