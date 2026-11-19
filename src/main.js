import './style.css';
import stops from '../gtfs/stops.txt?raw';
import routes from '../gtfs/routes.txt?raw';
import trips from '../gtfs/trips.txt?raw';
import stop_times from '../gtfs/stop_times.txt?raw';
import calendar from '../gtfs/calendar.txt?raw';
import calendar_dates from '../gtfs/calendar_dates.txt?raw';
import serviceTable from '../data/service.csv?raw';
import demandTable from '../data/demand.csv?raw';
import sharesTable from '../data/destinations.csv?raw';
import { readFeed, csv, seconds } from './gtfs.js';
import { windowDemand, readDemandTables, timetableETA, headwayDepartures } from './models.js';
import { simulate } from './simulation.js';
import { measure, average } from './metrics.js';
import { network, stopNodes } from './network.js';
import { createRouteMap } from './map.js';
import { connectRoute } from './routing.js';
// 보고서 6-3의 민감도 분석 결과(node scripts/sensitivity.mjs)입니다.
import sensitivityTable from '../results/sensitivity.csv?raw';

const route = readFeed({ stops, routes, trips, stop_times, calendar, calendar_dates });
const paths = connectRoute(route, network, stopNodes);
// 기본값과 분석 시간대는 data/service.csv를 따릅니다.
const service = Object.fromEntries(csv(serviceTable).map(r => [r.key, r.value]));
const duration = seconds(`${service.last_departure}:00`) - seconds(`${service.first_departure}:00`) + Number(service.headway);
const { windows, shares } = readDemandTables(demandTable, sharesTable, route.start, csv);
const holdStop = route.visits.findIndex(v => v.stopId === service.hold_stop);
const ai = route.visits[holdStop].name;
const capacity = Number(service.capacity);
// 보고서와 같이 학생이 오는 시각을 무작위 값 다섯 가지로 바꿔 돌린 평균을 보여 줍니다. 지도 재생은 첫 번째 값입니다.
const seeds = [42, 7, 101, 2024, 9];
const colors = ['#c94b40', '#186a80', '#bc8728', '#75539c', '#2f7d4f', '#8a5a2b', '#555', '#a03c78'];
const defaults = { fleet: Number(service.fleet), headway: Number(service.headway) / 60, scale: 100,
  minRest: Number(service.min_rest) / 60, extra: Number(service.extra_drivers) };
