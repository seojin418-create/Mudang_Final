"""최종보고서 워드 파일의 본문(목차 뒤)을 편집기용 블록으로 읽고, 편집한 블록으로 새 워드 파일을 만듭니다.

사용:
  python scripts/report_docx.py read  <원본.docx>            → 블록 JSON을 표준 출력으로
  python scripts/report_docx.py write <원본.docx> <저장.docx>  ← 블록 JSON을 표준 입력으로

표지와 목차는 그대로 두고, 본문 문단만 바꿉니다. 원래 있던 문단은 서식을 유지한 채 글자만 바꾸고,
새 문단은 같은 종류(장 제목·절 제목·본문·빈 줄)의 첫 문단 서식을 복사해 만듭니다.
"""
import copy
import json
import os
import re
import shutil
import sys
import tempfile

import docx
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

FIGURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'final_project', 'figures')

sys.stdout.reconfigure(encoding='utf-8')
sys.stdin.reconfigure(encoding='utf-8')


def load(path):
    # 워드가 파일을 열어 두어도 읽을 수 있도록 임시 사본을 엽니다.
    fd, tmp = tempfile.mkstemp(suffix='.docx')
    os.close(fd)
    shutil.copyfile(path, tmp)
    document = docx.Document(tmp)
    os.remove(tmp)
    return document


def body_start(paragraphs):
    # 목차 첫 항목(예: "서론")과 같은 글자의 두 번째 문단이 본문의 시작입니다.
    title = next(i for i, p in enumerate(paragraphs) if p.style.name == 'Title')
    first = next(p.text.strip() for p in paragraphs[title + 1:] if p.text.strip())
    hits = [i for i, p in enumerate(paragraphs) if p.text.strip() == first]
    if len(hits) < 2:
        raise SystemExit('목차 뒤 본문 시작을 찾지 못했습니다. 본문 첫 장 제목이 목차 첫 항목과 같아야 합니다.')
    return hits[1]


def kind(p):
    text = p.text.strip()
    pPr = p._p.pPr
    num = pPr.numPr if pPr is not None else None
    if num is not None and num.ilvl is not None and num.ilvl.val == 0:
        return 'chapter'
    if num is not None or re.match(r'^\d+-\d+\s', text):
        return 'section'
    if not text:
        return 'blank'
    return 'body'


def read(path):
    document = load(path)
    paragraphs = document.paragraphs
    start = body_start(paragraphs)
    blocks = [{'id': i, 'kind': kind(p), 'text': p.text} for i, p in enumerate(paragraphs) if i >= start]
    return {'source': os.path.abspath(path), 'blocks': blocks}


def set_text(p, text):
    runs = p._p.findall(qn('w:r'))
    if not runs:
        p.add_run(text)
        return
    first = runs[0]
    for r in runs[1:]:
        p._p.remove(r)
    for child in list(first):
        if child.tag != qn('w:rPr'):
            first.remove(child)
    # 문단 안 줄바꿈(Shift+Enter)은 워드의 줄바꿈(w:br)으로 넣습니다.
    for k, line in enumerate(text.split('\n')):
        if k:
            first.append(first.makeelement(qn('w:br'), {}))
        t = first.makeelement(qn('w:t'), {})
        t.text = line
        t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        first.append(t)


def fix_toc(paragraphs, start, toc):
    # 목차(본문 앞) 항목의 글자를 바꾸고, 새 항목을 넣고, 자동 번호를 뺍니다.
    if not toc:
        return
    front = paragraphs[:start]
    # toc.drop이 참이면 목차 쪽 전체("목차" 제목부터 본문 앞까지, 목차 구역 나누기 포함)를 지웁니다. 표지는 남습니다.
    if toc.get('drop'):
        title = next(i for i, p in enumerate(front) if p.style.name == 'Title')
        for p in front[title:]:
            if p._p.getparent() is not None:
                p._p.getparent().remove(p._p)
        return
    for old, new in toc.get('replace', []):
        for p in front:
            if p.text.strip() == old:
                set_text(p, new)
    for after, new in toc.get('insert_after', []):
        for p in front:
            if p.text.strip() == after and not any(q.text.strip() == new for q in front):
                element = copy.deepcopy(p._p)
                p._p.addnext(element)
                set_text(docx.text.paragraph.Paragraph(element, p._parent), new)
                break
    for name in toc.get('remove', []):
        for p in front:
            if p.text.strip() == name and p._p.getparent() is not None:
                p._p.getparent().remove(p._p)
    for name in toc.get('unnumber', []):
        for p in front:
            if p.text.strip() == name and p._p.pPr is not None and p._p.pPr.numPr is not None:
                p._p.pPr.remove(p._p.pPr.numPr)


