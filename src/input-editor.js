// 입력값 편집기: data/service.csv, demand.csv, destinations.csv를 표로 고치고 저장합니다.
import { csv } from './gtfs.js';

const sources = ['관측', '체감', '가정', '결정', '과거 자료', '확인', '—'];
// service.csv 항목 이름을 한글로 보여 줍니다.
const labels = {
  first_departure: '분석 첫 출발', last_departure: '분석 마지막 출발', operating_start: '실제 운행 시작',
  operating_end: '실제 운행 종료', headway: '배차간격', fleet: '차량 대수', capacity: '정원',
  demand: '추가 무작위 수요', speed: '운행 속도', dwell: '중간 정류장 정차시간', hold_stop: '휴식 정류장',
  hold: 'AI공학관 대기(시간표)', min_rest: '최소 휴식(제안)', extra_drivers: '추가 기사 수(제안 2)', max_speed: '교내 최고 속도', terminal_dwell: '반도체대학 정차시간',
  service_start_date: '운행 기간 시작', service_end_date: '운행 기간 끝',
};
const head = {
  demand: { origin: '출발 정류장', start: '시작', end: '끝', people: '도착 인원', felt_queue: '체감 대기(명)',
    repeat: '반복', repeat_start: '반복 시작', repeat_end: '반복 끝', source: '근거', note: '설명' },
  destinations: { origin: '출발 정류장', destination: '목적지', share: '비율(%)', source: '근거', note: '설명' },
};

const load = async name => {
  const text = await (await fetch(`/data/${name}.csv?t=${Date.now()}`)).text();
  return { header: text.replace(/^﻿/, '').split(/\r?\n/)[0].split(','), rows: csv(text) };
};
const quote = v => /[",\n]/.test(v) ? `"${String(v).replaceAll('"', '""')}"` : String(v ?? '');
const el = (tag, attrs = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), attrs);
  e.append(...kids.filter(k => k != null)); return e;
};

const stops = (await load('stops')).rows;
const stopName = Object.fromEntries(stops.map(s => [s.stop_id, s.stop_name]));
const capacity = Number((await load('service')).rows.find(r => r.key === 'capacity').value);

function field(row, key, onChange) {
  let input;
  if (key === 'source') {
    input = el('select', {}, ...sources.map(s => el('option', { value: s, textContent: s })));
    if (!sources.includes(row[key])) input.append(el('option', { value: row[key], textContent: row[key] }));
  } else if (key === 'origin' || key === 'destination') {
    input = el('select', {}, ...stops.map(s => el('option', { value: s.stop_id, textContent: s.stop_name })));
  } else if (key === 'repeat') {
    input = el('select', {}, el('option', { value: '', textContent: '없음' }), el('option', { value: '매시', textContent: '매시' }));
  } else {
    input = el('input', { type: ['start', 'end', 'repeat_start', 'repeat_end'].includes(key) ? 'time' : 'text' });
  }
  input.value = row[key] ?? '';
  input.addEventListener('input', () => { row[key] = input.value; onChange(); });
  return input;
}

