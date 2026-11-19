// 보고서 편집기: 서버(/api/report)에서 본문 블록을 받아 고치고, 초안 자동 저장과 워드 저장을 합니다.
const $ = s => document.querySelector(s);
const kinds = { chapter: '장 제목', section: '절 제목', body: '본문', blank: '빈 줄', table: '표', figure: '그림' };
const order = Object.keys(kinds);
let blocks = [], timer = null, figures = [];

const status = (text, kind = '') => { $('#status').className = `status ${kind}`; $('#status').textContent = text; };
const fit = area => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };

function stats() {
  const chars = blocks.filter(b => !['blank', 'table', 'figure'].includes(b.kind)).reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0);
  // 11pt 한글 A4 한 쪽은 공백을 빼고 대략 1,300자로 잡았습니다(제목·여백 포함).
  // 그림은 한 장에 약 0.45쪽, 표는 제목과 한 줄마다 조금씩 더합니다.
  const extra = blocks.reduce((n, b) => n + (b.kind === 'figure' ? 0.45 : b.kind === 'table' ? 0.08 + 0.035 * (b.rows?.length ?? 1) : 0), 0);
  const pages = chars / 1300 + extra;
  const sections = blocks.filter(b => b.kind === 'section').length;
  $('#stats').innerHTML = `본문 <strong>${chars.toLocaleString()}자</strong> (공백 제외) · 약 <strong>${pages.toFixed(1)}쪽</strong> · 절 ${sections}개`
    + ` (그림 ${blocks.filter(b => b.kind === 'figure').length}개·표 ${blocks.filter(b => b.kind === 'table').length}개 포함)`
    + `<br>표지·목차 2쪽을 더하면 약 ${(pages + 2).toFixed(1)}쪽 / 15쪽${pages + 2 > 14 ? ' · <span class="warn">15쪽에 가깝습니다</span>' : ''}`;
}

function scheduleDraft() {
  stats();
  status('고치는 중…');
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try { localStorage.setItem('report-draft', JSON.stringify(blocks)); } catch {}
    const res = await fetch('/api/report/draft', { method: 'POST', body: JSON.stringify({ blocks }) });
    status(res.ok ? '초안 자동 저장됨 (워드 파일은 아직)' : '초안 저장 실패', res.ok ? '' : 'err');
  }, 1200);
}

