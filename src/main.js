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
import { exampleDemand, windowDemand, readDemandTables, timetableETA, headwayDepartures } from './models.js';
import { simulate } from './simulation.js';
import { network, stopNodes } from './network.js';
import { createRouteMap } from './map.js';
import { connectRoute } from './routing.js';
// 보고서 6장과 같은 값(무작위 값 다섯 가지의 평균): node scripts/summary.mjs, node scripts/sensitivity.mjs로 만듭니다.
import summary from '../results/summary.json';
import sensitivityTable from '../results/sensitivity.csv?raw';

const route = readFeed({ stops, routes, trips, stop_times, calendar, calendar_dates });
const paths = connectRoute(route, network, stopNodes);
// 화면 기본값과 분석 시간대는 data/service.csv를 따릅니다.
const service = Object.fromEntries(csv(serviceTable).map(r => [r.key, r.value]));
const duration = seconds(`${service.last_departure}:00`) - seconds(`${service.first_departure}:00`) + Number(service.headway);
const seed = 42;
// 체감 수요(data/demand.csv)와 목적지 비율(data/destinations.csv)입니다.
const { windows, shares } = readDemandTables(demandTable, sharesTable, route.start, csv);
// 시간표를 맞추려고 기다리는 정류장(AI공학관)의 출발 규칙입니다. 같은 수요로 네 규칙을 비교합니다.
const holdStop = route.visits.findIndex(v => v.stopId === service.hold_stop);
// AI공학관 대기는 기사 휴식시간이라 없앨 수 없습니다. 대기 없음은 비교 기준으로만 둡니다.
// [화면 값, 이름, simulate 규칙, 동시에 운행하는 차량 수(교대 규칙에만 씀), 최소 휴식(초), 추가 기사 수]
// 기사 교대(제안 2): AI공학관에 휴게 공간을 두고 기사를 늘려, 차가 오면 기사는 내려 쉬고 가장 오래 쉰 기사가 탑니다.
// 현황(본인 관찰): AI공학관에서 줄을 서서 쉬다가 시간표대로 5분마다 1대씩 출발합니다.
const rules = [
  ['headway', '현황: 시간표대로 출발 (배차간격마다 1대)', 'headway', 1],
  ['headwayFull', `제안: 시간표 + 만차면 출발(최소 휴식 ${service.min_rest / 60}분)`, 'headwayFull', 1, Number(service.min_rest)],
  ['swap', `제안 2: 기사 교대(기사 ${service.extra_drivers}명 추가·휴게 공간) + 만차면 출발`, 'headwayFull', 1, Number(service.min_rest), Number(service.extra_drivers)],
  ['fullNow', '참고: 만차면 바로 출발(최소 휴식 없음)', 'headwayFull', 1, 0],
];const ruleOf = key => rules.find(r => r[0] === key);
const colors = ['#c94b40', '#186a80', '#bc8728', '#75539c'];
const $ = selector => document.querySelector(selector);
const clock = seconds => {
  const t = route.start + seconds;
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
};
let result, timer, frame = 0;
$('#app').innerHTML = `
<header class="topbar"><div class="brand"><span class="bug" aria-hidden="true">●</span> 무당이 시뮬레이션 <span class="badge">기말 프로젝트</span></div><span class="top-note">무당이 순환 노선 · 수요는 체감 값${import.meta.env.DEV ? ' · <a href="/stop-editor.html">정류장 편집</a> · <a href="/input-editor.html">입력값 편집</a>' : ''}</span></header>
<main>
  <section class="intro"><div><p class="eyebrow">GACHON · SHUTTLE SIMULATION</p><h1>AI공학관 출발 규칙 개선 시뮬레이션</h1><p>현황과 제안의 차량 이동, 정류장별 대기, 학생 대기시간과 기사 휴식을 비교합니다.</p></div><span class="period">평일 운행 (반도체대학 기준)<br><strong>${clock(0)} — ${clock(duration)}</strong></span></section>
  <div class="notice"><span class="notice-dot"></span><p><strong>시간표는 data/의 관측·가정 값으로 만들었고, 수요는 본인 체감(반도체대학·AI공학관의 매시 시간대별 대기, 아침·저녁 대기)입니다.</strong> ${route.visits.map(v => v.name).join(' → ')} 순환 노선입니다. ${route.visits[0].name}에서는 ${service.terminal_dwell / 60}분 태우고 인원과 관계없이 바로 출발하며, ${route.visits[holdStop].name}의 출발 방식은 아래 규칙으로 비교합니다.</p></div>
  <div class="workspace">
    <aside class="panel controls"><p class="eyebrow">01 / 실험 조건</p><h2>운행 설정</h2>
      <form id="controls">
        <label for="fleet">차량 수 <span>대</span></label><input id="fleet" type="number" value="${service.fleet}" min="1" max="8" required>
        <label for="headway">배차간격 (AI공학관 출발) <span>분</span></label><input id="headway" type="number" value="${service.headway / 60}" min="2" max="30" required>
        <label for="demand">추가 무작위 수요 <span>명/시간</span></label><input id="demand" type="number" value="${service.demand}" min="0" max="1000" step="10" required>
        <label for="scale">체감 수요 배율 <span>%</span></label><input id="scale" type="number" value="100" min="0" max="300" step="10" required>
        <label for="rule">${route.visits[holdStop].name} 출발 규칙</label><select id="rule">${rules.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
        <button class="primary" type="submit">설정 적용 <span>→</span></button><button id="reset" type="button" class="quiet">초기화</button>
      </form><p id="status" role="status" class="status"></p>
      <p class="help bottom-note">차량 정원 ${service.capacity}명 고정 · 기본값은 data/service.csv · 체감 수요는 data/demand.csv·destinations.csv 값에 배율을 곱합니다 · 추가 무작위 수요는 교수님 예제 모형(기본 0)</p>
    </aside>
    <div class="results">
      <section class="panel route-panel"><div class="section-head"><div><p class="eyebrow">02 / 운행 재생</p><h2>차량 위치</h2></div><span class="live-time" id="clock">11:00</span></div>
        <div class="map-label"><span>실제 교내 도로 · 최단거리 경로</span><span>정류장: 대기인원 · 차량: 탑승인원</span></div>
        <div id="route-map" aria-label="교내 도로와 차량 위치 지도"></div><p class="help" id="map-note">초록색 선: 운행 경로 · 지도를 움직이거나 확대할 수 있습니다.</p>
        <div class="playback"><button id="play" type="button" aria-label="운행 재생">▶ 재생</button><label class="sr-only" for="timeline">운행 시각</label><input type="range" id="timeline" min="0" max="240" value="0"><span id="frame-label">0 / ${duration / 60}분</span></div>
        <div class="snapshot-info" id="snapshot-info"></div>
      </section>
      <section class="metric-grid" aria-label="재생 시각의 승객 현황">
        <article><span>정류장 도착 누계</span><strong id="arrived">0명</strong></article>
        <article><span>대기 중</span><strong id="waiting">0명</strong></article>
        <article><span>탑승 중</span><strong id="onboard">0명</strong></article>
        <article><span>하차 완료</span><strong id="completed">0명</strong></article>
      </section>
      <p class="help">아래는 재생 시각과 관계없는 ${clock(0)}–${clock(duration)} 전체 결과입니다.</p>
      <section class="metric-grid" aria-label="분석 시간 전체 결과">
        <article><span>평균 대기</span><strong id="mean-wait">-</strong></article>
        <article><span>90분위 대기</span><strong id="p90-wait">-</strong></article>
        <article><span>만차 출발</span><strong id="full-departures">-</strong></article>
        <article><span>종료 시 남은 대기</span><strong id="left-waiting">-</strong></article>
        <article><span>${route.visits[holdStop].name} 평균 출발 간격</span><strong id="departure-gap">-</strong></article>
        <article><span>운행 바퀴 (전체 차량)</span><strong id="trips">-</strong></article>
        <article><span>평균 차내 시간</span><strong id="in-vehicle">-</strong></article>
        <article><span>평균 통행시간 (대기 포함)</span><strong id="travel">-</strong></article>
      </section>
      <section class="panel"><p class="eyebrow">03 / 보고서 결과</p><h2>시나리오별 평균 결과 (무작위 값 ${summary.seeds.length}가지 평균)</h2>
        <p class="help">보고서 6장의 표와 같은 값입니다. 학생이 오는 시각을 무작위 값 ${summary.seeds.length}가지로 바꿔 돌린 결과의 평균이라, 아래 04의 한 번 실행 결과와는 조금 다를 수 있습니다.</p>
        <div class="table-scroll"><table class="compare"><thead><tr><th>시나리오</th><th>평균 대기</th><th>90분위 대기</th><th>평균 통행시간</th><th>반도체대학 대기</th><th>AI공학관 도착→출발</th><th>기사당 휴식 (시간당)</th><th>5분 이상 휴식</th><th>최장 연속 운행</th><th>기사</th></tr></thead>
        <tbody>${summary.rows.map(r => `<tr><td>${r.name}</td><td>${r.meanWait.toFixed(1)}분</td><td>${r.p90Wait.toFixed(1)}분</td><td>${r.meanTravel.toFixed(1)}분</td><td>${r.semiWait.toFixed(1)}분</td><td>${r.aiDepart.toFixed(1)}분</td><td>${r.restPerHour.toFixed(1)}분</td><td>${r.restOver5.toFixed(0)}%</td><td>${r.longestDrive.toFixed(0)}분</td><td>${r.drivers}명</td></tr>`).join('')}</tbody></table></div>
        <h2 style="margin-top:18px">조건을 바꿨을 때 (민감도 분석)</h2>
        <div class="table-scroll"><table class="compare"><thead><tr><th>조건</th><th>평균 대기 현황 → 제안 1 → 제안 2</th><th>기사당 휴식(분/시) 현황 → 제안 1 → 제안 2</th><th>남은 대기 현황 → 제안 1 → 제안 2</th></tr></thead>
        <tbody>${csv(sensitivityTable).map(r => { const v = Object.values(r); return `<tr><td>${v[0]}</td><td>${v[1]} → ${v[2]} → ${v[3]}분</td><td>${v[8]} → ${v[9]} → ${v[10]}</td><td>${Math.round(v[11])} → ${Math.round(v[12])} → ${Math.round(v[13])}명</td></tr>`; }).join('')}</tbody></table></div>
      </section>
      <section class="panel"><p class="eyebrow">04 / 시나리오 비교 (한 번 실행)</p><h2>${route.visits[holdStop].name} 출발 규칙별 결과</h2>
        <p class="help">같은 수요(시드 ${seed})와 같은 차량으로 규칙마다 계산합니다. ${route.visits[holdStop].name}에 먼저 온 차부터 줄을 서서 쉬고(최소 ${service.dwell}초), 앞차가 떠난 지 배차간격이 지나면 맨 앞 차가 출발합니다. 휴식은 기사 1명이 한 시간에 ${route.visits[holdStop].name}에서 쉰 평균 시간입니다(기사 교대가 아니면 차가 서 있던 시간과 같음). 차내 대기는 ${route.visits[holdStop].name}에서 출발을 기다리는 동안 차 안에 있던 승객의 시간을 모두 더한 값입니다.</p>
        <div class="table-scroll"><table class="compare"><thead><tr><th>출발 규칙</th><th>평균 대기</th><th>90분위 대기</th><th>평균 차내 시간</th><th>평균 통행시간</th><th>차내 대기 합계</th><th>만차 출발</th><th>휴식 (기사당 시간당)</th><th>출발 간격</th><th>운행 바퀴</th><th>남은 대기</th></tr></thead><tbody id="compare"></tbody></table></div>
      </section>
    </div>
  </div>
</main>`;

