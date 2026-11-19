// 학생은 이 두 함수를 관측 자료로 만든 모형으로 교체합니다.
export function exampleDemand(route, duration, count = 180, seed = 42) {
  if (!Number.isInteger(count) || count < 0 || count > 10000) throw new Error('수요는 0~10000명입니다.');
  let state = seed >>> 0;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
  const origins = route.visits.flatMap((v, i) => v.pickup && i < route.visits.length - 1 ? [i] : []);
  if (!origins.length && count) throw new Error('승차 가능한 정류장이 없습니다.');
  return Array.from({ length: count }, (_, id) => {
    const origin = random() < 0.6 ? origins[0] : origins[Math.floor(random() * origins.length)];
    const destinations = route.visits.flatMap((v, i) => i > origin && v.dropoff && v.stopId !== route.visits[origin].stopId ? [i] : []);
    if (!destinations.length) throw new Error('하차 가능한 목적지가 없습니다.');
    return { id, arrival: Math.floor(random() * duration), origin,
      destination: destinations[Math.floor(random() * destinations.length)] };
  }).sort((a, b) => a.arrival - b.arrival || a.id - b.id);
}

// 시간대별 수요 표(data/demand.csv)와 목적지 비율 표(data/destinations.csv)로 승객을 만듭니다.
// windows: [{ origin(stop_id), start, end(초, 분석 시작 기준), people(그 시간대 인원), repeat(매시 반복) }]
// shares: [{ origin, destination(stop_id), share }] — 출발 정류장별로 비율을 나눕니다.
// scale로 모든 인원을 같은 비율로 늘리거나 줄입니다. 도착 시각은 시간대 안에서 고르게 무작위입니다.
export function windowDemand(route, windows, shares, duration, { scale = 1, seed = 7, prefix = 'W' } = {}) {
  if (!Number.isFinite(scale) || scale < 0) throw new Error('수요 배율은 0 이상입니다.');
  let state = seed >>> 0;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
  const end = route.visits.length - 1, demand = [];
  const visit = (stopId, after) => route.visits.findIndex((v, i) => i > after && i <= end && v.stopId === stopId
    && (after < 0 ? v.pickup && i < end : v.dropoff));
  for (const w of windows) {
    const origin = visit(w.origin, -1);
    const targets = shares.filter(s => s.origin === w.origin)
      .map(s => ({ destination: visit(s.destination, origin), share: Number(s.share), id: s.destination }));
    const total = targets.reduce((sum, t) => sum + t.share, 0);
    if (origin < 0 || !total || targets.some(t => t.destination < 0)) {
      throw new Error(`${w.origin}의 수요·목적지 비율이 노선과 맞지 않습니다.`);
    }
    // 매시 반복이면 같은 분 구간을 분석 시간의 모든 시에 놓습니다.
    // repeatStart·repeatEnd(초)를 주면 그 시간 안에서만 반복합니다.
    const shifts = w.repeat ? Array.from({ length: 49 }, (_, k) => (k - 24) * 3600) : [0];
    const lower = Math.max(0, w.repeatStart ?? 0), upper = Math.min(duration, w.repeatEnd ?? duration);
    for (const shift of shifts) {
      const from = Math.max(lower, w.start + shift), to = Math.min(upper, w.end + shift);
      if (to <= from) continue;
      const count = Math.round(w.people * scale * (to - from) / (w.end - w.start));
      for (let k = 0; k < count; k++) {
        let pick = random() * total, target = targets[0];
        for (const t of targets) { target = t; if ((pick -= t.share) < 0) break; }
        demand.push({ id: `${prefix}${demand.length}`, arrival: from + Math.floor(random() * (to - from)),
          origin, destination: target.destination });
      }
    }
  }
  return demand.sort((a, b) => a.arrival - b.arrival);
}

// CSV 글을 읽어 windowDemand의 입력으로 바꿉니다. 시각은 분석 시작(start초) 기준으로 바꿉니다.
export function readDemandTables(demandText, sharesText, start, csv) {
  const toSeconds = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60 - start; };
  // repeat_start·repeat_end 열(선택)이 있으면 매시 반복을 그 시간 안으로 한정합니다.
  const windows = csv(demandText).map(w => ({ ...w, start: toSeconds(w.start), end: toSeconds(w.end),
    people: Number(w.people), repeat: w.repeat === '매시',
    repeatStart: w.repeat_start ? toSeconds(w.repeat_start) : undefined,
    repeatEnd: w.repeat_end ? toSeconds(w.repeat_end) : undefined }));
  return { windows, shares: csv(sharesText) };
}

export function timetableETA(route, legIndex, departureSecond, scale = 1) {
  // departureSecond를 받으므로 시간대별 ETA로 교체할 수 있습니다.
  return Math.round(route.travelSeconds[legIndex] * scale);
}

export function headwayDepartures(duration, headwaySeconds) {
  if (!Number.isFinite(headwaySeconds) || headwaySeconds <= 0) throw new Error('배차간격은 양수입니다.');
  return Array.from({ length: Math.ceil(duration / headwaySeconds) }, (_, i) => i * headwaySeconds);
}