const proposals = {
  1: { title: '제안 1 · 만차 + 최소 휴식', note: `${ai}에서 만차이고 도착 후 최소 휴식을 마친 무당이는 시간표(앞차 출발 뒤 배차간격)를 기다리지 않고 바로 출발합니다. 출발 규칙만 바꾸므로 추가 비용이 없습니다.` },
  2: { title: '제안 2 · 기사 교대', note: `제안 1에 더해 ${ai}에 기사 휴게 공간을 만들고 기사를 늘립니다. 차가 도착하면 기사는 내려서 쉬고, 가장 오래 쉰 기사가 차를 몰고 나갑니다. 만차로 일찍 떠날 때도 최소 휴식을 마친 기사가 탑니다.` },
};
const metrics = [
  ['학생', '평균 대기시간', 'meanWait', '분', 'low'],
  ['학생', '90분위 대기시간', 'p90Wait', '분', 'low'],
  ['학생', `${route.visits[0].name} 평균 대기`, 'semiWait', '분', 'low'],
  ['학생', `${ai} 도착부터 출발까지`, 'aiDepart', '분', 'low'],
  ['학생', '평균 통행시간 (대기 포함)', 'meanTravel', '분', 'low'],
  ['기사', '1명당 시간당 휴식', 'restPerHour', '분', 'high'],
  ['기사', '5분 이상 쉰 비율', 'restOver5', '%', 'high'],
  ['기사', '5분 이상 못 쉬고 계속 운행한 최장 시간', 'longestDrive', '분', 'low'],
];
const $ = selector => document.querySelector(selector);
const clock = t => { const s = route.start + t;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
let tab = 1, view = 'plan', replay = {}, result, timer, frame = 0, settings;

$('#app').innerHTML = `
<header class="topbar"><div class="brand"><span class="bug" aria-hidden="true">●</span> 무당이 시뮬레이션 <span class="badge">기말 프로젝트</span></div><span class="top-note">무당이 순환 노선 · 수요는 체감 값${import.meta.env.DEV ? ' · <a href="/stop-editor.html">정류장 편집</a> · <a href="/input-editor.html">입력값 편집</a>' : ''}</span></header>
<main>
  <section class="intro"><div><p class="eyebrow">GACHON · SHUTTLE SIMULATION</p><h1>${ai} 출발 규칙 개선 시뮬레이션</h1><p>제안을 고르고 운행 설정을 바꾸면, 같은 설정의 현황과 제안을 시뮬레이션해 학생 대기시간과 기사 휴식시간을 비교합니다.</p></div><span class="period">평일 운행 (${route.visits[0].name} 기준)<br><strong>${clock(0)} — ${clock(duration)}</strong></span></section>
  <div class="tabs" role="tablist">${Object.entries(proposals).map(([k, p]) => `<button type="button" role="tab" class="tab" data-tab="${k}">${p.title}</button>`).join('')}</div>
  <div class="workspace">
    <aside class="panel controls"><p class="eyebrow">01 / 운행 설정</p><h2 id="controls-title">설정</h2>
      <form id="controls">
        <label for="fleet">차량 수 <span>대</span></label><input id="fleet" type="number" min="1" max="8" required>
        <label for="headway">${ai} 출발 간격 (시간표) <span>분</span></label><input id="headway" type="number" min="2" max="30" required>
        <label for="scale">체감 수요 배율 <span>%</span></label><input id="scale" type="number" min="0" max="300" step="10" required>
        <label for="minRest">최소 휴식 (만차로 일찍 출발할 때) <span>분</span></label><input id="minRest" type="number" min="0" max="20" required>
        <div id="extra-box"><label for="extra">추가 기사 수 (휴게 공간에서 교대) <span>명</span></label><input id="extra" type="number" min="1" max="4" required></div>
        <button class="primary" type="submit">시뮬레이션 실행 <span>→</span></button><button id="reset" type="button" class="quiet">기본값으로</button>
      </form><p id="status" role="status" class="status"></p>
      <p class="help bottom-note">정원 ${capacity}명 고정 · 기본값은 보고서와 같은 data/service.csv 값 · 결과는 학생이 오는 시각을 무작위 값 ${seeds.length}가지로 바꿔 돌린 평균</p>
    </aside>
    <div class="results">
      <section class="panel"><p class="eyebrow">02 / 현황과 비교 (같은 설정 · 무작위 값 ${seeds.length}가지 평균)</p><h2 id="compare-title">비교</h2>
        <p class="help" id="proposal-note"></p>
        <div class="proposal-grid" id="compare-body"></div>
      </section>
      <section class="panel route-panel"><div class="section-head"><div><p class="eyebrow">03 / 운행 재생</p><h2>차량 위치</h2></div><span class="live-time" id="clock">--:--</span></div>
        <div class="view-toggle" role="group" aria-label="지도에 보일 운행"><button type="button" class="view" data-view="plan" id="view-plan">제안</button><button type="button" class="view" data-view="base">현황</button></div>
        <div class="map-label"><span>실제 교내 도로 · 최단거리 경로</span><span>정류장: 대기인원 · 차량: 탑승인원</span></div>
        <div id="route-map" aria-label="교내 도로와 차량 위치 지도"></div>
        <div class="playback"><button id="play" type="button" aria-label="운행 재생">▶ 재생</button><label class="sr-only" for="timeline">운행 시각</label><input type="range" id="timeline" min="0" max="240" value="0"><span id="frame-label">0 / ${duration / 60}분</span></div>
      </section>
      <section class="metric-grid" aria-label="재생 시각의 승객 현황">
        <article><span>정류장 도착 누계</span><strong id="arrived">0명</strong></article>
        <article><span>대기 중</span><strong id="waiting">0명</strong></article>
        <article><span>탑승 중</span><strong id="onboard">0명</strong></article>
        <article><span>하차 완료</span><strong id="completed">0명</strong></article>
      </section>
      <section class="panel"><p class="eyebrow">04 / 보고서 6-3 · 조건을 바꿨을 때 (민감도 분석)</p><h2>평균 대기와 기사 휴식</h2>
        <p class="help">보고서의 기본 설정에서 값 하나씩만 바꿔 계산한 결과입니다(무작위 값 ${seeds.length}가지 평균).</p>
        <div class="table-scroll"><table class="compare"><thead><tr><th>조건</th><th>평균 대기 현황 → 제안 1 → 제안 2</th><th>기사 휴식(분/시) 현황 → 제안 1 → 제안 2</th></tr></thead>
        <tbody>${csv(sensitivityTable).map(r => { const v = Object.values(r); return `<tr><td>${v[0]}</td><td>${v[1]} → ${v[2]} → ${v[3]}분</td><td>${v[8]} → ${v[9]} → ${v[10]}</td></tr>`; }).join('')}</tbody></table></div>
      </section>
    </div>
  </div>
</main>`;

const routeMap = createRouteMap(network, paths, route.visits, stopNodes, colors);

function read() {
  return { fleet: +$('#fleet').value, headway: +$('#headway').value, scale: +$('#scale').value,
    minRest: +$('#minRest').value, extra: +$('#extra').value };
}
function fill(values) { for (const [k, v] of Object.entries(values)) $(`#${k}`).value = v; }

// kind: 'base'(현황) 또는 'plan'(선택한 제안)
function simulateOne(kind, set, seed, snapshotEvery) {
  const plan = kind === 'plan';
  const drivers = plan && tab === 2 ? set.fleet + set.extra : undefined;
  return { drivers, result: simulate({ route, duration, snapshotEvery, fleetSize: set.fleet, capacity,
    demand: windowDemand(route, windows, shares, duration, { scale: set.scale / 100, seed }),
    departures: headwayDepartures(duration, set.headway * 60).slice(0, set.fleet),
    terminal: { dwell: Number(service.terminal_dwell) },
    travelTime: (leg, time) => timetableETA(route, leg, time),
    hold: { stop: holdStop, rule: plan ? 'headwayFull' : 'headway', dwell: Number(service.dwell),
      headway: set.headway * 60, running: 1, minRest: plan ? Math.round(set.minRest * 60) : 0, drivers } }) };
}

function showCompare(base, plan, set) {
  const name = `제안 ${tab}`;
  $('#compare-title').textContent = `현황 vs ${name}`;
  $('#proposal-note').textContent = `${proposals[tab].note} 지금 설정: 차량 ${set.fleet}대, 출발 간격 ${set.headway}분, 수요 ${set.scale}%, 최소 휴식 ${set.minRest}분`
    + `${tab === 2 ? `, 기사 ${set.fleet + set.extra}명` : ''}.`;
  const group = who => metrics.filter(m => m[0] === who).map(([, label, key, unit, better]) => {
    const a = base[key], b = plan[key], max = Math.max(a, b) || 1;
    const change = a ? (b - a) / a * 100 : 0, same = Math.abs(change) < 0.5;
    const good = better === 'low' ? b < a : b > a;
    const fmt = v => unit === '%' ? `${v.toFixed(0)}%` : `${v.toFixed(1)}분`;
    return `<div class="metric-row"><div class="metric-label">${label}</div>
      <div class="bars"><div class="bar-line"><span class="bar-name">현황</span><span class="bar base" style="width:${a / max * 100}%"></span><b>${fmt(a)}</b></div>
      <div class="bar-line"><span class="bar-name">${name}</span><span class="bar plan" style="width:${b / max * 100}%"></span><b>${fmt(b)}</b></div></div>
      <div class="change ${same ? '' : good ? 'good' : 'bad'}">${same ? '같음' : `${change > 0 ? '+' : ''}${change.toFixed(0)}%`}</div></div>`;
  }).join('');
  $('#compare-body').innerHTML = `<div><h3>학생 대기시간</h3>${group('학생')}</div>
    <div><h3>기사 휴식시간 <small>(기사 현황 ${base.drivers}명 · ${name} ${plan.drivers}명)</small></h3>${group('기사')}</div>`;
}

function pause() { clearInterval(timer); timer = null; $('#play').textContent = '▶ 재생'; }
function showFrame(index) {
  frame = Math.max(0, Math.min(index, result.snapshots.length - 1));
  const snap = result.snapshots[frame];
  $('#timeline').value = frame; $('#clock').textContent = clock(snap.time);
  $('#frame-label').textContent = `${Math.floor(snap.time / 60)} / ${duration / 60}분`;
  routeMap.update(snap);
  const counts = { arrived: snap.arrived, waiting: snap.queues.reduce((a, b) => a + b, 0),
    onboard: snap.boarded - snap.completed, completed: snap.completed };
  for (const [key, value] of Object.entries(counts)) $(`#${key}`).textContent = `${value}명`;
}
function showView(next) {
  pause();
  view = next;
  // 지도 재생용 운행(첫 번째 무작위 값, 15초마다 기록)은 처음 볼 때 한 번만 계산합니다.
  replay[view] ??= simulateOne(view, settings, seeds[0], 15).result;
  result = replay[view];
  document.querySelectorAll('.view').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#timeline').max = result.snapshots.length - 1;
  showFrame(0);
}

function run() {
  pause();
  settings = read();
  replay = {};
  $('#status').textContent = `현황과 제안 ${tab}을 무작위 값 ${seeds.length}가지로 계산하는 중…`;
  // 화면에 안내가 먼저 그려지도록 다음 차례에 계산합니다.
  setTimeout(() => {
    try {
      const pick = kind => average(seeds.map(seed => {
        const { result: r, drivers } = simulateOne(kind, settings, seed, duration);
        return measure(r, { fleet: settings.fleet, drivers, duration, holdStop });
      }));
      showCompare(pick('base'), pick('plan'), settings);
      showView(view);
      $('#status').textContent = '계산을 마쳤습니다. 지도에서 재생을 누르면 차량이 움직입니다.';
    } catch (error) { $('#status').textContent = `실행 오류: ${error.message}`; }
  }, 30);
}

function selectTab(next) {
  tab = next;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === String(tab))));
  $('#controls-title').textContent = proposals[tab].title;
  $('#extra-box').hidden = tab !== 2;
  $('#view-plan').textContent = `제안 ${tab}`;
  view = 'plan';
  run();
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => selectTab(Number(t.dataset.tab))));
document.querySelectorAll('.view').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
$('#controls').addEventListener('submit', event => { event.preventDefault(); run(); });
$('#controls').addEventListener('input', () => { $('#status').textContent = '시뮬레이션 실행을 누르면 바뀐 설정으로 다시 계산합니다.'; });
$('#reset').addEventListener('click', () => { fill(defaults); run(); });
$('#play').addEventListener('click', () => {
  if (!result) return;
  if (timer) { pause(); return; }
  if (frame === result.snapshots.length - 1) showFrame(0);
  $('#play').textContent = 'Ⅱ 일시정지';
  timer = setInterval(() => { showFrame(frame + 1); if (frame === result.snapshots.length - 1) pause(); }, 50);
});
$('#timeline').addEventListener('input', event => { pause(); showFrame(+event.target.value); });
fill(defaults);
selectTab(1);