function table(name, data, { fixedRows = false, editableKeys, check, extraButtons }) {
  const box = document.getElementById(name);
  const original = JSON.stringify(data.rows);
  const status = el('span', { className: 'status' });
  const extra = el('div', { className: 'sums' });
  const tbody = el('tbody');
  const refresh = () => {
    status.className = 'status';
    status.textContent = JSON.stringify(data.rows) === original ? '' : '저장하지 않은 변경이 있습니다.';
    if (check) check(data.rows, extra);
  };
  const draw = () => {
    tbody.replaceChildren(...data.rows.map((row, i) => {
      const tr = el('tr');
      for (const key of data.header) {
        if (name === 'service' && key === 'key') {
          tr.append(el('td', { className: 'label' }, labels[row.key] ?? row.key, el('small', { textContent: row.key })));
        } else if (name === 'demand' && key === 'felt_queue') {
          // 체감은 무당이 몇 대 분량으로 적고, 정원을 곱해 명으로 저장합니다.
          const people = el('span', { textContent: row.felt_queue ? `${row.felt_queue}명` : '' });
          const buses = el('input', { type: 'number', step: '0.5', min: '0', value: row.felt_queue ? Number(row.felt_queue) / capacity : '' });
          buses.addEventListener('input', () => {
            row.felt_queue = buses.value === '' ? '' : String(Math.round(Number(buses.value) * capacity));
            people.textContent = row.felt_queue ? `${row.felt_queue}명` : '';
            tr.classList.add('changed'); refresh();
          });
          tr.append(el('td', { className: 'narrow' }, buses), el('td', { className: 'narrow' }, people));
        } else if (!editableKeys || editableKeys.includes(key)) {
          tr.append(el('td', { className: ['value', 'share', 'people', 'felt_queue'].includes(key) ? 'narrow'
            : ['source', 'origin', 'destination', 'start', 'end', 'repeat'].includes(key) ? 'mid' : '' },
          field(row, key, () => { tr.classList.add('changed'); refresh(); })));
        } else tr.append(el('td', { textContent: row[key] }));
      }
      if (!fixedRows) tr.append(el('td', {}, el('button', { className: 'del', textContent: '삭제', title: '이 행 삭제',
        onclick: () => { data.rows.splice(i, 1); draw(); refresh(); } })));
      return tr;
    }));
  };
  const save = async () => {
    const body = [data.header.join(','), ...data.rows.map(r => data.header.map(k => quote(r[k])).join(','))].join('\r\n') + '\r\n';
    status.className = 'status'; status.textContent = '저장 중…';
    const res = await fetch(`/api/data/${name}`, { method: 'POST', body });
    status.className = `status ${res.ok ? 'ok' : 'err'}`;
    status.textContent = (res.ok ? '저장했습니다. ' : '저장하지 못했습니다: ') + (await res.text()).trim();
    if (res.ok) setTimeout(() => location.reload(), 1200);
  };
  const cols = data.header.flatMap(k => name === 'demand' && k === 'felt_queue'
    ? [el('th', { textContent: '체감(대 분량)' }), el('th', { textContent: '체감(명)' })]
    : [el('th', { textContent: name === 'service'
      ? { key: '항목', value: '값', unit: '단위', source: '근거', note: '설명' }[k] ?? k : head[name]?.[k] ?? k })]);
  box.append(
    el('div', { className: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ...cols, fixedRows ? null : el('th'))), tbody)),
    extra,
    el('div', { className: 'bar' },
      fixedRows ? null : el('button', { textContent: '행 추가', onclick: () => {
        data.rows.push(Object.fromEntries(data.header.map(k => [k, data.rows.at(-1)?.[k] ?? '']))); draw(); refresh(); } }),
      ...(extraButtons ?? []).map(([label, make]) => el('button', { textContent: label, onclick: () => {
        data.rows.push(...make(data.header)); draw(); refresh(); } })),
      el('button', { className: 'primary', textContent: '저장', onclick: save }),
      el('button', { textContent: '되돌리기', onclick: () => location.reload() }),
      status));
  draw(); refresh();
}

const intro = (id, title, hint) => document.getElementById(id).append(el('h2', { textContent: title }), el('p', { className: 'hint', textContent: hint }));

intro('service', '운행 조건 (service.csv)', '시간은 초 단위입니다(5분 = 300). 저장하면 GTFS를 다시 만듭니다.');
table('service', await load('service'), { fixedRows: true, editableKeys: ['value', 'source', 'note'] });

intro('demand', '수요 (demand.csv)',
  '매시 반복하는 분 구간마다 한 줄입니다. 반복하지 않는 시간(9:30 전·17:30 뒤)은 아래 버튼으로 20분 줄을 만들고 반복은 "없음"으로 둡니다. 체감은 무당이 몇 대 분량으로 적으면 정원을 곱해 명으로 바꿉니다. 체감만 고치면 도착 인원은 scripts/calibrate-demand.mjs로 다시 맞춥니다. AI공학관 체감 대기는 쉬는 차에 이미 탄 학생까지 포함한 인원입니다.');
// 9:30 전·17:30 뒤처럼 매시 반복하지 않는 시간은 20분 줄을 정류장마다 만들어 채웁니다.
const blank = (header, origin, start, end) => Object.fromEntries(header.map(k => [k, { origin, start, end, source: '체감',
  note: `본인 체감: ${start}~${end} ${stopName[origin]}` }[k] ?? '']));
const slots = (from, to) => { const out = []; let [h, m] = from.split(':').map(Number);
  const pad = v => String(v).padStart(2, '0');
  while (`${pad(h)}:${pad(m)}` < to) { const a = `${pad(h)}:${pad(m)}`; m += 20; if (m >= 60) { h++; m -= 60; } out.push([a, `${pad(h)}:${pad(m)}`]); }
  return out; };
const exceptionRows = (from, to) => header => slots(from, to).flatMap(([a, b]) => ['ST01', 'ST04'].map(o => blank(header, o, a, b)));
table('demand', await load('demand'), { extraButtons: [
  ['8:30~9:30 줄 추가', exceptionRows('08:30', '09:30')],
  ['17:30~18:30 줄 추가', exceptionRows('17:30', '18:30')],
] });

intro('destinations', '목적지 비율 (destinations.csv)', '출발 정류장마다 비율의 합이 100이 되어야 합니다.');
table('destinations', await load('destinations'), {
  check(rows, box) {
    const sums = {};
    for (const r of rows) sums[r.origin] = (sums[r.origin] ?? 0) + Number(r.share || 0);
    box.replaceChildren(...Object.entries(sums).map(([o, s]) =>
      el('span', { className: `sum ${s === 100 ? 'good' : 'bad'}`, textContent: `${stopName[o] ?? o} 출발 합계 ${s}%` })));
  },
});
