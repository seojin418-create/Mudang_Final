// 보고서 6장의 표(시나리오별 학생·기사 지표)를 무작위 값 다섯 가지의 평균으로 계산해 results/summary.json에 저장합니다.
// 대시보드는 이 파일을 그대로 보여 주므로 보고서 숫자와 같습니다.
// 사용: node scripts/summary.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFeed, csv, seconds } from '../src/gtfs.js';
import { windowDemand, readDemandTables, timetableETA, headwayDepartures } from '../src/models.js';
import { simulate } from '../src/simulation.js';

const text = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const route = readFeed(Object.fromEntries(['stops', 'routes', 'trips', 'stop_times', 'calendar', 'calendar_dates']
  .map(name => [name, text(`gtfs/${name}.txt`)])));
const service = Object.fromEntries(csv(text('data/service.csv')).map(r => [r.key, r.value]));
const duration = seconds(`${service.last_departure}:00`) - seconds(`${service.first_departure}:00`) + Number(service.headway);
const { windows, shares } = readDemandTables(text('data/demand.csv'), text('data/destinations.csv'), route.start, csv);
const holdStop = route.visits.findIndex(v => v.stopId === service.hold_stop);
const fleet = Number(service.fleet), headway = Number(service.headway), minRest = Number(service.min_rest);
const seeds = [42, 7, 101, 2024, 9];

const scenarios = [
  ['현황', 'headway', 0, undefined],
  ['제안 1 (만차 + 최소 휴식 5분)', 'headwayFull', minRest, undefined],
  [`제안 2 (기사 교대, 기사 ${fleet + Number(service.extra_drivers)}명)`, 'headwayFull', minRest, fleet + Number(service.extra_drivers)],
  ['참고: 만차 즉시 출발', 'headwayFull', 0, undefined],
];

function measure(rule, rest, drivers, seed) {
  const r = simulate({ route, duration, snapshotEvery: duration, fleetSize: fleet, capacity: Number(service.capacity),
    demand: windowDemand(route, windows, shares, duration, { seed }),
    departures: headwayDepartures(duration, headway).slice(0, fleet),
    travelTime: (leg, time) => timetableETA(route, leg, time), terminal: { dwell: Number(service.terminal_dwell) },
    hold: { stop: holdStop, rule, dwell: Number(service.dwell), headway, running: 1, minRest: rest, drivers } });
  const s = r.summary, n = drivers ?? fleet, hours = duration / 3600;
  const waitAt = stop => { const p = r.passengers.filter(x => x.origin === stop && x.boardedAt != null);
    return p.reduce((t, x) => t + x.boardedAt - x.arrival, 0) / p.length / 60; };
  // AI공학관 학생은 쉬는 차에 탄 뒤에도 출발을 기다리므로 도착부터 출발까지를 따로 봅니다.
  const ai = r.passengers.filter(x => x.origin === holdStop && x.boardedAt != null);
  const aiDepart = ai.reduce((t, x) => { const h = r.holds.find(h => h.vehicleId === x.vehicleId && h.arrivedAt <= x.boardedAt
    && h.departedAt >= x.boardedAt); return t + ((h ? h.departedAt : x.boardedAt) - x.arrival); }, 0) / ai.length / 60;
  // 휴식: 기사 교대면 기사가 휴게 공간에 있던 시간, 아니면 차가 AI공학관에 서 있던 시간
  const rests = drivers ? r.driverRests.map(x => ({ id: x.driverId, a: x.from, b: x.to }))
    : r.holds.map(h => ({ id: h.vehicleId, a: h.arrivedAt, b: h.departedAt }));
  let longest = 0;
  for (let d = 0; d < n; d++) {
    let last = 0;
    for (const x of rests.filter(x => x.id === d && x.b - x.a >= 300).sort((p, q) => p.a - q.a)) { longest = Math.max(longest, x.a - last); last = x.b; }
    longest = Math.max(longest, duration - last);
  }
  return { meanWait: s.meanWait / 60, p90Wait: s.p90Wait / 60, meanTravel: s.meanTravel / 60, semiWait: waitAt(0),
    aiDepart, left: s.waiting, restPerHour: rests.reduce((t, x) => t + x.b - x.a, 0) / n / hours / 60,
    restOver5: rests.filter(x => x.b - x.a >= 300).length / rests.length * 100, longestDrive: longest / 60, drivers: n };
}

const rows = scenarios.map(([name, rule, rest, drivers]) => {
  const all = seeds.map(seed => measure(rule, rest, drivers, seed));
  const avg = Object.fromEntries(Object.keys(all[0]).map(k => [k, all.reduce((t, x) => t + x[k], 0) / all.length]));
  return { name, ...avg };
});
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/summary.json', import.meta.url), JSON.stringify({ seeds, rows }, null, 1));
for (const r of rows) console.log(`${r.name}: 대기 ${r.meanWait.toFixed(1)} · p90 ${r.p90Wait.toFixed(1)} · 통행 ${r.meanTravel.toFixed(1)} · 휴식 ${r.restPerHour.toFixed(1)} · 5분↑ ${r.restOver5.toFixed(0)}% · 최장 ${r.longestDrive.toFixed(0)}분`);
