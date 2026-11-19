import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './stop-editor.css';
import stopsTable from '../data/stops.csv?raw';
import serviceTable from '../data/service.csv?raw';
import buildings from './campus-buildings.json';
import roads from './campus-roads.json';
import { csv } from './gtfs.js';
import { shortestPath } from './routing.js';
import { attachStops, nearestRoadPoint, withStops } from './snap.js';
maplibregl.setWorkerUrl(workerUrl);

// 정류장 핀은 놓는 순간 도로 위 가장 가까운 지점으로 옮겨집니다. 정차 노드는 저장된 값이 아니라 원래 도로망에서 다시 계산합니다.
const roadNetwork = { nodes: roads.nodes, edges: roads.edges };
const columns = ['sequence', 'stop_id', 'stop_name', 'use', 'stop_lat', 'stop_lon', 'source', 'note'];
const sources = ['확인', '관측', '가정'];
const service = Object.fromEntries(csv(serviceTable).map(r => [r.key, r.value]));
const stops = csv(stopsTable).sort((a, b) => Number(a.sequence) - Number(b.sequence));
const original = JSON.stringify(stops);
const $ = selector => document.querySelector(selector);
const collection = features => ({ type: 'FeatureCollection', features });
const line = coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

$('#app').innerHTML = `
<header><h1>무당이 정류장 편집</h1><a href="/">시뮬레이션으로 돌아가기</a></header>
<div class="layout">
  <div id="map" aria-label="정류장 위치 편집 지도"></div>
  <aside>
    <h2>정류장</h2>
    <p class="help">핀을 끌어 놓으면 가장 가까운 도로 위 지점에 붙습니다. 정차를 끄면 노선에서 빠지고 회색 핀으로 남습니다. 행을 누르면 그 정류장으로 이동합니다.</p>
    <table><thead><tr><th>#</th><th>정류장</th><th>정차</th><th>구분</th><th>메모</th></tr></thead><tbody id="stops"></tbody></table>
    <h2>구간</h2>
    <p class="help">속도 ${service.speed}km/h, 중간 정류장 정차 ${service.dwell}초로 계산합니다(data/service.csv).</p>
    <table><thead><tr><th>구간</th><th class="num">거리</th><th class="num">시간</th></tr></thead><tbody id="legs"></tbody></table>
    <p class="summary" id="summary"></p>
    <div class="actions">
      <button class="primary" id="save" type="button">저장하고 GTFS 다시 만들기</button>
      <button id="download" type="button">CSV 내려받기</button>
      <button id="reset" type="button">되돌리기</button>
    </div>
    <p id="status" role="status"></p>
  </aside>
</div>`;

