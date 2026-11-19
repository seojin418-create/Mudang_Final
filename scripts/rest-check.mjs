// 규칙별로 기사 휴식(AI공학관에 서 있던 시간)이 시간대마다 얼마나 보장되는지 봅니다.
// 사용: node scripts/rest-check.mjs
import { queueCheck } from './check-queue.mjs';

const cases = [['headway', 1, '현황: 5분 시간표', 0], ['headwayFull', 1, '만차면 바로 출발(최소 휴식 없음)', 0], ['headwayFull', 1, '제안: 만차면 출발 + 최소 휴식 5분', 300]];
const fleet = 4;
for (const [rule, running, name, minRest] of cases) {
  const rows = queueCheck(rule, 100, null, running, minRest), r = rows.result;
  const breaks = r.holds.map(h => ({ ...h, length: h.departedAt - h.arrivedAt }));
  const long = breaks.filter(b => b.length >= 300).length;
  // 시간대별 대당 휴식(분): 휴식 구간을 시간 경계로 잘라 더합니다.
  const hours = Array.from({ length: 8 }, (_, h) => {
    const a = h * 3600, b = a + 3600;
    const total = breaks.reduce((s, x) => s + Math.max(0, Math.min(b, x.departedAt) - Math.max(a, x.arrivedAt)), 0);
    return (total / fleet / 60).toFixed(0).padStart(3);
  });
  // 한 대가 쉬지 않고 계속 운행한 가장 긴 시간(분)
  let longestDrive = 0;
  for (let v = 0; v < fleet; v++) {
    const mine = breaks.filter(b => b.vehicleId === v && b.length >= 300).sort((x, y) => x.arrivedAt - y.arrivedAt);
    let last = 0;
    for (const b of mine) { longestDrive = Math.max(longestDrive, b.arrivedAt - last); last = b.departedAt; }
  }
  console.log(`${name}\n  평균 대기 ${(r.summary.meanWait / 60).toFixed(1)}분 · 휴식 ${breaks.length}회 중 5분 이상 ${long}회`
    + ` · 5분 이상 쉬지 못하고 가장 오래 운행한 시간 ${(longestDrive / 60).toFixed(0)}분`);
  console.log(`  시간대별 대당 휴식(분)  분석 시작부터 1시간씩: ${hours.join(' ')}\n`);
}
