import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/simulation.js';

// A → B(시간표 대기 10초) → A, 구간 10초. B가 대기 정류장입니다.
const route = { visits: [
  { stopId: 'A', name: 'A', dwell: 0, pickup: true, dropoff: false },
  { stopId: 'B', name: 'B', dwell: 10, pickup: true, dropoff: true },
  { stopId: 'A', name: 'A', dwell: 0, pickup: false, dropoff: true },
] };
const run = (rule, options) => simulate({ route, duration: 60, snapshotEvery: 1, departures: [0],
  fleetSize: 1, capacity: 2, travelTime: () => 10, hold: { stop: 1, rule, dwell: 2 }, ...options });
const lateRider = { id: 'late', arrival: 15, origin: 1, destination: 2 };

test('시간표 대기 중에 온 승객도 타고, 시간표 시각에 출발합니다', () => {
  const result = run('schedule', { demand: [lateRider] });
  assert.equal(result.passengers[0].boardedAt, 15);
  assert.equal(result.passengers[0].alightedAt, 30);
  assert.deepEqual(result.holds.map(h => [h.arrivedAt, h.departedAt]), [[10, 20]]);
  // 15~19초 동안 1명이 차 안에서 기다립니다.
  assert.equal(result.summary.heldPassengerSeconds, 5);
});

test('만차가 되면 시간표 시각 전에 출발합니다', () => {
  const demand = [0, 1].map(id => ({ id, arrival: 0, origin: 0, destination: 2 }));
  const result = run('full', { demand: [...demand, lateRider] });
  assert.deepEqual(result.holds.map(h => [h.departedAt, h.full]), [[10, true]]);
  assert.deepEqual(result.passengers.map(p => p.alightedAt), [20, 20, null]);
  assert.equal(result.summary.fullHolds, 1);
});

test('대기 없음은 정차시간만 서고 늦게 온 승객은 태우지 않습니다', () => {
  const result = run('none', { demand: [lateRider] });
  assert.equal(result.passengers[0].boardedAt, null);
  assert.equal(result.holds.length, 0);
  assert.equal(result.events.filter(e => e.stop === 2)[0].time, 22);
});

// 차 2대가 2초 차이로 출발합니다. B에서 앞차가 떠난 지 20초가 지나야 다음 차가 출발합니다.
const spaced = (rule, demand) => simulate({ route, duration: 60, snapshotEvery: 1, departures: [0, 2],
  fleetSize: 2, capacity: 2, travelTime: () => 10, demand, hold: { stop: 1, rule, dwell: 2, headway: 20 } });

test('간격 유지는 앞차가 떠난 지 간격만큼 지나야 출발합니다', () => {
  const result = spaced('headway', []);
  // 첫 차는 앞차가 없으니 최소 정차 2초 후, 둘째 차는 첫 차 출발 12초 + 20초 = 32초에 출발합니다.
  assert.deepEqual(result.holds.map(h => [h.vehicleId, h.arrivedAt, h.departedAt]), [[0, 10, 12], [1, 12, 32]]);
});

test('만차 또는 간격: 만차가 되면 간격을 기다리지 않습니다', () => {
  const demand = [0, 1].map(id => ({ id, arrival: 13, origin: 1, destination: 2 }));
  const full = spaced('headwayFull', demand), wait = spaced('headway', demand);
  assert.deepEqual(full.holds.map(h => [h.vehicleId, h.departedAt, h.full]), [[0, 12, false], [1, 13, true]]);
  assert.deepEqual(wait.holds.map(h => [h.vehicleId, h.departedAt, h.full]), [[0, 12, false], [1, 32, true]]);
  // 만차로 기다린 19초 × 2명이 줄어듭니다.
  assert.equal(wait.summary.heldPassengerSeconds - full.summary.heldPassengerSeconds, 38);
});

test('최소 휴식: 만차로 일찍 떠날 때만 도착 후 최소 휴식을 채웁니다', () => {
  const demand = [0, 1].map(id => ({ id, arrival: 13, origin: 1, destination: 2 }));
  const result = simulate({ route, duration: 60, snapshotEvery: 1, departures: [0, 2], fleetSize: 2, capacity: 2,
    travelTime: () => 10, demand, hold: { stop: 1, rule: 'headwayFull', dwell: 2, headway: 20, minRest: 5 } });
  // 0번은 앞차가 없으니 간격 규칙대로 12초에 출발합니다. 1번은 13초에 만차지만 12+5=17초까지 쉰 뒤 출발합니다.
  assert.deepEqual(result.holds.map(h => [h.vehicleId, h.departedAt, h.full]), [[0, 12, false], [1, 17, true]]);
});

