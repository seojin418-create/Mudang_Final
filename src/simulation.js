// 1초 단위: 승객 도착 → 차량 도착·하차·승차 → 가능한 차량 출발 → 기록.
// hold를 주면 그 정류장에서의 출발 규칙을 바꿉니다. { stop: 방문 순서 번호, rule, dwell }
//   schedule: 시간표 정차시간(route.visits[stop].dwell)만큼 기다리며 그동안 온 승객도 태움
//   full: schedule과 같되 만차가 되면 바로 출발
//   none: 시간표 대기 없이 dwell초만 정차하고 도착 때만 승차
//   headway: 앞차가 이 정류장을 떠난 지 hold.headway초가 지나야 출발(최소 dwell초 정차), 먼저 온 차부터
//   headwayFull: headway와 같되 만차가 되면 바로 출발
//   defer: schedule과 같되 만차가 되면 바로 출발하고, 대신 다음 바퀴에는 만차여도 대기(휴식)를 다 채움
//   relay: 교대 운행. 대기 정류장에 먼저 온 차부터 줄을 서서 쉬고, 운행 중인 차가 hold.running대보다
//          적을 때(앞차가 돌아오면) 맨 앞 차가 출발합니다(최소 dwell초 정차).
//   relayFull: relay와 같되 맨 앞 차가 만차가 되면 바로 출발
// hold.drivers를 주면 기사가 차와 따로 대기 정류장 휴게 공간에서 쉽니다(기사 교대). 기사 수는 차량 수 이상입니다.
//   차가 대기 정류장에 오면 기사는 내려 쉬고, 차가 떠날 때는 가장 오래 쉰 기사가 탑니다.
//   만차로 일찍 떠날 때는 hold.minRest초 이상 쉰 기사가 있어야 합니다. 시간표 출발은 지금과 같습니다.
// terminal을 주면 기점에 돌아온 차가 시간표를 기다리지 않고 { dwell }초 동안 태운 뒤 바로 다시 출발합니다.
//   이때 departures는 처음 차량을 내보내는 시각으로만 씁니다.
export function simulate({ route, demand, departures, fleetSize = 2, capacity = 20,
  duration = 3600, travelTime, snapshotEvery = 15, hold, terminal }) {
  const integer = (v, low, high) => Number.isInteger(v) && v >= low && v <= high;
  if (!integer(fleetSize, 1, 20) || !integer(capacity, 1, 200)
    || !integer(duration, 1, 86400) || !integer(snapshotEvery, 1, duration)) {
    throw new Error('차량 수·정원·실험 시간·기록 간격을 확인합니다.');
  }
  const end = route.visits.length - 1;
  if (end < 2 || route.visits[0].stopId !== route.visits[end].stopId) throw new Error('순환 노선이 필요합니다.');
  if (route.visits.some(v => !integer(v.dwell, 0, 3600))) throw new Error('정차시간은 0 이상의 정수 초입니다.');
  if (departures.some((t, i) => !integer(t, 0, duration - 1) || (i && t < departures[i - 1]))) {
    throw new Error('출발 시각은 실험 구간 안에서 오름차순이어야 합니다.');
  }
  const ids = new Set();
  const passengers = demand.map(p => {
    if (ids.has(p.id) || !integer(p.arrival, 0, duration - 1)
      || !integer(p.origin, 0, end - 1) || !integer(p.destination, p.origin + 1, end)
      || !route.visits[p.origin].pickup || !route.visits[p.destination].dropoff) {
      throw new Error('수요의 ID·시각·승하차 순서를 확인합니다.');
    }
    ids.add(p.id);
    return { ...p, boardedAt: null, alightedAt: null, vehicleId: null };
  }).sort((a, b) => a.arrival - b.arrival || String(a.id).localeCompare(String(b.id)));
  const queues = route.visits.map(() => []), snapshots = [], events = [], dispatches = [];
  const spaced = ['headway', 'headwayFull'].includes(hold?.rule);
  const relay = ['relay', 'relayFull'].includes(hold?.rule);
  const fullFirst = ['full', 'headwayFull', 'relayFull'].includes(hold?.rule);
  if (hold && (!integer(hold.stop, 1, end - 1)
    || !['schedule', 'full', 'none', 'headway', 'headwayFull', 'defer', 'relay', 'relayFull'].includes(hold.rule)
    || (spaced && !integer(hold.headway, 1, 3600)) || (relay && !integer(hold.running, 1, fleetSize)))) {
    throw new Error('대기 정류장과 출발 규칙을 확인합니다.');
  }
  // hold.minRest: 만차로 일찍 출발할 때는 대기 정류장 도착 후 이 시간(초)을 쉰 뒤에만 출발합니다(기사 최소 휴식).
  //   시간표·간격에 따른 출발은 지금과 같습니다.
  const minRest = hold?.minRest ?? 0;
  if (hold && !integer(minRest, 0, 3600)) throw new Error('최소 휴식은 0 이상의 정수 초입니다.');
  if (terminal && !integer(terminal.dwell, 0, 3600)) throw new Error('기점 탑승시간은 0 이상의 정수 초입니다.');
  if (hold?.drivers !== undefined && !integer(hold.drivers, fleetSize, 40)) throw new Error('기사 수는 차량 수 이상입니다.');
  const vehicles = Array.from({ length: fleetSize }, (_, id) => ({ id, onboard: [], driver: id,
    active: false, from: 0, to: 0, departAt: 0, arriveAt: Infinity, holding: null, deferred: false }));
  // 휴게 공간에서 쉬는 기사: 차량보다 많은 기사는 처음부터 쉬고 있습니다.
  const pool = hold?.drivers === undefined ? null
    : Array.from({ length: hold.drivers - fleetSize }, (_, k) => ({ id: fleetSize + k, since: 0 }));
  const driverRests = [];
  // 만차로 대기를 끝내고 떠날 수 있는지: defer는 지난 바퀴에 대기를 미루지 않았을 때만 됩니다.
  const leaveWhenFull = vehicle => fullFirst || (hold?.rule === 'defer' && !vehicle.deferred);
  const holds = [];
  let incoming = 0, nextTrip = 0, completed = 0, boarded = 0, heldPassengerSeconds = 0;
  let lastRelease = -Infinity;

  function depart(vehicle, stop, time) {
    vehicle.departAt = time;
    const travel = travelTime(stop, time);
    if (!integer(travel, 1, 86400)) throw new Error('ETA는 양의 정수 초를 반환해야 합니다.');
    vehicle.arriveAt = time + travel;
  }

  function visit(vehicle, stop, time) {
    const gettingOff = vehicle.onboard.filter(p => p.destination === stop);
    for (const p of gettingOff) { p.alightedAt = time; completed++; }
    vehicle.onboard = vehicle.onboard.filter(p => p.destination !== stop);
    let gettingOn = 0;
    // 종료 시점에는 새 승차 없이 하차만 반영합니다.
    if (time < duration && stop < end && route.visits[stop].pickup) {
      while (queues[stop].length && vehicle.onboard.length < capacity) {
        const p = queues[stop].shift();
        p.boardedAt = time; p.vehicleId = vehicle.id;
        vehicle.onboard.push(p); gettingOn++; boarded++;
      }
    }
    events.push({ time, vehicleId: vehicle.id, stop, board: gettingOn,
      alight: gettingOff.length, onboard: vehicle.onboard.length, waiting: queues[stop].length });
    vehicle.from = stop;
    if (stop === end && terminal && time < duration) {
      // 기점에 서서 탑승시간 동안 태운 뒤 인원과 관계없이 출발합니다.
      vehicle.from = 0; vehicle.to = 1;
      vehicle.holding = { stop: 0, arrivedAt: time, until: time + terminal.dwell, terminal: true };
      vehicle.departAt = vehicle.holding.until; vehicle.arriveAt = Infinity;
      board(vehicle, 0, time);
      return;
    }
    if (stop === end) {
      vehicle.active = false; vehicle.from = 0; vehicle.to = 0; vehicle.arriveAt = Infinity;
      return;
    }
    vehicle.to = stop + 1;
    if (hold && stop === hold.stop) {
      if (hold.rule === 'none') { depart(vehicle, stop, time + hold.dwell); return; }
      // 대기 중에는 출발을 정하지 않고 매초 승차를 이어 갑니다.
      // 간격 규칙은 출발 시각이 앞차에 따라 정해지므로 미리 정하지 않습니다.
      vehicle.holding = { stop, arrivedAt: time, until: spaced || relay ? Infinity : time + route.visits[stop].dwell };
      vehicle.departAt = vehicle.holding.until; vehicle.arriveAt = Infinity;
      if (pool) { pool.push({ id: vehicle.driver, since: time }); vehicle.driver = null; }
      if (!minRest && !pool && leaveWhenFull(vehicle) && vehicle.onboard.length === capacity) release(vehicle, time);
      return;
    }
    depart(vehicle, stop, time + (stop === 0 ? 0 : route.visits[stop].dwell));
  }

  function release(vehicle, time) {
    const h = vehicle.holding;
    vehicle.holding = null;
    // 기점 탑승은 대기 정류장 기록과 앞차 간격에 넣지 않습니다.
    if (!h.terminal) {
      holds.push({ vehicleId: vehicle.id, arrivedAt: h.arrivedAt, departedAt: time,
        onboard: vehicle.onboard.length, full: vehicle.onboard.length === capacity });
      lastRelease = time;
      // 대기를 다 채우지 못하고 떠났으면 다음 바퀴에 채웁니다.
      vehicle.deferred = hold.rule === 'defer' && time < h.until;
      // 기사 교대: 가장 오래 쉰 기사가 탑니다.
      if (pool) {
        pool.sort((a, b) => a.since - b.since || a.id - b.id);
        const d = pool.shift();
        driverRests.push({ driverId: d.id, from: d.since, to: time });
        vehicle.driver = d.id;
      }
    }
    depart(vehicle, h.stop, time);
  }

  function board(vehicle, stop, time) {
    while (time < duration && queues[stop].length && vehicle.onboard.length < capacity) {
      const p = queues[stop].shift();
      p.boardedAt = time; p.vehicleId = vehicle.id;
      vehicle.onboard.push(p); boarded++;
    }
  }

  for (let time = 0; time <= duration; time++) {
    while (incoming < passengers.length && passengers[incoming].arrival <= time) {
      const passenger = passengers[incoming++]; queues[passenger.origin].push(passenger);
    }
    for (const vehicle of vehicles) {
      if (vehicle.active && vehicle.arriveAt === time) visit(vehicle, vehicle.to, time);
    }
    // 대기 정류장에 선 차량: 먼저 온 차부터 새 승객을 태우고, 규칙에 맞으면 출발합니다.
    const held = vehicles.filter(v => v.holding)
      .sort((a, b) => a.holding.arrivedAt - b.holding.arrivedAt || a.id - b.id);
    for (const vehicle of held) {
      board(vehicle, vehicle.holding.stop, time);
      if (vehicle.holding.terminal) {
        if (time >= vehicle.holding.until) release(vehicle, time);
        continue;
      }
      const full = vehicle.onboard.length === capacity;
      // 간격 규칙: 맨 앞 차만, 최소 정차를 마치고 앞차 출발 후 간격이 지났을 때 출발합니다.
      const front = vehicle === held.find(v => v.holding && !v.holding.terminal);
      const rested = time >= vehicle.holding.arrivedAt + hold.dwell;
      // 교대 운행: 대기 정류장에서 쉬는 차를 빼면 운행 중인 차입니다(기점 탑승 중인 차 포함).
      const running = () => vehicles.filter(v => v.active && !(v.holding && !v.holding.terminal)).length;
      const due = spaced ? front && rested && time >= lastRelease + hold.headway
        : relay ? front && rested && running() < hold.running
        : time >= vehicle.holding.until;
      const restDone = pool ? pool.some(d => time - d.since >= minRest) : time >= vehicle.holding.arrivedAt + minRest;
      if (due || (restDone && leaveWhenFull(vehicle) && full)) release(vehicle, time);
      else heldPassengerSeconds += vehicle.onboard.length;
    }
    // 아직 돌아오지 않은 차량은 새 운행편에 중복 투입하지 않습니다.
    while (time < duration && nextTrip < departures.length && departures[nextTrip] <= time) {
      const vehicle = vehicles.find(v => !v.active);
      if (!vehicle) break;
      dispatches.push({ planned: departures[nextTrip], actual: time, vehicleId: vehicle.id });
      nextTrip++; vehicle.active = true; visit(vehicle, 0, time);
    }
    if (time % snapshotEvery === 0 || time === duration) {
      snapshots.push({ time, arrived: incoming, boarded, completed,
        queues: queues.map(q => q.length),
        vehicles: vehicles.map(v => ({ id: v.id, active: v.active, from: v.from,
          to: v.to, load: v.onboard.length, progress: !v.active || time <= v.departAt ? 0
            : Math.min(1, (time - v.departAt) / (v.arriveAt - v.departAt)) })) });
    }
  }
  // 끝날 때까지 쉬던 기사의 휴식도 기록합니다.
  for (const d of pool ?? []) driverRests.push({ driverId: d.id, from: d.since, to: duration });
  const waits = passengers.filter(p => p.boardedAt !== null)
    .map(p => p.boardedAt - p.arrival).sort((a, b) => a - b);
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const waiting = queues.reduce((n, q) => n + q.length, 0);
  const done = passengers.filter(p => p.alightedAt !== null);
  return { passengers, snapshots, events, dispatches, holds, driverRests, summary: {
    meanInVehicle: mean(done.map(p => p.alightedAt - p.boardedAt)),
    meanTravel: mean(done.map(p => p.alightedAt - p.arrival)),
    heldPassengerSeconds, fullHolds: holds.filter(h => h.full).length,
    laps: events.filter(e => e.stop === end).length,
    holdSeconds: holds.reduce((s, h) => s + h.departedAt - h.arrivedAt, 0),
    total: passengers.length, boarded, completed, waiting, onboard: boarded - completed,
    meanWait: mean(waits), p90Wait: waits.length ? waits[Math.ceil(waits.length * 0.9) - 1] : null,
    waitingElapsed: mean(passengers.filter(p => p.boardedAt === null).map(p => duration - p.arrival)),
    meanDepartureDelay: mean(dispatches.map(d => d.actual - d.planned)),
    plannedTrips: departures.length, dispatchedTrips: dispatches.length,
    unstartedTrips: departures.length - dispatches.length,
  } };
}