def write(src, dst, blocks, toc=None, layout=None):
    document = load(src)
    # layout.line_spacing: 문서 기본 줄 간격(배수, 예 1.3 = 130%). 원본은 1.4입니다.
    if layout and layout.get('line_spacing'):
        spacing = document.styles.element.find(qn('w:docDefaults')).find(qn('w:pPrDefault')).find(qn('w:pPr')).find(qn('w:spacing'))
        spacing.set(qn('w:line'), str(round(240 * float(layout['line_spacing']))))
        spacing.set(qn('w:lineRule'), 'auto')
    paragraphs = document.paragraphs
    start = body_start(paragraphs)
    fix_toc(paragraphs, start, toc)
    body = document.element.body
    originals = {i: p for i, p in enumerate(paragraphs) if i >= start}
    first_body = originals[start]._p
    # 본문 사이에 표나 그림 같은 다른 요소가 있으면 지우지 않도록 멈춥니다.
    region = list(body)[list(body).index(first_body):]
    others = [e for e in region if e.tag not in (qn('w:p'), qn('w:sectPr'))]
    if others:
        raise SystemExit('본문에 표나 그림이 있어 이 편집기로 저장할 수 없습니다. 표·그림은 마지막에 워드에서 넣어 주세요.')
    templates = {}
    numbered = lambda p: p._p.pPr is not None and p._p.pPr.numPr is not None
    for i, p in originals.items():
        # 절 제목은 "2-2 …"처럼 번호를 직접 쓰므로, 자동 번호가 없는 절 제목을 본으로 씁니다.
        if kind(p) == 'section' and numbered(p):
            continue
        templates.setdefault(kind(p), p)
    for name, fallback in (('section', 'body'), ('blank', 'body'), ('chapter', 'section')):
        templates.setdefault(name, templates.get(fallback))
    built = []
    body_tpl = templates.get('body') or originals[start]

    def caption(text, keep=False):
        # 표 제목은 표 위, 그림 제목은 그림 아래에 가운데 정렬로 둡니다.
        element = copy.deepcopy(body_tpl._p)
        paragraph = docx.text.paragraph.Paragraph(element, body_tpl._parent)
        set_text(paragraph, text.strip())
        paragraph.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.first_line_indent = Cm(0)
        # 표 제목이 쪽 끝에 홀로 남지 않도록 다음 요소(표)와 같은 쪽에 둡니다.
        paragraph.paragraph_format.keep_with_next = keep
        for run in paragraph.runs:
            run.bold = True
            run.font.size = Pt(10)
        return element

    def table(rows):
        rows = [r for r in rows if any(c.strip() for c in r)]
        width = max(len(r) for r in rows)
        t = document.add_table(rows=len(rows), cols=width)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        borders = OxmlElement('w:tblBorders')
        for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
            b = OxmlElement(f'w:{side}')
            for k, v in (('val', 'single'), ('sz', '4'), ('space', '0'), ('color', '808080')):
                b.set(qn(f'w:{k}'), v)
            borders.append(b)
        t._tbl.tblPr.append(borders)
        for i, row in enumerate(rows):
            for j in range(width):
                cell = t.cell(i, j)
                cell.text = row[j].strip() if j < len(row) else ''
                for paragraph in cell.paragraphs:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    # 작은 표는 쪽을 넘어가며 나뉘지 않게 마지막 행 전까지 다음 행과 붙여 둡니다.
                    paragraph.paragraph_format.keep_with_next = i < len(rows) - 1
                    for run in paragraph.runs:
                        run.font.size = Pt(9.5)
                        run.bold = i == 0
        element = t._tbl
        element.getparent().remove(element)
        return element

    def figure(name, width=13):
        path = os.path.join(FIGURES, name)
        if not os.path.exists(path):
            raise SystemExit(f'그림 파일이 없습니다: final_project/figures/{name}')
        element = copy.deepcopy((templates.get('blank') or body_tpl)._p)
        paragraph = docx.text.paragraph.Paragraph(element, body_tpl._parent)
        for r in element.findall(qn('w:r')):
            element.remove(r)
        paragraph.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.first_line_indent = Cm(0)
        paragraph.paragraph_format.keep_with_next = True
        paragraph.add_run().add_picture(path, width=Cm(width))
        return element

    for block in blocks:
        if block['kind'] == 'table':
            built += [caption(block['text'], keep=True), table(block.get('rows') or [['']])]
            continue
        if block['kind'] == 'figure':
            built += [figure(block['file'], block.get('width', 13)), caption(block['text'])]
            continue
        source = originals.get(block.get('id')) if isinstance(block.get('id'), int) else None
        if source is not None and kind(source) == block['kind']:
            element = source._p
        else:
            element = copy.deepcopy((templates.get(block['kind']) or originals[start])._p)
        paragraph = docx.text.paragraph.Paragraph(element, originals[start]._parent)
        text = block['text']
        # 본문은 맨 앞 공백 대신 워드 들여쓰기 한 칸으로 통일합니다. 식처럼 '='가 든 한 줄은 가운데 정렬합니다.
        if block['kind'] == 'body':
            text = text.lstrip()
            if ' = ' in text and len(text) < 90:
                paragraph.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
                paragraph.paragraph_format.first_line_indent = Cm(0)
            else:
                paragraph.paragraph_format.first_line_indent = Pt(11)
        # 장·절 제목이 쪽 끝에 홀로 남지 않도록 다음 문단과 같은 쪽에 둡니다.
        if block['kind'] in ('chapter', 'section'):
            paragraph.paragraph_format.keep_with_next = True
        if paragraph.text != text:
            set_text(paragraph, text)
        built.append(element)
    sect = body.find(qn('w:sectPr'))
    for p in originals.values():
        if p._p.getparent() is body:
            body.remove(p._p)
    for element in built:
        if sect is not None:
            sect.addprevious(element)
        else:
            body.append(element)
    document.save(dst)
    return {'saved': os.path.abspath(dst), 'paragraphs': len(built)}


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'read':
        print(json.dumps(read(sys.argv[2]), ensure_ascii=False))
    elif command == 'write':
        data = json.load(sys.stdin)
        print(json.dumps(write(sys.argv[2], sys.argv[3], data['blocks'], data.get('toc'), data.get('layout')), ensure_ascii=False))
    else:
        raise SystemExit('read 또는 write를 씁니다.')
