// 체감한 반도체대학·AI공학관 대기인원과 시뮬레이션의 평균 대기인원을 시간대별로 비교합니다.
// 사용: node scripts/check-queue.mjs [규칙=headway] [체감 수요 배율 %=100]
import { readFileSync } from 'node:fs';
import { readFeed, csv, seconds } from '../src/gtfs.js';
import { windowDemand, readDemandTables, timetableETA, headwayDepartures } from '../src/models.js';
import { simulate } from '../src/simulation.js';

const text = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const route = readFeed(Object.fromEntries(['stops', 'routes', 'trips', 'stop_times', 'calendar', 'calendar_dates']
  .map(name => [name, text(`gtfs/${name}.txt`)])));
const service = Object.fromEntries(csv(text('data/service.csv')).map(r => [r.key, r.value]));
const duration = seconds(`${service.last_departure}:00`) - seconds(`${service.first_departure}:00`) + Number(service.headway);
const { windows, shares } = readDemandTables(text('data/demand.csv'), text('data/destinations.csv'), route.start, csv);
const fleet = Number(service.fleet), headway = Number(service.headway);
const holdStop = route.visits.findIndex(v => v.stopId === service.hold_stop);
export function queueCheck(rule = 'headway', percent = 100, people = null, running = 1, minRest = 0) {
  const ws = people ? windows.map((w, i) => ({ ...w, people: people[i] ?? w.people })) : windows;
  const result = simulate({ route, duration, snapshotEvery: 15, fleetSize: fleet, capacity: Number(service.capacity),
  demand: windowDemand(route, ws, shares, duration, { scale: Number(percent) / 100, seed: 42 }),
  departures: headwayDepartures(duration, headway).slice(0, fleet),
  travelTime: (leg, time) => timetableETA(route, leg, time), terminal: { dwell: Number(service.terminal_dwell) },
  hold: { stop: holdStop, rule, dwell: Number(service.dwell), headway, running, minRest } });

  // 매시 반복하는 구간마다, 반복 시간 안의 같은 분 구간 스냅숏을 모아 평균합니다.
  // AI공학관(대기 정류장)은 쉬는 차에 이미 탄 학생도 세므로 "정류장 대기 + 쉬는 차의 인원"입니다.
  const minute = t => Math.floor((route.start + t) / 60) % 60;
  const present = (s, stop) => s.queues[stop] + (stop !== holdStop ? 0 : result.holds
    .filter(h => h.arrivedAt <= s.time && h.departedAt > s.time)
    .reduce((sum, h) => sum + s.vehicles.find(v => v.id === h.vehicleId).load, 0));
  const rows = ws.map((w, i) => ({ w, i })).filter(({ w }) => w.felt_queue !== '' && w.felt_queue != null).map(({ w, i }) => {
    const stop = route.visits.findIndex(v => v.stopId === w.origin);
    const a = Math.floor((route.start + w.start) / 60) % 60, b = (Math.floor((route.start + w.end) / 60) % 60) || 60;
    // 매시 반복이면 반복 시간 안의 같은 분 구간을, 반복하지 않으면 그 시각 구간만 봅니다.
    const inside = w.repeat
      ? s => s.time >= (w.repeatStart ?? 0) && s.time < (w.repeatEnd ?? duration) && minute(s.time) >= a && minute(s.time) < b
      : s => s.time >= w.start && s.time < w.end;
    const q = result.snapshots.filter(inside).map(s => present(s, stop));
    return { index: i, origin: w.origin, from: a, to: b, repeat: w.repeat, start: w.start, end: w.end,
      repeatStart: w.repeatStart ?? 0, repeatEnd: w.repeatEnd ?? duration,
      length: (w.end - w.start) / 60, people: w.people, felt: Number(w.felt_queue),
      mean: q.reduce((s, v) => s + v, 0) / q.length, max: Math.max(...q) };
  });
  rows.result = result;
  rows.present = (snapshot, origin) => present(snapshot, route.visits.findIndex(v => v.stopId === origin));
  return rows;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const [rule = 'headway', percent = '100'] = process.argv.slice(2);
  console.log(`규칙 ${rule} · 체감 수요 ${percent}%\n`);
  const rows = queueCheck(rule, Number(percent));
  console.log(`평균 대기시간 ${(rows.result.summary.meanWait / 60).toFixed(1)}분`);
  for (const r of rows) {
    const clock = t => { const m = Math.floor((route.start + t) / 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const span = r.repeat ? `매시 ${String(r.from).padStart(2, '0')}~${String(r.to).padStart(2, '0')}분` : `${clock(r.start)}~${clock(r.end)}`;
    console.log(`${route.visits.find(v => v.stopId === r.origin).name} ${span}  도착 ${r.people}명 · 체감 ${r.felt}명`
      + ` · 시뮬레이션 평균 ${r.mean.toFixed(1)}명 · 최대 ${r.max}명`);
  }
}