function draw(focusIndex = null, caretEnd = false) {
  const paper = $('#paper');
  let chapter = 0;
  paper.replaceChildren(...blocks.map((block, i) => {
    const row = document.createElement('div');
    row.className = `block ${block.kind}`;
    const select = document.createElement('select');
    select.className = 'kind';
    select.title = '문단 종류';
    for (const k of order) select.append(new Option(kinds[k], k, false, k === block.kind));
    select.addEventListener('change', () => { block.kind = select.value; draw(i); scheduleDraft(); });
    const area = document.createElement('textarea');
    area.rows = 1;
    area.value = block.text;
    area.placeholder = { chapter: '장 제목', section: '예: 2-2 정류장·노선 데이터 및 GTFS 구축', body: '본문', blank: '',
      table: '표 제목 (예: 표 2-1 구간별 거리)', figure: '그림 제목 (예: 그림 2-1 무당이 노선과 정류장)' }[block.kind];
    // Shift+Enter로 넣은 줄바꿈은 워드에서도 문단 안 줄바꿈이 됩니다.
    area.addEventListener('input', () => { block.text = area.value; fit(area); scheduleDraft(); });
    area.addEventListener('keydown', event => {
      // 문단 안에서 Enter: 커서 뒤 글자를 새 본문 문단으로 나눕니다.
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        const at = area.selectionStart;
        const rest = block.text.slice(at);
        block.text = block.text.slice(0, at);
        blocks.splice(i + 1, 0, { id: null, kind: 'body', text: rest.trimStart() });
        draw(i + 1); scheduleDraft();
      }
      // 빈 문단에서 Backspace: 문단을 지우고 앞 문단 끝으로 갑니다.
      if (event.key === 'Backspace' && !block.text && blocks.length > 1 && i > 0) {
        event.preventDefault();
        blocks.splice(i, 1); draw(i - 1, true); scheduleDraft();
      }
    });
    const tools = document.createElement('div');
    tools.className = 'tools';
    const tool = (label, title, action) => { const b = document.createElement('button'); b.type = 'button';
      b.textContent = label; b.title = title; b.addEventListener('click', action); tools.append(b); };
    tool('↑', '위로', () => { if (i) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; draw(i - 1); scheduleDraft(); } });
    tool('↓', '아래로', () => { if (i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; draw(i + 1); scheduleDraft(); } });
    tool('+본문', '아래에 본문 추가', () => { blocks.splice(i + 1, 0, { id: null, kind: 'body', text: '' }); draw(i + 1); scheduleDraft(); });
    tool('+절', '아래에 절 제목 추가', () => { blocks.splice(i + 1, 0, { id: null, kind: 'section', text: '' }); draw(i + 1); scheduleDraft(); });
    tool('+장', '아래에 장 제목 추가', () => { blocks.splice(i + 1, 0, { id: null, kind: 'chapter', text: '' }); draw(i + 1); scheduleDraft(); });
    tool('삭제', '이 문단 삭제', () => { if (blocks.length > 1) { blocks.splice(i, 1); draw(Math.max(0, i - 1)); scheduleDraft(); } });
    const content = document.createElement('div');
    content.append(area);
    // 표: 한 줄이 한 행, 칸은 | 로 나눕니다. 첫 줄은 머리글입니다.
    if (block.kind === 'table') {
      const cells = document.createElement('textarea');
      cells.className = 'cells';
      cells.value = (block.rows ?? [['', '']]).map(r => r.join(' | ')).join('\n');
      cells.placeholder = '구간 | 거리(m)\n반도체대학→교육대학원 | 516';
      cells.addEventListener('input', () => { block.rows = cells.value.split('\n').map(line => line.split('|').map(c => c.trim())); fit(cells); scheduleDraft(); });
      content.append(cells);
    }
    // 그림: final_project/figures의 파일을 고르면 아래에 미리 보기가 나옵니다(제목은 그림 아래에 들어감).
    if (block.kind === 'figure') {
      const pick = document.createElement('select');
      pick.className = 'pick';
      pick.append(new Option('그림 파일 선택', ''), ...figures.map(f => new Option(f, f, false, f === block.file)));
      const img = document.createElement('img');
      img.className = 'preview';
      const show = () => { img.hidden = !block.file; if (block.file) img.src = `/api/report/figure/${encodeURIComponent(block.file)}`; };
      pick.addEventListener('change', () => { block.file = pick.value; show(); scheduleDraft(); });
      show();
      content.prepend(pick, img);
    }
    row.append(select, content, tools);
    // 장 번호는 워드의 자동 번호와 같게 화면에만 보여 줍니다.
    if (block.kind === 'chapter') {
      const num = document.createElement('span');
      num.className = 'num'; num.textContent = `${++chapter}`;
      row.append(num);
    }
    return row;
  }));
  paper.querySelectorAll('textarea').forEach(fit);
  if (focusIndex !== null) {
    const area = paper.querySelectorAll('.block')[focusIndex]?.querySelector('textarea');
    if (area) { area.focus(); const end = caretEnd ? area.value.length : 0; area.setSelectionRange(end, end); }
  }
  stats();
}

async function load(fresh = false) {
  status('불러오는 중…');
  await loadFigures();
  const res = await fetch(`/api/report${fresh ? '?fresh=1' : ''}`);
  const data = await res.json();
  if (!res.ok) { status(data.error, 'err'); return; }
  blocks = data.blocks;
  draw();
  status(data.from === 'draft' ? `초안에서 불러옴 (${new Date(data.savedAt).toLocaleString()})` : '원본 워드에서 불러옴');
}

async function save() {
  clearTimeout(timer);
  status('워드 파일 만드는 중…');
  const res = await fetch('/api/report/save', { method: 'POST', body: JSON.stringify({ blocks }) });
  const data = await res.json();
  if (res.ok) status(`저장함: final_project/최종보고서_편집본.docx (문단 ${data.paragraphs}개)`, 'ok');
  else status(data.error, 'err');
}

// 창 너비가 바뀌면 줄 수가 달라지므로 문단 높이를 다시 맞춥니다(마지막 줄이 가려지지 않게).
new ResizeObserver(() => document.querySelectorAll('#paper textarea').forEach(fit)).observe($('#paper'));
$('#save').addEventListener('click', save);
$('#pages').addEventListener('click', async () => {
  status('워드로 쪽수 세는 중… (10초쯤)');
  const res = await fetch('/api/report/pages', { method: 'POST', body: JSON.stringify({ blocks }) });
  const data = await res.json();
  if (res.ok) status(`워드 기준 ${data.pages}쪽 (표지·목차 포함) / 15쪽`, data.pages > 15 ? 'err' : 'ok');
  else status(data.error, 'err');
});
$('#reload').addEventListener('click', () => {
  if (confirm('원본 워드 파일에서 다시 읽으면 지금 초안은 사라집니다. 계속할까요?')) load(true);
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); save(); }
});
async function loadFigures() { figures = (await (await fetch('/api/report/figures')).json()).files ?? []; }
fetch('/api/report/outline').then(r => r.json()).then(d => { $('#outline').textContent = d.text ?? d.error; });
load();
