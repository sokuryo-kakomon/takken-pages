"""確認済みの問題文（ocr/genbun.jsonl）と正解番号（tools/answers_src.txt）から、サイトの src/data/questions.json と site.json を作る。

使い方: python tools/site_data.py
- 載せるのは verified の問だけ（未確認は落とす）。R8 は正解の発表まで載せない（YEARS に無い年は落ちる）
- 問題文は原文のまま。画面で変えるのは HTML の側だけ（m2→m²・判決文などの extra は段落に）
- 解説はまだ無いので「準備中」と正解番号だけ。解説を書いたら tools/kaisetsu/ などから差し込む
"""
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = 'https://www.retio.or.jp/wp-content/uploads'

# 新しい順（トップの札・横のメニューの並び）
YEARS = [
    ('r07', '令和7年度', 'R7', '2025年10月19日', 2025, f'{B}/2025/12/R7_question_answer.pdf'),
    ('r06', '令和6年度', 'R6', '2024年10月20日', 2024, f'{B}/2025/03/R6_question_answer.pdf'),
    ('r05', '令和5年度', 'R5', '2023年10月15日', 2023, f'{B}/2025/03/R5_qestion_answer%E3%80%80.pdf'),
    ('r04', '令和4年度', 'R4', '2022年10月16日', 2022, f'{B}/2024/10/R4-q_a.pdf'),
    ('r03-12', '令和3年度（12月）', 'R3.12', '2021年12月19日', 2021, f'{B}/2024/12/R3-question_002.pdf'),
    ('r03-10', '令和3年度（10月）', 'R3.10', '2021年10月17日', 2021, f'{B}/2024/12/R3-question.pdf'),
    ('r02-12', '令和2年度（12月）', 'R2.12', '2020年12月27日', 2020, f'{B}/2024/10/R2-question_002.pdf'),
    ('r02-10', '令和2年度（10月）', 'R2.10', '2020年10月18日', 2020, f'{B}/2024/10/R2-question.pdf'),
    ('r01', '令和元年度', 'R1', '2019年10月20日', 2019, f'{B}/2024/10/R1-q_a.pdf'),
    ('h30', '平成30年度', 'H30', '2018年10月21日', 2018, f'{B}/2024/10/H30-q_a.pdf'),
    ('h29', '平成29年度', 'H29', '2017年10月15日', 2017, f'{B}/2024/10/H29-q_a.pdf'),
    ('h28', '平成28年度', 'H28', '2016年10月16日', 2016, f'{B}/2024/10/H28-q_a.pdf'),
    ('h27', '平成27年度', 'H27', '2015年10月18日', 2015, f'{B}/2024/10/H27-q_a.pdf'),
]

# 問番号で分ける（平成21年度から同じ並び）。46〜50 は登録講習の修了者が免除される問
CATS = [
    ('権利関係', '⚖️', 'kenri', '#E3F2FD', '#1565C0', range(1, 15)),
    ('法令上の制限', '🏗️', 'seigen', '#E8F5E9', '#2E7D32', range(15, 23)),
    ('税・価格の評定', '💴', 'zei', '#FFF8E1', '#8D6E00', range(23, 26)),
    ('宅建業法', '🏠', 'gyoho', '#FCE4EC', '#AD1457', range(26, 46)),
    ('免除科目', '📊', 'menjo', '#EDE7F6', '#4527A0', range(46, 51)),
]

# 正解が1つでない問（RETIO の正解番号表の注記）。answer は画面で「正解」と出す番号、ok は正解と扱う番号すべて
NOTES = {
    ('r04', 48): '選択肢4の統計の数値が試験後に改訂されたため、正解なし（全員正解）として取り扱われました。',
    ('r03-12', 44): '設問文アに誤植があったため、選択肢2と3のいずれも正解として取り扱われました。',
    ('r02-10', 42): '選択肢1と4のいずれも正解として取り扱われました。',
}


def answers():
    out = {}
    for line in open(os.path.join(ROOT, 'tools', 'answers_src.txt'), encoding='utf-8'):
        if not line.strip() or line.startswith('#'):
            continue
        y, *groups = line.split()
        toks = re.findall(r'\((\d+)\)|(\d)', ''.join(groups))
        assert len(toks) == 50, (y, len(toks))
        for i, (multi, one) in enumerate(toks, 1):
            out[y, i] = [int(c) for c in multi] if multi else ([1, 2, 3, 4] if one == '0' else [int(one)])
    return out


def h(s):
    """原文 → 画面の HTML。保存の文字は変えず、ここで m2 を m² に出すだけ。"""
    return re.sub(r'(?<=\d)m2(?!\d)', 'm²', html.escape(s))


def category(n):
    for name, icon, slug, bg, fg, r in CATS:
        if n in r:
            return name, icon, slug, f'background:{bg};color:{fg};border-color:{fg}'


