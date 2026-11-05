# -*- coding: utf-8 -*-
"""分野別ガイド（/guide/）を生成する。

問題ページ（/rXX/qN/）は個々の設問に閉じているため、サイト全体としては
「過去問を並べたもの」にしかならない。分野ごとに体系を通しで読める記事を
別に用意し、そこから各問題へ導線を張ることで、教材としての骨格を作る。

該当問題の一覧は index.html の分野ラベルから自動抽出するので、
分類を変更しても本ファイルを直す必要はない。
"""
import html
import io
import json
import os
import re

import guide_content

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = "https://sokuryo-kakomon.com"
YLABEL = {"r04": "令和4年", "r05": "令和5年", "r06": "令和6年", "r07": "令和7年"}


def read(path):
    return io.open(os.path.join(ROOT, path), encoding="utf-8").read()


def get_style(src):
    m = re.search(r"<style>(.*?)</style>", src, re.S)
    return m.group(1) if m else ""


def get_prbox(src):
    m = re.search(r'<div class="pr-box">.*?</div>\s*</div>\s*</div>', src, re.S)
    return m.group(0) if m else ""


def collect_questions(src):
    """各問題の (年度, 問番号, 分野ラベル, 設問冒頭) を集める。"""
    out = []
    for m in re.finditer(r"<div class='card' id='(r0\d)-q(\d+)'.*?(?=<div class='card' |\Z)", src, re.S):
        year, qn, body = m.group(1), int(m.group(2)), m.group(0)
        cat = re.search(r"<span class='card-cat'[^>]*>([^<]+)</span>", body)
        stmt = re.search(r"<p class='q-stmt'>(.*?)</p>", body, re.S)
        t = re.sub(r"<[^>]+>", "", stmt.group(1)) if stmt else ""
        t = html.unescape(re.sub(r"\s+", "", t))
        out.append({
            "year": year, "q": qn,
            "cat": re.sub(r"^[^\w぀-ヿ一-鿿]+", "", cat.group(1)).strip() if cat else "",
            "stmt": t,
        })
    return out


PAGE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="article">
<meta property="og:site_name" content="測量士試験 過去問解説">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6694004244397132"
     crossorigin="anonymous"></script>