const routeMap = createRouteMap(network, paths, route.visits, stopNodes, colors);

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
  $('#snapshot-info').textContent = '아래 인원은 현재 재생 시각 기준입니다.';
}

const capacity = Number(service.capacity);
const minutes = v => v === null ? '-' : `${(v / 60).toFixed(1)}분`;
// 만차로 떠난 횟수: 대기 정류장에서는 출발 시점, 나머지 정류장에서는 승차 직후 기준입니다.
const fullDepartures = (r, rule) => r.summary.fullHolds
  + r.events.filter(e => e.onboard === capacity && e.board > 0 && (rule === 'none' || e.stop !== holdStop)).length;

// 대기 정류장을 떠난 시각 사이의 평균 간격입니다. 대기 없음 규칙은 대기 기록이 없어 '-'입니다.
function departureGap(r) {
  const t = r.holds.map(h => h.departedAt).sort((a, b) => a - b);
  return t.length > 1 ? (t.at(-1) - t[0]) / (t.length - 1) : null;
}

// 기사 1명이 한 시간에 쉰 평균 시간입니다. 기사 교대가 아니면 기사가 차와 함께 쉬므로 차가 서 있던 시간과 같습니다.
function restPerHour(r) {
  if (r.driverRests.length) {
    const drivers = new Set(r.driverRests.map(d => d.driverId)).size;
    return r.driverRests.reduce((s, d) => s + d.to - d.from, 0) / drivers / (duration / 3600);
  }
  return r.summary.holdSeconds / +$('#fleet').value / (duration / 3600);
}

