"""PDF を1ページずつ PNG にする（Windows の OCR に渡す前段）。

使い方: python render.py <PDF> <出力フォルダ>
"""
import os
import sys

import pypdfium2 as pdfium


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    pdf = pdfium.PdfDocument(src)
    for i in range(len(pdf)):
        # 2.5倍（約180dpi）。Windows の OCR は小さい字を落とすので大きめに
        img = pdf[i].render(scale=2.5).to_pil().convert('L')
        img.save(os.path.join(out, f'p{i + 1:02d}.png'))
    print(len(pdf))


if __name__ == '__main__':
    main()
