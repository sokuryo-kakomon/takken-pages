# -*- coding: utf-8 -*-
"""
index.html から各問題カードを抽出し、問題ごとの個別URLページを生成する。
出力: /r07/q1/index.html ... （SEO用の静的ページ）
さらに sitemap.xml を全URLで再生成し、index.html の各カードに専用ページへのリンクを注入する。

使い方:  python build_pages.py
"""
import re, os, html

import guide_content

GUIDE_BY_CAT = {g["cat"]: g for g in guide_content.GUIDES}


def guide_link(cat):
    """その問題の分野ガイドへの導線。分野が未登録なら索引へ送る。"""
    g = GUIDE_BY_CAT.get(cat)
    if not g:
        return '<a class="golink" href="/guide/">📘 分野別ガイドで体系から学ぶ</a>'
    return ('<a class="golink" href="/guide/%s/">📘 「%s」の要点を分野別ガイドで読む</a>'
            % (g["slug"], g["name"]))


ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = "https://sokuryo-kakomon.com"

YEARS = {
    "r07": {"label": "令和7年", "seimei": "令和7年度（R7・2025年）", "date": "2025年5月18日",
            "q": "https://www.gsi.go.jp/common/000270172.pdf", "a": "https://www.gsi.go.jp/common/000270179.pdf"},
    "r06": {"label": "令和6年", "seimei": "令和6年度（R6・2024年）", "date": "2024年5月19日",
            "q": "https://www.gsi.go.jp/common/000257603.pdf", "a": "https://www.gsi.go.jp/common/000259611.pdf"},
    "r05": {"label": "令和5年", "seimei": "令和5年度（R5・2023年）", "date": "2023年5月21日",
            "q": "https://www.gsi.go.jp/common/000245774.pdf", "a": "https://www.gsi.go.jp/common/000246793.pdf"},
    "r04": {"label": "令和4年", "seimei": "令和4年度（R4・2022年）", "date": "2022年5月22日",
            "q": "https://www.gsi.go.jp/common/000235078.pdf", "a": "https://www.gsi.go.jp/common/000236078.pdf"},
}

def read_index():
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        return f.read()

def get_style(src):
    m = re.search(r"<style>(.*?)</style>", src, re.S)
    return m.group(1)

def get_prbox(src):
    m = re.search(r'(<div class="pr-box">.*?</div>\s*</div>)', src, re.S)
    return m.group(1) if m else ""

def find_cards(src):
    """カード単位で (year, qnum, answer, html) を返す。divの深さを数えて末尾を特定。"""
    cards = []
    for m in re.finditer(r"<div class='card' id='(r0\d)-q(\d+)' data-answer='([^']*)'>", src):
        year, qnum, ans = m.group(1), int(m.group(2)), m.group(3)
        start = m.start()
        i = m.end()
        depth = 1
        tag = re.compile(r"</?div\b")
        while depth > 0:
            t = tag.search(src, i)
            if not t:
                break
            if t.group().startswith("</"):
                depth -= 1
            else:
                depth += 1
            i = t.end()
        end = i  # 直近の </div> の直後（>まで）
        end = src.index(">", end - 1) + 1
        cards.append({"year": year, "q": qnum, "ans": ans, "html": src[start:end]})
    return cards

def category_of(card_html):
    m = re.search(r"card-cat[^>]*>([^<]*)<", card_html)
    if not m:
        return ""
    return re.sub(r"^[^\w぀-ヿ一-鿿]+", "", m.group(1)).strip()

def stmt_text(card_html):
    m = re.search(r"q-stmt'>(.*?)</p>", card_html, re.S)
    if not m:
        return ""
    t = re.sub(r"<[^>]+>", "", m.group(1))
    t = html.unescape(t)
    t = re.sub(r"\s+", "", t)  # 日本語は空白を詰める
    return t