function simulateRule(key, demand, snapshotEvery) {
  const [, , rule, running, minRest = 0, extra] = ruleOf(key);
  return simulate({ route, demand, duration, snapshotEvery, fleetSize: +$('#fleet').value, capacity,
    // 처음에는 배차간격만큼 차이를 두고 차량을 내보내고, 그 뒤로는 반도체대학에서 탑승시간만 서고 다시 출발합니다.
    departures: headwayDepartures(duration, +$('#headway').value * 60).slice(0, +$('#fleet').value),
    terminal: { dwell: Number(service.terminal_dwell) },
    travelTime: (leg, time) => timetableETA(route, leg, time),
    hold: { stop: holdStop, rule, dwell: Number(service.dwell), headway: +$('#headway').value * 60,
      running: Math.min(running, +$('#fleet').value), minRest,
      ...(extra === undefined ? {} : { drivers: +$('#fleet').value + extra }) } });
}

function run() {
  pause();
  try {
    const demand = [...exampleDemand(route, duration, Math.round(+$('#demand').value * duration / 3600), seed),
      ...windowDemand(route, windows, shares, duration, { scale: +$('#scale').value / 100, seed })];
    const rule = $('#rule').value;
    // 8시간을 1초마다 기록하면 재생이 길어지므로 15초마다 기록합니다.
    result = simulateRule(rule, demand, 15);
    $('#timeline').max = result.snapshots.length - 1;
    showFrame(0);
    // 아래 지표는 재생 시각과 관계없이 분석 시간 전체의 결과입니다.
    const s = result.summary;
    $('#mean-wait').textContent = minutes(s.meanWait);
    $('#p90-wait').textContent = minutes(s.p90Wait);
    $('#full-departures').textContent = `${fullDepartures(result, rule)}회`;
    $('#left-waiting').textContent = `${s.waiting}명`;
    $('#departure-gap').textContent = minutes(departureGap(result));
    $('#trips').textContent = `${s.laps}바퀴`;
    $('#in-vehicle').textContent = minutes(s.meanInVehicle);
    $('#travel').textContent = minutes(s.meanTravel);
    $('#compare').innerHTML = rules.map(([value, label]) => {
      const r = value === rule ? result : simulateRule(value, demand, duration), c = r.summary;
      return `<tr${value === rule ? ' class="current"' : ''}><td>${label}</td><td>${minutes(c.meanWait)}</td><td>${minutes(c.p90Wait)}</td>
        <td>${minutes(c.meanInVehicle)}</td><td>${minutes(c.meanTravel)}</td><td>${(c.heldPassengerSeconds / 60).toFixed(0)}인·분</td>
        <td>${fullDepartures(r, value)}회</td><td>${minutes(restPerHour(r))}</td><td>${minutes(departureGap(r))}</td><td>${c.laps}바퀴</td><td>${c.waiting}명</td></tr>`;
    }).join('');
    $('#status').textContent = '재생을 누르면 차량이 출발합니다.';
  } catch (error) { $('#status').textContent = `실행 오류: ${error.message}`; }
}
$('#controls').addEventListener('submit', event => { event.preventDefault(); run(); });
$('#controls').addEventListener('input', () => { $('#status').textContent = '설정 적용을 누르면 처음부터 다시 계산합니다.'; });
$('#reset').addEventListener('click', () => { HTMLFormElement.prototype.reset.call($('#controls')); run(); });
$('#play').addEventListener('click', () => {
  if (!result) return;
  if (timer) { pause(); return; }
  if (frame === result.snapshots.length - 1) showFrame(0);
  $('#play').textContent = 'Ⅱ 일시정지';
  timer = setInterval(() => { showFrame(frame + 1); if (frame === result.snapshots.length - 1) pause(); }, 50);
});
$('#timeline').addEventListener('input', event => { pause(); showFrame(+event.target.value); });
run();
