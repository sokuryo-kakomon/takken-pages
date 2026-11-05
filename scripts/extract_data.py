# -*- coding: utf-8 -*-
"""旧サイト（index.html / guide_content.py / about / privacy）から構造化データを抜き出す。

出力先は src/data/。Astro 側はこの JSON だけを読む。
index.html は監査済みの「唯一の情報源」なので、ここでは内容を一切書き換えず、
構造だけを取り出す。問題文と解説は HTML のまま保持する（表・SVG・強調が多く、
テキスト化すると失われるため）。AI 連携用に平文（*Text）も並べて持たせる。
"""
import html
import io
import json
import os
import re
import sys

from bs4 import BeautifulSoup, NavigableString

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 旧ソースは legacy/ に移した後も、移す前でも動くようにする
LEGACY = os.path.join(ROOT, "legacy") if os.path.exists(os.path.join(ROOT, "legacy", "index.html")) else ROOT
OUT = os.path.join(ROOT, "src", "data")
SITE_URL = "https://sokuryo-kakomon.com"

sys.path.insert(0, LEGACY)
import guide_content  # noqa: E402

YEARS = [
    {"id": "r07", "num": 7, "label": "令和7年度", "short": "R7", "examDate": "2025年5月18日", "ad": 2025},
    {"id": "r06", "num": 6, "label": "令和6年度", "short": "R6", "examDate": "2024年5月19日", "ad": 2024},
    {"id": "r05", "num": 5, "label": "令和5年度", "short": "R5", "examDate": "2023年5月21日", "ad": 2023},
    {"id": "r04", "num": 4, "label": "令和4年度", "short": "R4", "examDate": "2022年5月22日", "ad": 2022},
]

CAT_SLUG = {g["cat"]: g["slug"] for g in guide_content.GUIDES}


def read(path):
    return io.open(path, encoding="utf-8").read()


def norm_text(el):
    """要素の平文。空白を詰め、全角記号はそのまま残す。"""
    t = el.get_text(" ", strip=True) if not isinstance(el, str) else el
    return re.sub(r"\s+", " ", t).strip()


def inner_html(el):
    return "".join(str(c) for c in el.children).strip()


def strip_label(el):
    """先頭の <b>1．</b> や <b>a．</b> を外し、(key, 残りHTML, 残りテキスト) を返す。"""
    b = el.find("b")
    key = None
    if b is not None and b is next((c for c in el.children if not (isinstance(c, NavigableString) and not c.strip())), None):
        key = re.sub(r"[．.\s]+$", "", b.get_text(strip=True))
        b.extract()
    return key, inner_html(el).strip(), norm_text(el)


def split_figure(card):
    """原典画像。details の中なら補助（折りたたみ）、直置きなら問題に必須の図。"""
    img = card.select_one("img.orig-fig")
    if img is None:
        return None
    src = img.get("src", "")
    essential = img.find_parent("details") is None
    return {"src": "/" + src.lstrip("/"), "essential": essential}


def parse_question(card, year):
    qid = card["id"]
    num = int(qid.split("-q")[1])
    answer = int(card["data-answer"])
    cat_el = card.select_one(".card-cat")
    cat_raw = cat_el.get_text(strip=True)
    m = re.match(r"^(\S+)\s+(.*)$", cat_raw)
    icon, cat = (m.group(1), m.group(2)) if m else ("", cat_raw)
    style = cat_el.get("style", "")

    figure = split_figure(card)
    mb = card.select_one(".mondai-box")

    stmt = mb.select_one("p.q-stmt")
    statement_html = inner_html(stmt)
    statement_text = norm_text(stmt)

    items, choices = [], []
    choice_style = "none"
    for el in mb.select(".q-opt, .q-sel"):
        clickable = el.has_attr("data-ans-opt")
        key, h, t = strip_label(el)
        rec = {"key": key or el.get("data-ans-opt"), "html": h, "text": t}
        if clickable:
            rec["value"] = int(el["data-ans-opt"])
            choices.append(rec)
            choice_style = "combo" if el.name == "span" else "sentence"
        else:
            items.append(rec)

    tables = [str(t) for t in mb.select(".tbl-wrap")]

    kb = card.select_one(".kaisetsu-box")
    memo = kb.select_one(".claude-memo")
    hint = re.sub(r"^💡\s*", "", norm_text(memo)) if memo else ""
    box = kb.select_one(".claude-box")
    if box:
        box.extract()
    explanation_html = inner_html(kb)
    explanation_text = norm_text(kb)

    desc = statement_text
    if len(desc) > 110:
        desc = desc[:108] + "…"

    return {
        "id": qid,
        "year": year["id"],
        "yearNum": year["num"],
        "yearLabel": year["label"],
        "num": num,
        "answer": answer,
        "category": cat,
        "categoryIcon": icon,
        "categorySlug": CAT_SLUG.get(cat, ""),
        "categoryStyle": style,
        "title": "測量士試験 %s 午前 第%d問〔%s〕" % (year["label"], num, cat),
        "description": desc,
        "statementHtml": statement_html,
        "statementText": statement_text,
        "items": items,
        "choices": choices,
        "choiceStyle": choice_style,
        "tablesHtml": tables,
        "figure": figure,
        "explanationHtml": explanation_html,
        "explanationText": explanation_text,
        "hint": hint,
        "url": "/%s/q%d/" % (year["id"], num),
    }


