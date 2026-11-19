// 시뮬레이션 결과 하나에서 보고서·대시보드가 쓰는 학생·기사 지표를 계산합니다.
// scripts/summary.mjs와 대시보드가 같은 함수를 써서 숫자가 항상 같습니다.
// fleet: 차량 수, drivers: 기사 수(기사 교대일 때만), duration: 분석 시간(초), holdStop: 대기 정류장 방문 번호
export function measure(r, { fleet, drivers, duration, holdStop }) {
  const s = r.summary, n = drivers ?? fleet, hours = duration / 3600;
  const waitAt = stop => {
    const p = r.passengers.filter(x => x.origin === stop && x.boardedAt != null);
    return p.length ? p.reduce((t, x) => t + x.boardedAt - x.arrival, 0) / p.length / 60 : 0;
  };
  // 대기 정류장 학생은 쉬는 차에 탄 뒤에도 출발을 기다리므로 도착부터 출발까지를 따로 봅니다.
  const ai = r.passengers.filter(x => x.origin === holdStop && x.boardedAt != null);
  const aiDepart = ai.length ? ai.reduce((t, x) => {
    const h = r.holds.find(h => h.vehicleId === x.vehicleId && h.arrivedAt <= x.boardedAt && h.departedAt >= x.boardedAt);
    return t + ((h ? h.departedAt : x.boardedAt) - x.arrival);
  }, 0) / ai.length / 60 : 0;
  // 휴식: 기사 교대면 기사가 휴게 공간에 있던 시간, 아니면 차가 대기 정류장에 서 있던 시간
  const rests = drivers ? r.driverRests.map(x => ({ id: x.driverId, a: x.from, b: x.to }))
    : r.holds.map(h => ({ id: h.vehicleId, a: h.arrivedAt, b: h.departedAt }));
  let longest = 0;
  for (let d = 0; d < n; d++) {
    let last = 0;
    for (const x of rests.filter(x => x.id === d && x.b - x.a >= 300).sort((p, q) => p.a - q.a)) {
      longest = Math.max(longest, x.a - last); last = x.b;
    }
    longest = Math.max(longest, duration - last);
  }
  return {
    meanWait: (s.meanWait ?? 0) / 60, p90Wait: (s.p90Wait ?? 0) / 60, meanTravel: (s.meanTravel ?? 0) / 60,
    semiWait: waitAt(0), aiDepart, left: s.waiting,
    restPerHour: rests.reduce((t, x) => t + x.b - x.a, 0) / n / hours / 60,
    restOver5: rests.length ? rests.filter(x => x.b - x.a >= 300).length / rests.length * 100 : 0,
    longestDrive: longest / 60, drivers: n,
  };
}

// 여러 결과의 평균
export function average(list) {
  return Object.fromEntries(Object.keys(list[0]).map(k => [k, list.reduce((t, x) => t + x[k], 0) / list.length]));
}