def make_body(card_html):
    """個別ページ用にカードHTMLを調整：開いた状態・JS依存を除去・図のパスを絶対化。"""
    h = card_html
    h = h.replace("onclick='toggle(this)'", "")
    h = re.sub(r'\s*onclick="showFig\([^"]*\)"', "", h)
    h = h.replace("src='sokuryo_figures/", "src='/sokuryo_figures/")
    return h

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
/* 個別ページ用の上書き */
body{{padding:0}}
.qpage{{max-width:820px;margin:0 auto;padding:16px 16px 60px}}
.qtop{{background:#fff;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,.08);position:sticky;top:0;z-index:50}}
.qtop a{{color:#6c5ce7;text-decoration:none;font-weight:800;font-size:1rem}}
.crumb{{font-size:.85rem;color:#888;margin:14px 0 6px}}
.crumb a{{color:#6c5ce7;text-decoration:none}}
.qh1{{font-size:1.25rem;font-weight:900;margin:4px 0 12px;line-height:1.5}}
.qh1 .hdr-grad{{background:linear-gradient(135deg,#6c5ce7,#0984e3);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}}
.qpdf{{background:#f5f4ff;border:1px solid #e0dcff;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:.9rem}}
.qpdf a{{color:#6c5ce7;text-decoration:none;margin-right:14px;border-bottom:1px solid #c5b8ff}}
.card-body{{display:block!important;border-top:none}}
.card{{box-shadow:none;border:1px solid #eee}}
.card-hdr{{cursor:default}}
.card-tog{{display:none}}
.qnav{{display:flex;justify-content:space-between;gap:10px;margin-top:24px}}
.qnav a{{flex:1;padding:12px 14px;background:#fff;border:1.5px solid #e0dcff;border-radius:12px;color:#6c5ce7;text-decoration:none;font-weight:700;text-align:center;font-size:.95rem}}
.qnav a:hover{{background:#f0f0ff}}
.qnav a.disabled{{opacity:.35;pointer-events:none}}
.qall{{display:block;text-align:center;margin-top:18px}}
.qall a{{color:#6c5ce7;text-decoration:none;font-weight:800;border-bottom:1px solid #c5b8ff}}
.golink{{display:block;margin-top:18px;padding:14px 18px;background:linear-gradient(135deg,#6c5ce7,#0984e3);color:#fff;border-radius:12px;text-decoration:none;font-weight:800;font-size:1rem;text-align:center;box-shadow:0 4px 14px rgba(108,92,231,.28)}}
.golink:hover{{opacity:.9}}
.qfoot{{text-align:center;color:#aaa;font-size:.8rem;margin-top:36px;line-height:1.9}}
.qfoot a{{color:#6c5ce7;text-decoration:none}}
.orig-fig{{max-width:100%;height:auto;border-radius:8px;border:1px solid #eee}}
.orig-fig-wrap{{margin:12px 0}}
.orig-fig-label{{display:inline-block;font-size:.85rem;color:#888;margin-bottom:4px}}
</style>
<script type="application/ld+json">
{jsonld}
</script>
</head>
<body>
<div class="qtop"><a href="/">← 測量士 過去問解説トップ</a></div>
<div class="qpage">
  <nav class="crumb"><a href="/">トップ</a> ／ <a href="/#{year}">{ylabel}</a> ／ 第{qn}問</nav>
  <h1 class="qh1"><span class="hdr-grad">測量士試験 {ylabel} 午前 第{qn}問</span><br>〔{cat}〕の解説・解答</h1>
  <div class="qpdf">📅 {date}実施 ／
    <a href="{pdfq}" target="_blank" rel="noopener">📄 公式問題PDF</a>
    <a href="{pdfa}" target="_blank" rel="noopener">📋 公式解答PDF</a>
  </div>
  {body}
  {guidelink}
  {prbox}
  <nav class="qnav">
    {prev}
    {next}
  </nav>
  <div class="qall"><a href="/#{year}">▼ {ylabel}の全28問一覧へ戻る</a></div>
  <div class="qfoot">測量士試験 過去問解説（無料）／ 本ページは独学者向けの解説です<br>出典：国土地理院「測量士・測量士補試験の試験問題及び解答例」を加工して掲載（政府標準利用規約準拠）<br><a href="/privacy/">プライバシーポリシー</a> ／ <a href="/about/">運営者情報・お問い合わせ</a></div>
</div>
{quiz}
</body>
</html>
"""

# 個別ページ用の解答ボタン。トップページと同じ localStorage キー・同じ記録形式を使うので
# 進捗は両者で共有される。トップページと違い解説はロックしない（検索から来た人に
# すぐ読ませるため。qa-locked を付けると本文が display:none になり検索評価も落ちる）。
QUIZ_JS = """<script>
(function(){
  var STORE='sokuryo_q_v2';
  var card=document.querySelector('.card[data-answer]');
  if(!card||!card.id) return;
  var qid=card.id;
  var correct=parseInt(card.getAttribute('data-answer'),10);
  if(!correct) return;
  var secK=card.querySelector('.section-kaisetsu');
  if(!secK||!secK.parentNode) return;

  function ld(){try{return JSON.parse(localStorage.getItem(STORE))||{};}catch(e){return {};}}
  function sv(d){try{localStorage.setItem(STORE,JSON.stringify(d));}catch(e){}}

  // 選択肢そのものが解答肢になっている問題（data-ans-opt 付き）は選択肢を直接押させる。
  // 番号ボタンを別に並べると同じ番号が二重に出るため。1〜5の一覧がHTMLに無い
  // 組合せ問題だけ、従来どおり番号ボタンを出す。
  var opts=card.querySelectorAll('[data-ans-opt]');
  function labelOf(el){
    var b=el.querySelector('b');
    return b?b.textContent.replace(/[．.]\\s*$/,''):el.getAttribute('data-ans-opt');
  }
  function ansText(){
    for(var i=0;i<opts.length;i++){
      if(parseInt(opts[i].getAttribute('data-ans-opt'),10)===correct) return labelOf(opts[i]);
    }
    return correct;
  }

  var wrap=document.createElement('div');
  wrap.className='quiz-area';wrap.id='qa-'+qid;
  if(opts.length){
    // 案内文は解答肢のすぐ上に置く（離れていると、どれを押すのか分からなくなるため）
    var g=opts[0].parentNode;
    if(g&&(!g.previousElementSibling||g.previousElementSibling.className!=='q-ans-label')){
      var lab=document.createElement('div');
      lab.className='q-ans-label';
      lab.textContent='正解だと思う選択肢をクリックしてください';
      g.parentNode.insertBefore(lab,g);
    }
  }else{
    var prompt=document.createElement('div');
    prompt.className='quiz-prompt';
    prompt.textContent='正解番号を選んでください';
    wrap.appendChild(prompt);
  }
  var row=document.createElement('div');row.className='quiz-btns';
  if(opts.length){
    for(var i=0;i<opts.length;i++){
      (function(el){
        var num=parseInt(el.getAttribute('data-ans-opt'),10);
        el.classList.add('q-pick');
        el.setAttribute('role','button');
        el.setAttribute('tabindex','0');
        el.onclick=function(ev){ev.stopPropagation();submit(num);};
        el.onkeydown=function(ev){
          if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ev.stopPropagation();submit(num);}
        };
      })(opts[i]);
    }
  }else{
    for(var n=1;n<=5;n++){
      (function(num){
        var b=document.createElement('button');
        b.className='q-btn';b.type='button';b.textContent=num;
        b.setAttribute('aria-label','選択肢'+num+'を選ぶ');
        b.onclick=function(){submit(num);};
        row.appendChild(b);
      })(n);
    }
  }
  wrap.appendChild(row);
  var res=document.createElement('div');
  res.className='quiz-result';res.id='qr-'+qid;
  wrap.appendChild(res);
  secK.parentNode.insertBefore(wrap,secK);

  function paint(userAns){
    if(opts.length){
      for(var i=0;i<opts.length;i++){
        var el=opts[i], num=parseInt(el.getAttribute('data-ans-opt'),10);
        el.classList.remove('q-pick');
        el.removeAttribute('role');el.removeAttribute('tabindex');
        el.onclick=null;el.onkeydown=null;
        if(num===correct) el.classList.add('opt-ok');
        else if(num===userAns) el.classList.add('opt-ng');
      }
      return;
    }
    var bs=wrap.querySelectorAll('.q-btn');
    for(var i=0;i<bs.length;i++){
      bs[i].disabled=true;
      if(i+1===correct) bs[i].className='q-btn ans-ok';
      else if(i+1===userAns) bs[i].className='q-btn ans-ng';
    }
  }
  function show(isOk){
    res.className='quiz-result r-'+(isOk?'ok':'ng');
    res.textContent=isOk?'\\u2705 正解！':'\\u274c 不正解。正解は '+ansText();
  }
  function submit(userAns){
    var isOk=(userAns===correct);
    var prog=ld();var prev=prog[qid]||{};
    var ng=prev.ngCount||0, ok=prev.okStreak||0;
    if(isOk){ok+=1;}else{ng+=1;ok=0;}
    prog[qid]={answered:true,correct:isOk,userAnswer:userAns,correctAnswer:correct,
               ngCount:ng,okStreak:ok,attempts:(prev.attempts||0)+1};
    sv(prog);paint(userAns);show(isOk);
  }

  var d=ld()[qid];
  if(d&&d.answered){paint(d.userAnswer);show(d.correct);}
})();
</script>"""

def jsonld(url, year, ylabel, qn, cat):
    import json
    data = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "トップ", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": ylabel + " 測量士試験", "item": SITE + "/#" + year},
            {"@type": "ListItem", "position": 3, "name": "第%d問 %s" % (qn, cat), "item": url},
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)

def navlink(year, qn, kind):
    if qn is None:
        return '<a class="disabled">%s</a>' % ("← 前の問題" if kind == "prev" else "次の問題 →")
    label = ("← 第%d問" % qn) if kind == "prev" else ("第%d問 →" % qn)
    return '<a href="/%s/q%d/">%s</a>' % (year, qn, label)

def build():
    src = read_index()
    style = get_style(src)
    prbox = get_prbox(src)
    cards = find_cards(src)
    print("抽出カード数:", len(cards))
    urls = []
    by_year = {}
    for c in cards:
        by_year.setdefault(c["year"], set()).add(c["q"])

    for c in cards:
        year, qn = c["year"], c["q"]
        y = YEARS[year]
        url = "%s/%s/q%d/" % (SITE, year, qn)
        cat = category_of(c["html"]) or "測量"
        st = stmt_text(c["html"])
        desc = (st[:96] + "…") if len(st) > 96 else st
        desc = "測量士試験 %s 午前 第%d問〔%s〕の問題と解説・解答。%s" % (y["label"], qn, cat, desc)
        desc = html.escape(desc[:155], quote=True)
        title = "測量士試験 %s 午前 第%d問〔%s〕解説・解答｜測量士過去問" % (y["label"], qn, cat)
        title = html.escape(title, quote=True)
        prev_q = qn - 1 if (qn - 1) in by_year[year] else None
        next_q = qn + 1 if (qn + 1) in by_year[year] else None
        page = PAGE.format(
            title=title, desc=desc, url=url, style=style,
            jsonld=jsonld(url, year, y["label"], qn, cat),
            year=year, ylabel=y["label"], qn=qn, cat=html.escape(cat),
            date=y["date"], pdfq=y["q"], pdfa=y["a"],
            body=make_body(c["html"]),
            prbox=prbox,
            guidelink=guide_link(cat),
            prev=navlink(year, prev_q, "prev"),
            next=navlink(year, next_q, "next"),
            quiz=QUIZ_JS,
        )
        d = os.path.join(ROOT, year, "q%d" % qn)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        urls.append(url)

    write_sitemap(urls)
    inject_permalinks(src)
    print("生成ページ数:", len(urls))

def write_sitemap(urls):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    lines += ['  <url><loc>%s/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>' % SITE]
    for p in ("/about/", "/privacy/"):
        lines.append('  <url><loc>%s%s</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>' % (SITE, p))
    lines.append('  <url><loc>%s/guide/</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>' % SITE)
    for g in guide_content.GUIDES:
        lines.append('  <url><loc>%s/guide/%s/</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>'
                     % (SITE, g["slug"]))
    for u in urls:
        lines.append('  <url><loc>%s</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' % u)
    lines.append('</urlset>')
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("sitemap.xml 書き出し:", len(urls) + 3 + len(guide_content.GUIDES), "URL")

def inject_permalinks(src):
    """index.html の各カードの card-body 冒頭に専用ページへのリンクを注入。"""
    # 既に注入済みなら除去してから入れ直す（冪等）
    src = re.sub(r"<a class='permalink'[^>]*>.*?</a>", "", src)
    # card-body 開始直後に挿入
    pat = re.compile(r"(<div class='card' id='(r0\d)-q(\d+)' data-answer='[^']*'>.*?<div class='card-body'>)", re.S)
    def repl2(m):
        full, year, qn = m.group(1), m.group(2), m.group(3)
        link = ("<a class='permalink' href='/%s/q%s/' "
                "style='display:inline-block;margin:10px 0 2px;padding:6px 14px;"
                "background:#f0f0ff;color:#6c5ce7;border-radius:16px;font-size:.92rem;"
                "font-weight:700;text-decoration:none'>🔗 この問題だけのページを開く</a>") % (year, qn)
        return full + link
    new = pat.sub(repl2, src)
    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write(new)
    print("index.html に専用ページリンクを注入")

if __name__ == "__main__":
    build()