def extract_questions(src):
    soup = BeautifulSoup(src, "lxml")
    ymap = {y["id"]: y for y in YEARS}
    out = []
    for card in soup.select("div.card[id^=r0][data-answer]"):
        year = ymap[card["id"].split("-")[0]]
        out.append(parse_question(card, year))
    # 年度ごとに問番号順、年度は新しい順
    out.sort(key=lambda q: (-q["yearNum"], q["num"]))
    for i, q in enumerate(out):
        same = [x for x in out if x["year"] == q["year"]]
        idx = same.index(q)
        q["prev"] = same[idx - 1]["id"] if idx > 0 else None
        q["next"] = same[idx + 1]["id"] if idx < len(same) - 1 else None
    return out


def extract_pdf_links(src):
    """年度見出しにある公式PDF（問題・解答）のリンクを拾う。"""
    links = {}
    for y in YEARS:
        i = src.find('id="p-%s"' % y["id"])
        seg = src[i:i + 1500] if i >= 0 else ""
        pdfs = re.findall(r'href="(https://www\.gsi\.go\.jp/common/\d+\.pdf)"[^>]*>([^<]*)', seg)
        q = next((u for u, t in pdfs if "問題" in t), None)
        a = next((u for u, t in pdfs if "解答" in t), None)
        links[y["id"]] = {"questions": q, "answers": a}
    return links


def extract_law_refs(src):
    """条文リンク機能の辞書を JS から拾う。

    LAW   … 法令キー → 名称・URL
    SUM   … '法令キー|条番号' → 条文の要約（タップで出す説明文）
    JPAGE … 準則の条番号 → 全文PDFのページ番号（#page=N で直接飛ぶ）
    """
    i = src.find("var LAW={")
    if i < 0:
        return {"laws": [], "summaries": {}, "junsokuPages": {}}
    seg = src[i:i + 12000]
    laws = []
    for key, name, url in re.findall(r"(\w+):\{name:'([^']*)',url:'([^']*)'", seg):
        laws.append({"key": key, "name": name, "url": url})
    summaries = {}
    j = seg.find("var SUM={")
    k = seg.find("};", j)
    for key, text in re.findall(r"'([a-z]+\|[0-9-]+)':'((?:[^'\\]|\\.)*)'", seg[j:k]):
        summaries[key] = text.replace("\\'", "'")
    pages = {}
    j = seg.find("var JPAGE={")
    k = seg.find("};", j)
    for art, page in re.findall(r"'([0-9-]+)':(\d+)", seg[j:k]):
        pages[art] = int(page)
    return {"laws": laws, "summaries": summaries, "junsokuPages": pages}


def extract_category_styles(questions):
    seen = {}
    for q in questions:
        if q["category"] not in seen:
            st = dict(re.findall(r"([a-z-]+):\s*([^;]+)", q["categoryStyle"]))
            seen[q["category"]] = {
                "name": q["category"],
                "icon": q["categoryIcon"],
                "slug": q["categorySlug"],
                "bg": st.get("background", ""),
                "fg": st.get("color", ""),
            }
    order = [g["cat"] for g in guide_content.GUIDES]
    return [seen[c] for c in order if c in seen]