test('기사 교대: 쉬고 있던 기사가 있으면 만차인 차가 최소 휴식을 기다리지 않고 떠납니다', () => {
  const demand = [0, 1].map(id => ({ id, arrival: 13, origin: 1, destination: 2 }));
  const run3 = drivers => simulate({ route, duration: 60, snapshotEvery: 1, departures: [0, 2], fleetSize: 2, capacity: 2,
    travelTime: () => 10, demand, hold: { stop: 1, rule: 'headwayFull', dwell: 2, headway: 20, minRest: 5, drivers } });
  // 기사 2명이면 차와 같습니다: 1번 차는 기사가 5초를 쉰 17초에 떠납니다.
  assert.deepEqual(run3(2).holds.map(h => h.departedAt), [12, 17]);
  // 기사 3명: 0초부터 쉰 기사 2가 12초에 0번 차를 몹니다. 10초에 내려 쉬던 기사 0이 5초를 채운 15초에
  // 만차인 1번 차를 몹니다(1번 차의 기사 1은 12초에 막 내렸으므로 아직 못 탑니다).
  const swap = run3(3);
  assert.deepEqual(swap.holds.map(h => h.departedAt), [12, 15]);
  assert.deepEqual(swap.driverRests.slice(0, 2).map(r => [r.driverId, r.from, r.to]), [[2, 0, 12], [0, 10, 15]]);
});

test('기점 탑승시간을 주면 시간표 없이 탑승시간 뒤 바로 다시 출발합니다', () => {
  const rider = { id: 'r', arrival: 32, origin: 0, destination: 1 };
  const result = simulate({ route, duration: 60, snapshotEvery: 1, departures: [0], fleetSize: 1, capacity: 2,
    travelTime: () => 10, demand: [rider], terminal: { dwell: 5 } });
  // 30초에 기점 도착 → 32초 승객 탑승 → 35초 출발 → 45초 B 도착
  assert.deepEqual([result.passengers[0].boardedAt, result.passengers[0].alightedAt], [32, 45]);
  assert.equal(result.summary.laps, 1);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.holds.length, 0);
});

test('휴식 미루기: 만차면 바로 떠나고, 다음 바퀴에는 만차여도 대기를 다 채웁니다', () => {
  // 두 바퀴 모두 B에 도착할 때 2명(정원)이 기다립니다.
  const demand = [0, 1, 2, 3].map(id => ({ id, arrival: id < 2 ? 0 : 35, origin: 1, destination: 2 }));
  const result = simulate({ route, duration: 80, snapshotEvery: 1, departures: [0, 30], fleetSize: 1, capacity: 2,
    travelTime: () => 10, demand, hold: { stop: 1, rule: 'defer', dwell: 2 } });
  assert.deepEqual(result.holds.map(h => [h.arrivedAt, h.departedAt, h.full]), [[10, 10, true], [40, 50, true]]);
  assert.equal(result.summary.holdSeconds, 10);
});

test('교대 운행: 운행 중인 차가 돌아와야 B에서 쉬던 맨 앞 차가 출발합니다', () => {
  // 2대가 0초·2초에 A를 떠나 10초·12초에 B 도착. 1대만 운행하므로 첫 차는 12초 전까지 운행 중 차가 있어 쉽니다.
  const run2 = (rule, demand = []) => simulate({ route, duration: 60, snapshotEvery: 1, departures: [0, 2],
    fleetSize: 2, capacity: 2, travelTime: () => 10, demand, terminal: { dwell: 0 },
    hold: { stop: 1, rule, dwell: 2, running: 1 } });
  const relayed = run2('relay');
  // 12초: 둘 다 B에서 쉼 → 0번 출발(운행 1대). 0번이 A를 돌아 B에 32초 도착 → 1번 출발.
  assert.deepEqual(relayed.holds.map(h => [h.vehicleId, h.arrivedAt, h.departedAt]).slice(0, 2), [[0, 10, 12], [1, 12, 32]]);
  // 1번 차가 13초에 만차가 되면 relayFull은 기다리지 않고 바로 떠납니다.
  const demand = [0, 1].map(id => ({ id, arrival: 13, origin: 1, destination: 2 }));
  assert.deepEqual(run2('relay', demand).holds.slice(0, 2).map(h => h.departedAt), [12, 32]);
  assert.deepEqual(run2('relayFull', demand).holds.slice(0, 2).map(h => h.departedAt), [12, 13]);
});

test('대기 정류장과 규칙이 잘못되면 알려 줍니다', () => {
  // 간격 규칙에 간격 값이 없으면 오류입니다.
  assert.throws(() => simulate({ route, duration: 60, departures: [0], travelTime: () => 10,
    demand: [], hold: { stop: 1, rule: 'headway', dwell: 2 } }), /규칙/);
  assert.throws(() => run('fast', { demand: [] }), /규칙/);
  assert.throws(() => simulate({ route, duration: 60, departures: [0], travelTime: () => 10, demand: [],
    hold: { stop: 2, rule: 'schedule', dwell: 2 } }), /규칙/);
});
