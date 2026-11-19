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
// 보고서 6장의 표는 results/summary.json(node scripts/summary.mjs), 6-3은 results/sensitivity.csv에서 옮겨 적었습니다.
import summary from '../results/summary.json';
import sensitivityTable from '../results/sensitivity.csv?raw';

const route = readFeed({ stops, routes, trips, stop_times, calendar, calendar_dates });
const paths = connectRoute(route, network, stopNodes);
// 설정은 모두 data/service.csv 값으로 고정합니다. 보고서와 같은 조건입니다.
const service = Object.fromEntries(csv(serviceTable).map(r => [r.key, r.value]));
const duration = seconds(`${service.last_departure}:00`) - seconds(`${service.first_departure}:00`) + Number(service.headway);
const { windows, shares } = readDemandTables(demandTable, sharesTable, route.start, csv);
const holdStop = route.visits.findIndex(v => v.stopId === service.hold_stop);
const fleet = Number(service.fleet), headway = Number(service.headway), capacity = Number(service.capacity);
const minRest = Number(service.min_rest), drivers2 = fleet + Number(service.extra_drivers);
const seeds = summary.seeds;
const colors = ['#e0735f', '#4fa3c7', '#d9a441', '#9b82c9', '#5fb37f', '#c98a5a', '#aaa', '#c46a9f'];