def extract_guides(questions):
    guides = []
    for g in guide_content.GUIDES:
        qs = [q["id"] for q in questions if q["categorySlug"] == g["slug"]]
        guides.append({
            "slug": g["slug"],
            "name": g["name"],
            "short": g["short"],
            "category": g["cat"],
            "description": g["desc"],
            "leadHtml": g["lead"],
            "bodyHtml": g["body"],
            "questionIds": qs,
            "url": "/guide/%s/" % g["slug"],
        })
    return {
        "indexLead": guide_content.INDEX_LEAD,
        "indexBodyHtml": guide_content.INDEX_BODY,
        "guides": guides,
    }


def extract_static_page(path):
    """about / privacy の本文。h1 とパンくずは新レイアウト側で付けるので外す。"""
    s = read(path)
    soup = BeautifulSoup(s, "lxml")
    wrap = soup.select_one("div.wrap")
    title = soup.select_one("h1").get_text(strip=True)
    for sel in ["nav.crumb", "h1"]:
        el = wrap.select_one(sel)
        if el:
            el.extract()
    upd = wrap.select_one(".upd")
    updated = upd.get_text(strip=True) if upd else ""
    if upd:
        upd.extract()
    return {"title": title, "html": inner_html(wrap), "updated": updated}


def main():
    src = read(os.path.join(LEGACY, "index.html"))
    questions = extract_questions(src)
    cats = extract_category_styles(questions)
    pdfs = extract_pdf_links(src)
    years = []
    for y in YEARS:
        years.append(dict(y, pdf=pdfs[y["id"]], count=sum(1 for q in questions if q["year"] == y["id"])))
    for c in cats:
        c["count"] = sum(1 for q in questions if q["category"] == c["name"])

    site = {
        "name": "測量士 過去問道場",
        "legacyName": "測量士試験 過去問解説",
        "url": SITE_URL,
        "adsenseClient": "ca-pub-6694004244397132",
        "amazonTag": "sokuryokakomo-22",
        "years": years,
        "categories": cats,
        "lawRefs": extract_law_refs(src),
        "source": {
            "name": "国土地理院「測量士・測量士補試験の試験問題及び解答例」",
            "url": "https://www.gsi.go.jp/LAW/SHIKEN/past.html",
        },
    }
    guides = extract_guides(questions)
    pages = {
        "about": extract_static_page(os.path.join(LEGACY, "about", "index.html")),
        "privacy": extract_static_page(os.path.join(LEGACY, "privacy", "index.html")),
    }

    os.makedirs(OUT, exist_ok=True)
    for name, data in [("questions", questions), ("site", site), ("guides", guides), ("pages", pages)]:
        with io.open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)

    # 検算
    print("questions:", len(questions))
    print("choices  : sentence=%d combo=%d none=%d" % (
        sum(q["choiceStyle"] == "sentence" for q in questions),
        sum(q["choiceStyle"] == "combo" for q in questions),
        sum(q["choiceStyle"] == "none" for q in questions)))
    print("figures  : essential=%d aux=%d" % (
        sum(1 for q in questions if q["figure"] and q["figure"]["essential"]),
        sum(1 for q in questions if q["figure"] and not q["figure"]["essential"])))
    print("tables   :", sum(len(q["tablesHtml"]) for q in questions))
    print("hints    :", sum(1 for q in questions if q["hint"]))
    print("no slug  :", [q["id"] for q in questions if not q["categorySlug"]])
    bad = [q["id"] for q in questions if q["choices"] and not any(c["value"] == q["answer"] for c in q["choices"])]
    print("answer not in choices:", bad)
    print("categories:", [(c["name"], c["count"]) for c in cats])
    print("years:", [(y["id"], y["count"], bool(y["pdf"]["questions"]), bool(y["pdf"]["answers"])) for y in years])
    print("lawRefs:", len(site["lawRefs"]))
    print("guides:", [(g["slug"], len(g["questionIds"])) for g in guides["guides"]])
    print("pages:", {k: (v["title"], len(v["html"])) for k, v in pages.items()})


if __name__ == "__main__":
    main()