def main():
    rows = [json.loads(l) for l in open(os.path.join(ROOT, 'ocr', 'genbun.jsonl'), encoding='utf-8')]
    ans = answers()
    ylab = {y[0]: y for y in YEARS}
    qs, dropped = [], 0
    for y, label, short, date, ad, pdf in YEARS:
        yr = sorted((r for r in rows if r['y'] == y), key=lambda r: r['q'])
        for r in yr:
            if not r['verified']:
                dropped += 1
                continue
            n = r['q']
            ok = ans[y, n]
            cname, icon, slug, style = category(n)
            short_choices = max(len(t) for _, t in r['choices']) <= 12
            stem_text = r['stem']
            extra = r['extra']
            note = NOTES.get((y, n))
            if len(ok) == 4:
                ans_html = '<p>正解は<b>なし</b>（受験者全員を正解として取り扱い）です。</p>'
            elif len(ok) > 1:
                ans_html = f'<p>正解は <b>{"又は".join(map(str, ok))}</b> です。</p>'
            else:
                ans_html = f'<p>正解は <b>{ok[0]}</b> です。</p>'
            expl = ans_html + (f'<p class="text-sm">{html.escape(note)}</p>' if note else '') + \
                '<p class="text-ink-soft">この問題の解説は準備中です。正解番号は一般財団法人 不動産適正取引推進機構の公表によります。</p>'
            yl = label.replace('年度', '年')
            qs.append({
                'id': f'{y}-q{n}', 'year': y, 'yearNum': ad, 'yearLabel': label, 'num': n,
                'answer': ok[0], 'ok': ok,
                'category': cname, 'categoryIcon': icon, 'categorySlug': slug, 'categoryStyle': style,
                'title': f'宅建 {label} 問{n}〔{cname}〕',
                'description': f'宅建試験 {yl} 問{n}（{cname}）の過去問。' + stem_text[:90] + ('…' if len(stem_text) > 90 else ''),
                'statementHtml': h(stem_text),
                'statementText': stem_text,
                'items': [{'key': k, 'html': h(t), 'text': t} for k, t in r['items']],
                'choices': [{'key': k, 'html': h(t), 'text': t, 'value': int(k)} for k, t in r['choices']],
                'choiceStyle': 'combo' if short_choices else 'sentence',
                # 判決文・ケースなど問いの後に付く文。問いの文は <p> の中なので、ここ（ブロック）に置く
                'tablesHtml': ['<div class="extra">' + ''.join(f'<p>{h(t)}</p>' for t in extra) + '</div>'] if extra else [],
                'figure': None,
                'explanationHtml': expl,
                'explanationText': re.sub(r'<[^>]+>', '', expl),
                'hint': '',
                'url': f'/{y}/q{n}/',
                'prev': None, 'next': None,
                'source': pdf,
            })
    # 前後は同じ年度の中で
    for a, b in zip(qs, qs[1:]):
        if a['year'] == b['year']:
            a['next'], b['prev'] = b['id'], a['id']
    assert all(len(q['choices']) == 4 for q in qs), [q['id'] for q in qs if len(q['choices']) != 4]

    with open(os.path.join(ROOT, 'src', 'data', 'questions.json'), 'w', encoding='utf-8') as f:
        json.dump(qs, f, ensure_ascii=False, indent=0)
    with open(os.path.join(ROOT, 'src', 'data', 'questions_hoshi.json'), 'w', encoding='utf-8') as f:
        f.write('[]\n')

    sp = os.path.join(ROOT, 'src', 'data', 'site.json')
    site = json.load(open(sp, encoding='utf-8'))
    site.update({
        'name': '宅建 過去問ドリル',
        'legacyName': '宅建 過去問ドリル',
        'url': 'https://takken-kakomon-drill.com',
        'amazonTag': '',  # 測量士のタグは使わない（宅建のアソシエイトは未登録）
        'years': [{'id': y, 'num': ad, 'label': label, 'short': short, 'examDate': date, 'ad': ad,
                   'pdf': {'questions': pdf, 'answers': pdf},
                   'count': sum(1 for q in qs if q['year'] == y)} for y, label, short, date, ad, pdf in YEARS],
        'hoshiYears': [],
        'categories': [{'name': n, 'icon': i, 'slug': s, 'bg': bg, 'fg': fg, 'count': sum(1 for q in qs if q['categorySlug'] == s)}
                       for n, i, s, bg, fg, _ in CATS],
        'lawRefs': {
            'laws': [
                {'key': 'minpo', 'name': '民法（明治29年法律第89号）', 'url': 'https://laws.e-gov.go.jp/law/129AC0000000089'},
                {'key': 'takkengyoho', 'name': '宅地建物取引業法（昭和27年法律第176号）', 'url': 'https://laws.e-gov.go.jp/law/327AC1000000176'},
            ],
            'summaries': {}, 'junsokuPages': {},
        },
        'source': {'name': '一般財団法人 不動産適正取引推進機構「宅地建物取引士資格試験 過去の試験問題及び正解番号表」',
                   'url': 'https://www.retio.or.jp/exam/past_ques_ans/other/'},
    })
    with open(sp, 'w', encoding='utf-8') as f:
        json.dump(site, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(qs)} 問（未確認で落とした {dropped}）', {c['name']: c['count'] for c in site['categories']})


if __name__ == '__main__':
    main()
