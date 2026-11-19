// 차량 한 대가 AI공학관을 떠나 한 바퀴 돌고 다시 AI공학관을 떠날 때까지를 글로 출력합니다.
// 사용: node scripts/trace-lap.mjs [규칙=headway] [시작 시각=12:00] [차량 번호=0] [운행 대수=1]
import { readFileSync } from 'node:fs';
import { readFeed, csv, seconds } from '../src/gtfs.js';
import { exampleDemand, windowDemand, readDemandTables, timetableETA, headwayDepartures } from '../src/models.js';
import { simulate } from '../src/simulation.js';

const [rule = 'headway', from = '12:00', vehicleId = '0', running = '1'] = process.argv.slice(2);
const text = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const feed = Object.fromEntries(['stops', 'routes', 'trips', 'stop_times', 'calendar', 'calendar_dates']
  .map(name => [name, text(`gtfs/${name}.txt`)]));
const route = readFeed(feed);
const service = Object.fromEntries(csv(text('data/service.csv')).map(r => [r.key, r.value]));
const duration = seconds(`${service.last_departure}:00`) - seconds(`${service.first_departure}:00`) + Number(service.headway);
const { windows, shares } = readDemandTables(text('data/demand.csv'), text('data/destinations.csv'), route.start, csv);
const fleet = Number(service.fleet), headway = Number(service.headway), capacity = Number(service.capacity);
const holdStop = route.visits.findIndex(v => v.stopId === service.hold_stop);
const demand = [...exampleDemand(route, duration, Math.round(Number(service.demand) * duration / 3600), 42),
  ...windowDemand(route, windows, shares, duration, { seed: 42 })];

const result = simulate({ route, demand, duration, snapshotEvery: duration, fleetSize: fleet, capacity,
  departures: headwayDepartures(duration, headway).slice(0, fleet),
  travelTime: (leg, time) => timetableETA(route, leg, time), terminal: { dwell: Number(service.terminal_dwell) },
  hold: { stop: holdStop, rule, dwell: Number(service.dwell), headway, running: Number(running),
    // 제안(headwayFull)에는 data/service.csv의 최소 휴식을 적용합니다.
    minRest: rule === 'headwayFull' ? Number(service.min_rest) : 0 } });

const clock = t => { const s = route.start + t;
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':'); };
const end = route.visits.length - 1;
// 각 정류장 도착 기록에 출발 시각(다음 도착 − 구간 이동시간)을 붙입니다.
const mine = result.events.filter(e => e.vehicleId === Number(vehicleId));
const legOf = stop => stop === end ? 0 : stop;
const rows = mine.map((e, i) => {
  const next = mine[i + 1];
  return { ...e, departed: next ? next.time - route.travelSeconds[legOf(e.stop)] : null };
});
// 시작 시각 이후 처음 AI공학관에 도착한 기록부터 다음 AI공학관 출발까지
const startAt = rows.findIndex(e => e.stop === holdStop && e.time >= seconds(`${from}:00`) - route.start);
const stopAt = rows.findIndex((e, i) => i > startAt && e.stop === holdStop);
if (startAt < 0 || stopAt < 0) throw new Error('그 시각 이후 한 바퀴 기록이 없습니다.');
const lap = rows.slice(startAt, stopAt + 1);
const hold = (e) => result.holds.find(h => h.vehicleId === e.vehicleId && h.arrivedAt === e.time);

console.log(`규칙 ${rule} · 차량 ${fleet}대 중 ${vehicleId}번 차 · 정원 ${capacity}명\n`);
let onboard;
for (const [i, e] of lap.entries()) {
  const name = route.visits[e.stop].name, h = e.stop === holdStop ? hold(e) : null;
  const departed = h ? h.departedAt : e.departed;
  // 대기 정류장과 기점에서는 서 있는 동안 더 탄 인원이 있으므로 출발 때 인원으로 다시 셉니다.
  const leaving = h ? h.onboard : (lap[i + 1] ? lap[i + 1].onboard - lap[i + 1].board + lap[i + 1].alight : e.onboard);
  const boardedTotal = leaving - (e.onboard - e.board);
  const stay = departed === null ? '' : ` → ${clock(departed)} 출발 (${Math.round((departed - e.time) / 6) / 10}분 정차)`;
  const reason = { schedule: '시간표 대기 5분을 채워 출발', full: '시간표 대기를 채워 출발',
    headway: '앞차 출발 후 5분이 지나 출발', headwayFull: '앞차 출발 후 5분이 지나 출발',
    relay: '앞차가 돌아와 교대 출발', relayFull: '앞차가 돌아와 교대 출발', defer: '휴식을 채워 출발' }[rule];
  const fullNow = h?.full && ['full', 'headwayFull', 'relayFull', 'defer'].includes(rule) && h.departedAt - h.arrivedAt < (rule === 'full' ? route.visits[holdStop].dwell : Infinity);
  const why = h ? ` · ${fullNow ? '만차라서 바로 출발' : reason}${h.full && !fullNow ? '(만차인 채로 기다림)' : ''}` : '';
  if (i === lap.length - 1) { console.log(`${clock(e.time)} ${name} 도착 · ${e.alight}명 내림 · 한 바퀴 ${((e.time - lap[0].time) / 60).toFixed(1)}분`); break; }
  console.log(`${clock(e.time)} ${name} 도착 · ${e.alight}명 내림 · ${boardedTotal}명 탐${stay}${why}`);
  // 기점(반도체대학) 도착 기록은 도착 칸의 대기열이라 출발 쪽 대기인원을 담지 않으므로 출력하지 않습니다.
  console.log(`         차 안 ${leaving}/${capacity}명` + (e.stop === end ? '' : ` · 정류장에 남은 대기 ${e.waiting}명`));
  onboard = leaving;
}