// summary.json의 행 순서: 현황, 제안 1, 제안 2, 만차 즉시(참고)
const scenarios = [
  { key: 'base', name: '현황', row: 0, rule: 'headway', rest: 0,
    note: `AI공학관에 도착한 무당이는 만차가 되어도 앞차가 떠나고 ${headway / 60}분이 지나야 출발합니다. 혼잡 시간에는 만차인 차가 AI공학관에 서 있는 동안 반도체대학에 줄이 쌓입니다.` },
  { key: 'p1', name: '제안 1', row: 1, rule: 'headwayFull', rest: minRest,
    note: `만차인 무당이는 AI공학관에 도착해 ${minRest / 60}분을 쉬면 시간표보다 일찍 출발합니다. 만차가 아니면 지금처럼 시간표대로 출발합니다. 출발 규칙만 바꾸므로 추가 비용이 없습니다.` },
  { key: 'p2', name: '제안 2', row: 2, rule: 'headwayFull', rest: minRest, drivers: drivers2,
    note: `제안 1에 더해 AI공학관 옥상 정류장 옆에 기사님 휴게 공간을 만들고 기사님을 ${drivers2}명으로 늘립니다. 차가 도착하면 기사님은 내려서 쉬고, ${minRest / 60}분 이상 쉰 다른 기사님이 바로 차를 몰고 나갑니다.` },
];
// 보고서 표 6-1, 6-2와 같은 지표·순서·자릿수입니다.
const metrics = [
  ['표 6-1', '평균 대기시간', 'meanWait', v => `${v.toFixed(1)}분`, 'low'],
  ['표 6-1', '90분위 대기시간', 'p90Wait', v => `${v.toFixed(1)}분`, 'low'],
  ['표 6-1', '평균 통행시간', 'meanTravel', v => `${v.toFixed(1)}분`, 'low'],
  ['표 6-1', '반도체대학 평균 대기', 'semiWait', v => `${v.toFixed(1)}분`, 'low'],
  ['표 6-1', 'AI공학관 도착부터 출발까지', 'aiDepart', v => `${v.toFixed(1)}분`, 'low'],
  ['표 6-1', '운행 종료 때 남은 대기 인원', 'left', v => `${v.toFixed(0)}명`, 'low'],
  ['표 6-2', '기사님 1명당 시간당 휴식', 'restPerHour', v => `${v.toFixed(1)}분`, 'high'],
  ['표 6-2', '5분 이상 쉰 비율', 'restOver5', v => `${v.toFixed(0)}%`, 'high'],
  ['표 6-2', '5분 이상 쉬지 못한 최장 연속 운행', 'longestDrive', v => `${v.toFixed(0)}분`, 'low'],
  ['표 6-2', '필요한 기사님', 'drivers', v => `${v.toFixed(0)}명`, 'low'],
];
const $ = selector => document.querySelector(selector);
const clock = t => { const s = route.start + t;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
const cache = {};
let current, result, timer, frame = 0;

$('#app').innerHTML = `
<header class="top">
  <h1>무당이 AI공학관 출발 규칙 시뮬레이션</h1>
  <p>스마트 교통물류 기말 프로젝트 대시보드입니다. 설정은 모두 보고서와 같게 고정했고, 탭마다 그 자리에서 시뮬레이션을 다시 돌려 보고서의 값과 비교합니다.</p>
  <ul class="fixed">
    <li>운행 ${service.first_departure}~${service.last_departure} (반도체대학 출발)</li>
    <li>차량 ${fleet}대 · 정원 ${capacity}명</li>
    <li>시간표 ${headway / 60}분 간격</li>
    <li>수요는 체감 대기 인원에서 추정</li>
    <li>학생이 오는 시각 ${seeds.length}가지의 평균</li>
  </ul>
</header>
<main>
  <nav class="tabs" role="tablist" aria-label="시나리오">${scenarios.map(s =>
    `<button type="button" role="tab" class="tab" id="tab-${s.key}" data-key="${s.key}" aria-controls="panel">${s.name}</button>`).join('')}</nav>
  <section id="panel" role="tabpanel" class="panel">
    <p id="note" class="note"></p>
    <div class="replay">
      <div class="replay-head"><h2>운행 재생</h2><span class="clock" id="clock">--:--</span></div>
      <p class="sub">정류장은 대기 인원, 차량은 탑승 인원입니다. 흐린 차는 AI공학관에서 쉬는 중입니다.</p>
      <div id="route-map" aria-label="교내 도로와 차량 위치 지도"></div>
      <p id="map-note" class="sub"></p>
      <div class="playback"><button id="play" type="button">재생</button><label class="sr-only" for="timeline">운행 시각</label><input type="range" id="timeline" min="0" max="1" value="0"><span id="frame-label"></span></div>
      <div class="counts">
        <div><span>정류장 도착 누계</span><strong id="arrived">0명</strong></div>
        <div><span>대기 중</span><strong id="waiting">0명</strong></div>
        <div><span>탑승 중</span><strong id="onboard">0명</strong></div>
        <div><span>하차 완료</span><strong id="completed">0명</strong></div>
      </div>
    </div>
    <div class="check">
      <h2>보고서 값과 비교</h2>
      <p class="sub" id="status"></p>
      <div class="table-scroll"><table class="grid" id="check-table"></table></div>
    </div>
  </section>

  <section class="panel">
    <h2>네 시나리오 비교 (보고서 6-1, 6-2)</h2>
    <p class="sub">만차 즉시 출발은 실제로 쓰기 어렵지만, 출발 규칙만 바꿨을 때 얻을 수 있는 효과의 기준으로 넣었습니다.</p>
    <div class="table-scroll"><table class="grid">
      <thead><tr><th>지표</th>${summary.rows.map((r, i) => `<th>${['현황', '제안 1', '제안 2', '만차 즉시(참고)'][i]}</th>`).join('')}</tr></thead>
      <tbody>${metrics.map(([, label, key, fmt]) => `<tr><th>${label}</th>${summary.rows.map(r => `<td>${fmt(r[key])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </section>

  <section class="panel">
    <h2>조건을 바꿨을 때 (보고서 6-3)</h2>
    <p class="sub">기본 설정에서 값 하나씩만 바꿔 계산한 결과입니다.</p>
    <div class="table-scroll"><table class="grid">
      <thead><tr><th rowspan="2">조건</th><th colspan="3">평균 대기 (분)</th><th colspan="3">기사님 휴식 (분/시)</th></tr>
        <tr><th>현황</th><th>제안 1</th><th>제안 2</th><th>현황</th><th>제안 1</th><th>제안 2</th></tr></thead>
      <tbody>${csv(sensitivityTable).map(r => { const v = Object.values(r);
        return `<tr><th>${v[0]}</th><td>${v[1]}</td><td>${v[2]}</td><td>${v[3]}</td><td>${v[8]}</td><td>${v[9]}</td><td>${v[10]}</td></tr>`; }).join('')}</tbody>
    </table></div>
  </section>
</main>
<footer>코드와 데이터: <a href="https://github.com/seojin418-create/Mudang_Final">github.com/seojin418-create/Mudang_Final</a></footer>`;

const routeMap = createRouteMap(network, paths, route.visits, stopNodes, colors);

function simulateOne(s, seed, snapshotEvery) {
  return simulate({ route, duration, snapshotEvery, fleetSize: fleet, capacity,
    demand: windowDemand(route, windows, shares, duration, { seed }),
    departures: headwayDepartures(duration, headway).slice(0, fleet),
    terminal: { dwell: Number(service.terminal_dwell) },
    travelTime: (leg, time) => timetableETA(route, leg, time),
    hold: { stop: holdStop, rule: s.rule, dwell: Number(service.dwell), headway, running: 1, minRest: s.rest, drivers: s.drivers } });
}

function showCheck(s, live) {
  const report = summary.rows[s.row], base = summary.rows[0];
  let same = 0;
  const rows = metrics.map(([table, label, key, fmt, better]) => {
    const a = fmt(live[key]), b = fmt(report[key]), ok = a === b; same += ok;
    let change = '';
    if (s.row) {
      const d = report[key] - base[key], pct = base[key] ? d / base[key] * 100 : 0;
      const good = better === 'low' ? d < 0 : d > 0;
      change = Math.abs(pct) < 0.5 ? '<td class="muted">같음</td>'
        : `<td class="${good ? 'good' : 'bad'}">${pct > 0 ? '+' : ''}${pct.toFixed(0)}%</td>`;
    }
    return `<tr><th>${label}<small>${table}</small></th><td>${a}</td><td>${b}</td><td class="${ok ? 'good' : 'bad'}">${ok ? '일치' : '다름'}</td>${change}</tr>`;
  });
  $('#check-table').innerHTML = `<thead><tr><th>지표</th><th>이 화면에서 계산</th><th>보고서</th><th>비교</th>${s.row ? '<th>현황 대비</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody>`;
  $('#status').textContent = `${s.name} 운행을 학생이 오는 시각 ${seeds.length}가지로 다시 돌린 평균입니다. 지표 ${metrics.length}개 중 ${same}개가 보고서와 같습니다.`;
}

function pause() { clearInterval(timer); timer = null; $('#play').textContent = '재생'; }
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

function select(key) {
  pause();
  const s = scenarios.find(x => x.key === key);
  current = s;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.key === key)));
  $('#panel').setAttribute('aria-labelledby', `tab-${key}`);
  $('#note').textContent = s.note;
  $('#status').textContent = `${s.name} 운행을 학생이 오는 시각 ${seeds.length}가지로 계산하는 중입니다…`;
  // 안내 문구가 먼저 그려지도록 다음 차례에 계산하고, 한 번 계산한 탭은 다시 계산하지 않습니다.
  setTimeout(() => {
    if (current !== s) return;
    try {
      cache[key] ??= {
        live: average(seeds.map(seed => measure(simulateOne(s, seed, duration), { fleet, drivers: s.drivers, duration, holdStop }))),
        replay: simulateOne(s, seeds[0], 15),
      };
      result = cache[key].replay;
      $('#timeline').max = result.snapshots.length - 1;
      showFrame(0);
      showCheck(s, cache[key].live);
    } catch (error) { $('#status').textContent = `실행 오류: ${error.message}`; }
  }, 30);
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => select(t.dataset.key)));
document.querySelector('.tabs').addEventListener('keydown', event => {
  const i = scenarios.indexOf(current), step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  const next = scenarios[(i + step + scenarios.length) % scenarios.length];
  select(next.key); $(`#tab-${next.key}`).focus();
});
$('#play').addEventListener('click', () => {
  if (!result) return;
  if (timer) { pause(); return; }
  if (frame === result.snapshots.length - 1) showFrame(0);
  $('#play').textContent = '일시정지';
  timer = setInterval(() => { showFrame(frame + 1); if (frame === result.snapshots.length - 1) pause(); }, 50);
});
$('#timeline').addEventListener('input', event => { pause(); showFrame(+event.target.value); });
select('base');
