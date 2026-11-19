// 가정 값을 바꿔도 제안(headwayFull·최소 휴식)과 제안 2(기사 교대)가 현황(headway)보다 나은지 확인합니다.
// 한 번에 한 값만 바꾸고 나머지는 기본값으로 둡니다. 결과는 results/sensitivity.csv에도 저장합니다.
// 사용: node scripts/sensitivity.mjs
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
const fleet = Number(service.fleet);

function run(rule, { minRest = 0, semi = 1, ai = 1, capacity = Number(service.capacity), travel = 1, seed = 42, drivers }) {
  // 반도체대학(ST01)과 AI공학관(ST04) 수요 배율을 따로 적용합니다.
  const ws = windows.map(w => ({ ...w, people: w.people * (w.origin === 'ST01' ? semi : w.origin === 'ST04' ? ai : 1) }));
  const r = simulate({ route, duration, snapshotEvery: duration, fleetSize: fleet, capacity,
    demand: windowDemand(route, ws, shares, duration, { seed }),
    departures: headwayDepartures(duration, Number(service.headway)).slice(0, fleet),
    travelTime: (leg, time) => timetableETA(route, leg, time, travel), terminal: { dwell: Number(service.terminal_dwell) },
    hold: { stop: holdStop, rule, dwell: Number(service.dwell), headway: Number(service.headway), running: 1, minRest, drivers } });
  const s = r.summary;
  // 휴식은 기사 1명이 한 시간에 쉰 시간입니다(기사 교대가 아니면 차가 서 있던 시간).
  const rest = drivers ? r.driverRests.reduce((t, d) => t + d.to - d.from, 0) / drivers : s.holdSeconds / fleet;
  return { wait: s.meanWait / 60, travel: s.meanTravel / 60, rest: rest / (duration / 3600) / 60, left: s.waiting };
}

const cases = [
  ['기본값', {}],
  ['반도체대학 수요 50%', { semi: 0.5 }], ['반도체대학 수요 150%', { semi: 1.5 }], ['반도체대학 수요 200%', { semi: 2 }],
  ['AI공학관 수요 50%', { ai: 0.5 }], ['AI공학관 수요 150%', { ai: 1.5 }], ['AI공학관 수요 200%', { ai: 2 }],
  ['전체 수요 50%', { semi: 0.5, ai: 0.5 }], ['전체 수요 150%', { semi: 1.5, ai: 1.5 }],
  ['정원 15명', { capacity: 15 }], ['정원 20명', { capacity: 20 }],
  ['이동시간 80%', { travel: 0.8 }], ['이동시간 120%', { travel: 1.2 }],
];
// 난수에 따른 차이를 줄이려고 시드 5개의 평균을 씁니다.
const seeds = [42, 7, 101, 2024, 9];
const average = (rule, options) => {
  const rows = seeds.map(seed => run(rule, { ...options, seed }));
  return Object.fromEntries(Object.keys(rows[0]).map(k => [k, rows.reduce((s, r) => s + r[k], 0) / rows.length]));
};

const out = [['조건', '현황 평균 대기(분)', '제안 평균 대기(분)', '제안2 평균 대기(분)', '제안 대기 감소(%)',
  '현황 통행(분)', '제안 통행(분)', '제안2 통행(분)', '현황 기사당 휴식(분/시)', '제안 기사당 휴식(분/시)', '제안2 기사당 휴식(분/시)',
  '현황 남은 대기(명)', '제안 남은 대기(명)', '제안2 남은 대기(명)']];
console.log('조건 | 평균 대기 현황→제안→제안2 | 통행시간 | 기사당 휴식(분/시) | 남은 대기');
for (const [name, options] of cases) {
  const a = average('headway', options), b = average('headwayFull', { ...options, minRest: Number(service.min_rest) });
  // 제안 2: 기사 교대(기사 extra_drivers명 추가·휴게 공간) + 만차면 출발
  const c = average('headwayFull', { ...options, minRest: Number(service.min_rest), drivers: fleet + Number(service.extra_drivers) });
  const cut = (1 - b.wait / a.wait) * 100;
  out.push([name, a.wait, b.wait, c.wait, cut, a.travel, b.travel, c.travel, a.rest, b.rest, c.rest, a.left, b.left, c.left]
    .map(v => typeof v === 'number' ? v.toFixed(1) : v));
  const f = (k, d = 1) => [a, b, c].map(x => x[k].toFixed(d)).join('→');
  console.log(`${name} | ${f('wait')}분 (제안 ${cut.toFixed(0)}% 감소) | ${f('travel')}분 | ${f('rest')} | ${f('left', 0)}명`);
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/sensitivity.csv', import.meta.url), '﻿' + out.map(r => r.join(',')).join('\n') + '\n');