const map = new maplibregl.Map({ container: 'map', zoom: 16.3,
  center: [Number(stops[0].stop_lon), Number(stops[0].stop_lat)],
  style: { version: 8, sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
    buildings: { type: 'geojson', data: buildings },
    roads: { type: 'geojson', data: collection(roadNetwork.edges.map(e =>
      line([[roads.nodes[e.from].x, roads.nodes[e.from].y], [roads.nodes[e.to].x, roads.nodes[e.to].y]]))) },
    route: { type: 'geojson', data: collection([]) },
  }, layers: [
    { id: 'basemap', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.75 } },
    { id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-color': '#bbc6bf', 'fill-opacity': 0.5 } },
    { id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#fff', 'line-width': 4 } },
    { id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#187e79', 'line-width': 5, 'line-opacity': 0.8 } },
  ] } });
map.addControl(new maplibregl.NavigationControl(), 'top-right');

const pins = stops.map((s, i) => {
  const element = document.createElement('div'); element.className = 'stop-pin';
  element.textContent = `${i + 1} ${s.stop_name}`;
  const marker = new maplibregl.Marker({ element, draggable: true, anchor: 'bottom' })
    .setLngLat([Number(s.stop_lon), Number(s.stop_lat)]).addTo(map);
  marker.on('dragend', () => {
    const p = nearestRoadPoint(roadNetwork, { x: marker.getLngLat().lng, y: marker.getLngLat().lat });
    s.stop_lat = p.y.toFixed(7); s.stop_lon = p.x.toFixed(7);
    marker.setLngLat([p.x, p.y]);
    refresh();
  });
  return { element, marker };
});

function refresh() {
  stops.forEach((s, i) => pins[i].element.classList.toggle('off', s.use !== '1'));
  $('#stops').innerHTML = stops.map((s, i) => `<tr class="stop-row${s.use === '1' ? '' : ' off'}" data-i="${i}"><td>${i + 1}</td><td>${escape(s.stop_name)}</td>
    <td><input type="checkbox" data-field="use" data-i="${i}"${s.use === '1' ? ' checked' : ''} aria-label="${escape(s.stop_name)} 정차"></td>
    <td><select data-field="source" data-i="${i}">${sources.map(o => `<option${o === s.source ? ' selected' : ''}>${o}</option>`).join('')}</select></td>
    <td><input type="text" data-field="note" data-i="${i}" value="${escape(s.note)}"></td></tr>`).join('');
  routes(stops.filter(s => s.use === '1'));
}

function routes(active) {
  const speed = Number(service.speed) / 3.6, dwell = Number(service.dwell);
  const attached = attachStops(roadNetwork, active.map(s => ({ id: s.stop_id, x: Number(s.stop_lon), y: Number(s.stop_lat) })));
  const network = withStops(roadNetwork, attached), point = id => [network.nodes[id].x, network.nodes[id].y];
  const legs = active.map((s, i) => {
    const next = active[(i + 1) % active.length], label = `${s.stop_name} → ${next.stop_name}`;
    try {
      const path = shortestPath(network, attached.stopNodes[s.stop_id], attached.stopNodes[next.stop_id]);
      return { label, path, seconds: Math.round(path.meters / speed) };
    } catch (error) { return { label, error: error.message }; }
  });
  map.getSource('route')?.setData(collection(legs.filter(l => l.path).map(l => line(l.path.nodes.map(point)))));
  const time = t => `${Math.floor(t / 60)}분 ${String(t % 60).padStart(2, '0')}초`;
  $('#legs').innerHTML = legs.map(l => l.error
    ? `<tr><td>${escape(l.label)}</td><td class="far" colspan="2">경로 없음</td></tr>`
    : `<tr><td>${escape(l.label)}</td><td class="num">${Math.round(l.path.meters)}m</td><td class="num">${time(l.seconds)}</td></tr>`).join('');
  if (legs.some(l => l.error)) { $('#summary').textContent = '도로로 이어지지 않는 구간이 있습니다. 일방통행 방향을 확인하고 핀을 옮겨 보세요.'; return; }
  const cycle = legs.reduce((sum, l) => sum + l.seconds, 0) + dwell * (active.length - 1);
  const limit = Number(service.fleet) * Number(service.headway);
  $('#summary').textContent = `정차 ${active.length}곳 · 한 바퀴 ${time(cycle)} · 차량 ${service.fleet}대 × 배차 ${service.headway / 60}분 = ${limit / 60}분`
    + (cycle > limit ? ' → 시간표를 지킬 수 없습니다' : ` → 차마다 한 바퀴에 약 ${((limit - cycle) / 60).toFixed(1)}분 여유`);
}

$('#stops').addEventListener('input', event => {
  const { field, i } = event.target.dataset;
  if (!field) return;
  stops[Number(i)][field] = field === 'use' ? (event.target.checked ? '1' : '0') : event.target.value;
  if (field === 'use') refresh();
});
$('#stops').addEventListener('click', event => {
  const row = event.target.closest('tr.stop-row');
  if (row && !event.target.matches('select, input')) map.flyTo({ center: pins[Number(row.dataset.i)].marker.getLngLat(), zoom: 18 });
});

function toCsv() {
  const quote = value => /[",\n]/.test(String(value)) ? '"' + String(value).replaceAll('"', '""') + '"' : String(value);
  return [columns, ...stops.map(s => columns.map(c => s[c]))].map(row => row.map(quote).join(',')).join('\n') + '\n';
}
$('#save').addEventListener('click', async () => {
  $('#save').disabled = true; $('#status').textContent = '저장 중입니다.';
  try {
    const response = await fetch('/api/stops', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: toCsv() });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    const message = `${new Date().toLocaleTimeString()} data/stops.csv를 저장하고 GTFS를 다시 만들었습니다.\n${text.trim().split('\n').at(-1)}`;
    $('#status').textContent = message;
    // 저장한 파일을 개발 서버가 다시 읽으며 페이지가 새로고침되므로 메시지를 잠시 보관합니다.
    try { sessionStorage.setItem('stop-editor-saved', message); } catch {}
  } catch (error) {
    $('#status').textContent = `저장하지 못했습니다. 개발 서버(npm run dev)에서 열었는지 확인하거나 CSV 내려받기를 쓰세요.\n${error.message}`;
  } finally { $('#save').disabled = false; }
});
$('#download').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿' + toCsv()], { type: 'text/csv' }));
  link.download = 'stops.csv'; link.click(); URL.revokeObjectURL(link.href);
});
$('#reset').addEventListener('click', () => {
  JSON.parse(original).forEach((s, i) => { Object.assign(stops[i], s); pins[i].marker.setLngLat([Number(s.stop_lon), Number(s.stop_lat)]); });
  refresh(); $('#status').textContent = '처음 불러온 위치로 되돌렸습니다. 아직 저장하지 않았습니다.';
});

map.on('load', refresh);
try {
  const saved = sessionStorage.getItem('stop-editor-saved');
  if (saved) { $('#status').textContent = saved; sessionStorage.removeItem('stop-editor-saved'); }
} catch {}
