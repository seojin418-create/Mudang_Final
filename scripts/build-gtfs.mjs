// data/의 정류장·운행 값으로 무당이 GTFS를 생성합니다. 값의 근거는 각 CSV의 source·note 열에 있습니다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { csv } from '../src/gtfs.js';
import { shortestPath } from '../src/routing.js';
import { attachStops, withStops } from '../src/snap.js';
import roads from '../src/campus-roads.json' with { type: 'json' };

const read = name => csv(readFileSync(new URL(`../data/${name}.csv`, import.meta.url), 'utf8'));
// use가 1인 정류장만 운행 정류장으로 씁니다. 0은 정차 여부를 확인 중인 후보입니다.
const stops = read('stops').filter(s => s.use === '1').sort((a, b) => Number(a.sequence) - Number(b.sequence));
const service = Object.fromEntries(read('service').map(r => [r.key, r.value]));

// 정류장 좌표를 도로 위 가장 가까운 지점에 붙이고, 그 지점에서 도로 링크를 나눕니다.
const attached = attachStops({ nodes: roads.nodes, edges: roads.edges },
  stops.map(s => ({ id: s.stop_id, x: Number(s.stop_lon), y: Number(s.stop_lat) })));
const network = withStops(roads, attached), stopNodes = attached.stopNodes;
const snapped = Object.fromEntries(Object.entries(attached.snapped).map(([id, p]) => [id, Math.round(p.meters * 10) / 10]));

// 순환: 마지막 정류장 다음에 기점으로 돌아옵니다.
const loop = [...stops, stops[0]];
const speed = Number(service.speed) / 3.6, dwell = Number(service.dwell), hold = Number(service.hold);
// data/segments.csv에 관측한 구간 시간이 있으면 도로 거리 ÷ 속도 대신 그 값을 씁니다.
// 관측값은 앞 정류장 도착부터 다음 정류장 도착까지(앞 정류장 정차 포함)이고, 대기 정류장에서는 출발부터 잰 값입니다.
// 정차시간을 뺀 주행시간이 최고 속도(max_speed)로 달린 시간보다 짧으면, 그 정류장에서는 정차를 그만큼 줄입니다.
const observed = Object.fromEntries(read('segments').map(r => [`${r.from}>${r.to}`, Number(r.observed)]));
const maxSpeed = Number(service.max_speed ?? 25) / 3.6;
const legs = loop.slice(1).map((s, i) => {
  const from = loop[i], path = shortestPath(network, stopNodes[from.stop_id], stopNodes[s.stop_id]);
  const meters = Math.round(path.meters), seen = observed[`${from.stop_id}>${s.stop_id}`];
  const stopDwell = i === 0 || from.stop_id === service.hold_stop ? 0 : dwell;
  if (seen === undefined) return { from: from.stop_name, to: s.stop_name, meters, seconds: Math.round(meters / speed), dwell: stopDwell, source: '거리÷속도' };
  const seconds = Math.max(Math.round(meters / maxSpeed), seen - stopDwell);
  return { from: from.stop_name, to: s.stop_name, meters, seconds, dwell: Math.max(0, seen - seconds), source: '관측' };
});

const seconds = text => { const [h, m] = text.split(':').map(Number); return h * 3600 + m * 60; };
const clock = t => [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(v => String(v).padStart(2, '0')).join(':');
const directory = new URL('../gtfs/', import.meta.url);
mkdirSync(directory, { recursive: true });
function write(name, header, rows) {
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const text = [header, ...rows].map(row => row.map(quote).join(',')).join('\n') + '\n';
  writeFileSync(new URL(`${name}.txt`, directory), text);
}

write('agency', ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'],
  [['GACHON', '가천대학교', 'https://www.gachon.ac.kr', 'Asia/Seoul']]);
write('stops', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
  stops.map(s => [s.stop_id, s.stop_name, s.stop_lat, s.stop_lon]));
write('routes', ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
  [['MUDANG', 'GACHON', '무당이', loop.map(s => s.stop_name).join('–'), 3]]);
write('calendar', ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'start_date', 'end_date'],
  [['WEEKDAY', 1, 1, 1, 1, 1, 0, 0, service.service_start_date, service.service_end_date]]);
write('calendar_dates', ['service_id', 'date', 'exception_type'], []);

const trips = [], times = [];
const first = seconds(service.first_departure), last = seconds(service.last_departure);
for (let start = first, n = 1; start <= last; start += Number(service.headway), n++) {
  const id = `MUDANG_${String(n).padStart(3, '0')}`;
  trips.push(['MUDANG', 'WEEKDAY', id]);
  let t = start;
  loop.forEach((s, i) => {
    const arrival = t, isEnd = i === 0 || i === loop.length - 1;
    // 시간표를 맞추려고 기다리는 정류장(hold_stop)은 정차시간 대신 대기시간을 씁니다.
    const departure = isEnd ? arrival : arrival + (s.stop_id === service.hold_stop ? hold : legs[i].dwell);
    // 기점 출발에서는 내리지 않고, 기점 도착에서는 타지 않습니다.
    times.push([id, clock(arrival), clock(departure), s.stop_id, i + 1,
      i === loop.length - 1 ? 1 : 0, i === 0 ? 1 : 0]);
    if (i < legs.length) t = departure + legs[i].seconds;
  });
}
write('trips', ['route_id', 'service_id', 'trip_id'], trips);
write('stop_times', ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence',
  'pickup_type', 'drop_off_type'], times);
// 시뮬레이터가 같은 정차점을 쓰도록 정차 노드와 나눈 링크를 함께 저장합니다.
writeFileSync(new URL('../src/stop-nodes.json', import.meta.url),
  JSON.stringify({ stopNodes, nodes: attached.nodes, edges: attached.edges }, null, 2) + '\n');

const cycle = legs.reduce((sum, l) => sum + l.seconds + l.dwell, 0) + hold;
console.log('정류장–도로 거리(m):', snapped);
console.table(legs);
console.log(`운행편 ${trips.length}개, 한 바퀴 ${(cycle / 60).toFixed(1)}분`);
const capacity = Number(service.fleet) * Number(service.headway);
if (cycle > capacity) {
  console.log(`주의: 한 바퀴가 차량 ${service.fleet}대 × 배차 ${service.headway / 60}분 = ${capacity / 60}분보다 깁니다. 시간표대로 출발할 수 없습니다.`);
}
