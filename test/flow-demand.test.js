import test from 'node:test';
import assert from 'node:assert/strict';
import { windowDemand, readDemandTables } from '../src/models.js';
import { csv } from '../src/gtfs.js';

const route = { visits: ['A', 'B', 'C', 'A'].map((stopId, i) => ({ stopId, pickup: i < 3, dropoff: i > 0 })) };
const shares = [{ origin: 'A', destination: 'B', share: 1 }, { origin: 'A', destination: 'C', share: 3 }];

test('시간대 인원과 목적지 비율대로 승객을 만듭니다', () => {
  const demand = windowDemand(route, [{ origin: 'A', start: 600, end: 1200, people: 400 }], shares, 3600);
  assert.equal(demand.length, 400);
  assert.ok(demand.every(p => p.arrival >= 600 && p.arrival < 1200 && p.origin === 0));
  const toC = demand.filter(p => p.destination === 2).length;
  assert.ok(toC > 260 && toC < 340, `C행 ${toC}명은 약 300명이어야 합니다`);
});

test('매시 반복은 분석 시간 안의 모든 시에 같은 인원을 놓습니다', () => {
  // 분석 시작이 10:00이고 매시 05~15분에 10명 → 10:05, 11:05, 12:05 (3시간)
  const { windows } = readDemandTables('origin,start,end,people,repeat\nA,11:05,11:15,10,매시\n', '', 36000, csv);
  const demand = windowDemand(route, windows, shares, 3 * 3600);
  assert.equal(demand.length, 30);
  assert.deepEqual([...new Set(demand.map(p => Math.floor(p.arrival / 3600)))], [0, 1, 2]);
  assert.equal(windowDemand(route, windows, shares, 3 * 3600, { scale: 2 }).length, 60);
});

test('노선에 없는 정류장이나 비율이 없는 출발지는 알려 줍니다', () => {
  assert.throws(() => windowDemand(route, [{ origin: 'Z', start: 0, end: 60, people: 1 }], shares, 3600), /노선/);
  assert.throws(() => windowDemand(route, [{ origin: 'B', start: 0, end: 60, people: 1 }], shares, 3600), /비율/);
});