<style>{style}
/* 分野別ガイド用 */
body{{padding:0}}
.gpage{{max-width:820px;margin:0 auto;padding:16px 16px 60px}}
.gtop{{background:#fff;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,.08);position:sticky;top:0;z-index:50}}
.gtop a{{color:#6c5ce7;text-decoration:none;font-weight:800;font-size:1rem}}
.crumb{{font-size:.85rem;color:#888;margin:14px 0 6px}}
.crumb a{{color:#6c5ce7;text-decoration:none}}
.gh1{{font-size:1.35rem;font-weight:900;margin:4px 0 6px;line-height:1.5}}
.gh1 .hdr-grad{{background:linear-gradient(135deg,#6c5ce7,#0984e3);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.glead{{font-size:1rem;line-height:1.9;color:#555;background:#fff;border:1px solid #eee;border-radius:12px;padding:16px 18px;margin-bottom:18px}}
.gbody{{background:#fff;border:1px solid #eee;border-radius:14px;padding:20px 24px;margin-bottom:18px}}
.gbody h2{{font-size:1.12rem;font-weight:900;color:#333;margin:26px 0 10px;padding-bottom:8px;border-bottom:2px solid #f0f0ff}}
.gbody h2:first-child{{margin-top:0}}
.gbody h3{{font-size:1.02rem;font-weight:800;color:#6c5ce7;margin:18px 0 6px}}
.gbody p{{font-size:1rem;line-height:1.95;color:#555;margin-bottom:10px}}
.gbody ul{{list-style:none;margin:0 0 12px}}
.gbody li{{font-size:1rem;line-height:1.85;color:#555;padding:7px 0 7px 22px;position:relative;border-bottom:1px solid #f5f5fa}}
.gbody li:last-child{{border-bottom:none}}
.gbody li::before{{content:'\\25b8';position:absolute;left:4px;color:#6c5ce7;font-weight:900}}
.gbody a{{color:#6c5ce7}}
.keybox{{background:#f5f4ff;border-left:4px solid #6c5ce7;border-radius:0 10px 10px 0;padding:13px 16px;margin:14px 0;font-size:.98rem;line-height:1.85;color:#444}}
.tblg{{border-collapse:collapse;width:100%;min-width:340px;font-size:.96rem;margin:10px 0}}
.tblg th{{background:#f0f0ff;color:#6c5ce7;font-weight:800;padding:8px 11px;text-align:left;border-bottom:2px solid #e0dcff;white-space:nowrap}}
.tblg td{{padding:8px 11px;border-bottom:1px solid #f0f0f5;color:#555}}
.qlist{{background:#fff;border:1px solid #eee;border-radius:14px;padding:18px 20px;margin-bottom:18px}}
.qlist h2{{font-size:1.1rem;font-weight:900;color:#333;margin-bottom:4px}}
.qlist .sub{{font-size:.9rem;color:#999;margin-bottom:12px}}
.qrow{{display:block;padding:10px 12px;border:1px solid #ececff;border-radius:10px;margin-bottom:7px;text-decoration:none;color:#444;font-size:.97rem;line-height:1.6;transition:all .15s}}
.qrow:hover{{border-color:#6c5ce7;background:#f7f5ff;box-shadow:0 2px 8px rgba(108,92,231,.15)}}
.qrow b{{color:#6c5ce7;margin-right:8px;white-space:nowrap}}
.gnav{{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}}
.gnav a{{padding:9px 14px;background:#fff;border:1.5px solid #e0dcff;border-radius:20px;color:#6c5ce7;text-decoration:none;font-weight:700;font-size:.93rem}}
.gnav a:hover{{background:#f0f0ff}}
.gfoot{{text-align:center;color:#aaa;font-size:.8rem;margin-top:36px;line-height:1.9}}
.gfoot a{{color:#6c5ce7}}
@media(max-width:700px){{.gbody{{padding:16px 15px}}.gh1{{font-size:1.15rem}}}}
</style>
<script type="application/ld+json">
{jsonld}
</script>
</head>
<body>
<div class="gtop"><a href="/">← 測量士 過去問解説トップ</a></div>
<div class="gpage">
  <nav class="crumb"><a href="/">トップ</a> ／ <a href="/guide/">分野別ガイド</a>{crumb3}</nav>
  <h1 class="gh1"><span class="hdr-grad">{h1}</span></h1>
  <div class="glead">{lead}</div>
  {body}
  {qlist}
  <nav class="gnav">{navlinks}</nav>
  {prbox}
  <div class="gfoot">測量士試験 過去問解説（無料）／ 本ページは独学者向けの解説です<br>出典：国土地理院「測量士・測量士補試験の試験問題及び解答例」を加工して掲載（政府標準利用規約準拠）<br><a href="/privacy/">プライバシーポリシー</a> ／ <a href="/about/">運営者情報・お問い合わせ</a></div>
</div>
</body>
</html>
"""


def jsonld_crumb(url, name):
    items = [
        {"@type": "ListItem", "position": 1, "name": "トップ", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "分野別ガイド", "item": SITE + "/guide/"},
    ]
    if name:
        items.append({"@type": "ListItem", "position": 3, "name": name, "item": url})
    return json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList",
                       "itemListElement": items}, ensure_ascii=False, indent=2)


def build():
    src = read("index.html")
    style, prbox = get_style(src), get_prbox(src)
    qs = collect_questions(src)
    guides = guide_content.GUIDES
    made = []

    navall = "".join('<a href="/guide/%s/">%s</a>' % (g["slug"], g["short"]) for g in guides)

    for g in guides:
        mine = [q for q in qs if q["cat"] == g["cat"]]
        mine.sort(key=lambda q: (q["year"], q["q"]), reverse=True)
        rows = "".join(
            '<a class="qrow" href="/%s/q%d/"><b>%s 第%d問</b>%s…</a>'
            % (q["year"], q["q"], YLABEL[q["year"]], q["q"], html.escape(q["stmt"][:46]))
            for q in mine)
        qlist = ('<div class="qlist"><h2>この分野の過去問（%d問）</h2>'
                 '<div class="sub">令和7年度から順に並べています。設問をクリックすると解説ページが開きます。</div>%s</div>'
                 % (len(mine), rows))
        url = "%s/guide/%s/" % (SITE, g["slug"])
        page = PAGE.format(
            title=html.escape("%s｜測量士試験 午前の分野別ガイド" % g["name"], quote=True),
            desc=html.escape(g["desc"][:155], quote=True),
            url=url, style=style, jsonld=jsonld_crumb(url, g["name"]),
            crumb3=" ／ " + html.escape(g["short"]),
            h1=html.escape("%sの要点" % g["name"]),
            lead=g["lead"], body=g["body"], qlist=qlist,
            navlinks=navall, prbox=prbox)
        d = os.path.join(ROOT, "guide", g["slug"])
        os.makedirs(d, exist_ok=True)
        io.open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(page)
        made.append((url, g, len(mine)))

    cards = "".join(
        '<a class="qrow" href="/guide/%s/"><b>%s（%d問）</b>%s</a>'
        % (g["slug"], g["short"], n, html.escape(g["desc"][:64]))
        for (u, g, n) in made)
    idx_url = SITE + "/guide/"
    page = PAGE.format(
        title=html.escape("分野別ガイド｜測量士試験 午前の出題を9分野に整理", quote=True),
        desc=html.escape("測量士試験 午前（択一式）の出題を9分野に整理し、分野ごとの要点と過去問へのリンクをまとめています。令和4〜7年度の全112問に対応。", quote=True),
        url=idx_url, style=style, jsonld=jsonld_crumb(idx_url, ""),
        crumb3="", h1="分野別ガイド",
        lead=guide_content.INDEX_LEAD, body=guide_content.INDEX_BODY,
        qlist='<div class="qlist"><h2>9つの分野</h2><div class="sub">それぞれの分野で何が問われ、どこで間違えやすいのかを整理しています。</div>%s</div>' % cards,
        navlinks="", prbox=prbox)
    io.open(os.path.join(ROOT, "guide", "index.html"), "w", encoding="utf-8").write(page)

    print("分野別ガイド: %d ページ + 索引1ページ" % len(made))
    return [u for (u, g, n) in made] + [idx_url]


if __name__ == "__main__":
    build()
