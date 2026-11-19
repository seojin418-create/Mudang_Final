// 체감 대기인원(felt_queue)을 재현하는 도착 인원(people)을 정류장마다 찾아 data/demand.csv에 적습니다.
//
// 1) 모양(수식): 정류장에 남은 사람 = 온 사람 − 태워 간 사람이므로, 구간 i의 도착 인원은
//      A_i = (정원 ÷ 배차간격) × 구간 길이 + (구간 끝 대기 − 구간 시작 대기)
//    현황은 5분마다 1대가 정원만큼 태워 갑니다. 구간 경계의 대기는 앞뒤 구간 체감값의 평균으로 둡니다.
// 2) 크기: 매시 반복 구간은 시간 평균 대기가 체감의 시간 평균과 같아지도록 정류장마다 배율 하나를 이분법으로 찾습니다.
//    반복하지 않는 구간(아침·저녁)은 같은 수식을 쓰되, 구간 시작 대기를 체감 대신 바로 앞까지 계산한 시뮬레이션 대기로 둡니다.
//    순서는 아침 → 매시 반복 배율 → 저녁이고, 서로 조금씩 영향을 주므로 두 번 되풀이합니다.
// 사용: node scripts/calibrate-demand.mjs  (직전 파일은 data/demand.prev.csv로 남습니다)
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { queueCheck } from './check-queue.mjs';

const file = new URL('../data/demand.csv', import.meta.url);
const service = readFileSync(new URL('../data/service.csv', import.meta.url), 'utf8');
const value = key => Number(service.match(new RegExp(`^${key},(\\d+)`, 'm'))[1]);
const perMinute = value('capacity') / (value('headway') / 60);

const base = queueCheck('headway');
const origins = [...new Set(base.map(r => r.origin))];
const shape = new Map();
// 반도체대학처럼 매시 반복하는 구간은 같은 정류장의 반복 구간끼리 앞뒤를 잇고(정각을 넘어 돌아감),
// 9:30 전·17:30 뒤처럼 반복하지 않는 구간은 실제 시각으로 앞뒤 구간을 찾습니다.
const minuteOf = t => Math.floor(t / 60) % 60;
const feltAt = (origin, t) => base.find(r => r.origin === origin && (r.repeat
  ? t >= r.repeatStart && t < r.repeatEnd && ((minuteOf(t) - minuteOf(r.start) + 60) % 60) < r.length
  : t >= r.start && t < r.end))?.felt;
for (const origin of origins) {
  const group = base.filter(r => r.origin === origin && r.repeat);
  for (const r of base.filter(x => x.origin === origin)) {
    let startQueue, endQueue;
    if (r.repeat) {
      const i = group.indexOf(r), prev = group.at(i - 1), next = group[(i + 1) % group.length];
      startQueue = (prev.felt + r.felt) / 2; endQueue = (r.felt + next.felt) / 2;
    } else {
      startQueue = (r.felt + (feltAt(origin, r.start - 1) ?? r.felt)) / 2;
      endQueue = (r.felt + (feltAt(origin, r.end) ?? r.felt)) / 2;
    }
    // 도착이 0명인 구간이 생기지 않도록 각 구간에 태워 가는 양의 절반은 최소로 둡니다(체감이 0이면 0명).
    const flow = perMinute * r.length + endQueue - startQueue;
    shape.set(r.index, r.felt === 0 && flow <= 0 ? 0 : Math.max(perMinute * r.length / 2, flow));
  }
}
const scale = Object.fromEntries(origins.map(o => [o, 1]));
// 매시 반복 구간은 모양 × 정류장 배율, 반복하지 않는 구간(아침·저녁)은 아래 fitSingle이 정한 인원입니다.
const fixed = new Map(base.filter(r => !r.repeat).map(r => [r.index, shape.get(r.index)]));
const people = () => Object.fromEntries(base.map(r => [r.index,
  Math.round(r.repeat ? shape.get(r.index) * scale[r.origin] : fixed.get(r.index))]));
// 시간 평균: 매시 반복 구간은 반복하는 시간 수만큼 무게를 줍니다.
const span = r => r.length * (r.repeat ? (r.repeatEnd - r.repeatStart) / 3600 : 1);
const weighted = (rows, origin) => { const g = rows.filter(r => r.origin === origin && r.repeat);
  return g.reduce((s, r) => s + r.mean * span(r), 0) / g.reduce((s, r) => s + span(r), 0); };
const target = origin => weighted(base.map(r => ({ ...r, mean: r.felt })), origin);

// 반복하지 않는 구간은 시각 순서대로, 시작 대기를 체감 대신 바로 앞까지 계산한 시뮬레이션 대기로 바꿔 수식을 다시 씁니다.
// (현황은 시간표대로 출발하므로 어떤 시각의 대기는 그 전에 온 사람에게만 달려 있습니다.)
const queueAt = (rows, origin, t) => {
  // 분석 시작(t = 0) 전에는 정류장이 비어 있습니다.
  const snap = rows.result.snapshots.filter(x => x.time >= t - 60 && x.time < t);
  return snap.length ? snap.reduce((sum, x) => sum + rows.present(x, origin), 0) / snap.length : 0;
};
const fitSingle = r => {
  const startQueue = queueAt(queueCheck('headway', 100, people()), r.origin, r.start);
  const endQueue = (r.felt + (feltAt(r.origin, r.end) ?? r.felt)) / 2;
  fixed.set(r.index, Math.max(0, perMinute * r.length + endQueue - startQueue));
};
const blockStart = Math.min(...base.filter(x => x.repeat).map(x => x.repeatStart));
const single = base.filter(x => !x.repeat).sort((a, b) => a.start - b.start);
for (let pass = 0; pass < 2; pass++) {
  single.filter(r => r.end <= blockStart).forEach(fitSingle);
  for (const origin of origins) {
    let low = 0.5, high = 1.5;
    for (let round = 0; round < 14; round++) {
      scale[origin] = (low + high) / 2;
      if (weighted(queueCheck('headway', 100, people()), origin) < target(origin)) low = scale[origin]; else high = scale[origin];
    }
    scale[origin] = (low + high) / 2;
  }
  single.filter(r => r.end > blockStart).forEach(fitSingle);
}
const rows = queueCheck('headway', 100, people());
for (const origin of origins) {
  console.log(`${origin} 배율 ${scale[origin].toFixed(3)} · 목표 시간 평균 ${target(origin).toFixed(1)}명 · 시뮬레이션 ${weighted(rows, origin).toFixed(1)}명`);
}
for (const r of rows) {
  const name = r.repeat ? `매시 ${String(r.from).padStart(2, '0')}~${String(r.to).padStart(2, '0')}분` : `${r.start / 60}분부터 ${r.length}분`;
  console.log(`${r.origin} ${name}  도착 ${r.people}명`
    + ` (시간당 ${Math.round(r.people * 60 / r.length)}명) · 체감 ${r.felt}명 · 시뮬레이션 평균 ${r.mean.toFixed(1)}명 · 최대 ${r.max}명`);
}

// people 열만 바꿔 적습니다.
const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
const lines = text.split(/\r?\n/);
const col = lines[0].split(',').indexOf('people');
const result = people();
const out = lines.map((line, i) => {
  if (i === 0 || !line || !(i - 1 in result)) return line;
  const cells = line.split(','); cells[col] = String(result[i - 1]); return cells.join(',');
});
copyFileSync(file, new URL('../data/demand.prev.csv', import.meta.url));
writeFileSync(file, '﻿' + out.join('\r\n'));
console.log('\ndata/demand.csv의 people을 바꿨습니다.');
