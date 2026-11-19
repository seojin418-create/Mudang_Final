import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
maplibregl.setWorkerUrl(workerUrl);
import buildings from './campus-buildings.json';
import { positionOnPath } from './routing.js';

export function createRouteMap(network, paths, visits, stopNodes, colors) {
  const coordinate = id => { const p = network.nodes[id]; return [p.x, p.y]; };
  const collection = features => ({ type: 'FeatureCollection', features });
  const line = coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
  const depot = stopNodes[visits[0].stopId];
  const map = new maplibregl.Map({ container: 'route-map', center: coordinate(depot), zoom: 16,
    style: { version: 8, sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
      buildings: { type: 'geojson', data: buildings },
      roads: { type: 'geojson', data: collection(network.edges.map(e => line([coordinate(e.from), coordinate(e.to)]))) },
      route: { type: 'geojson', data: collection(paths.map(p => line(p.nodes.map(coordinate)))) },
    }, layers: [
      // 다크 화면에 맞춰 배경 지도를 흑백으로 어둡게 바꿉니다.
      { id: 'background', type: 'background', paint: { 'background-color': '#14181b' } },
      { id: 'basemap', type: 'raster', source: 'osm', paint: { 'raster-saturation': -1, 'raster-brightness-min': 0.95, 'raster-brightness-max': 0.05, 'raster-contrast': 0.15, 'raster-opacity': 0.85 } },
      { id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-color': '#2a3137', 'fill-opacity': 0.6 } },
      { id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#3a434b', 'line-width': 4 } },
      { id: 'route-border', type: 'line', source: 'route', paint: { 'line-color': '#14181b', 'line-width': 8 } },
      { id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#6fb7a8', 'line-width': 4 } },
    ] } });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  const bounds = new maplibregl.LngLatBounds();
  paths.flatMap(p => p.nodes).forEach(id => bounds.extend(coordinate(id)));
  const fit = () => map.fitBounds(bounds, { padding: { top: 70, bottom: 60, left: 70, right: 70 }, duration: 0 });
  // 화면 배치가 끝난 뒤 크기가 정해지므로 불러온 다음에 한 번 더 맞춥니다.
  fit(); map.once('load', () => { map.resize(); fit(); });
  const queues = visits.slice(0, -1).map(v => {
    const element = document.createElement('div'); element.className = 'stop-marker';
    const name = document.createElement('strong'); name.textContent = v.name;
    const queue = document.createElement('span'); element.append(name, queue);
    new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, -12] }).setLngLat(coordinate(stopNodes[v.stopId])).addTo(map);
    return queue;
  });
  const buses = [];
  map.on('error', event => { console.warn(event.error); document.querySelector('#map-note').textContent = '지도를 불러오지 못했습니다. 저장된 도로 위에서 재생합니다.'; });
  return {
    update(snap) {
      queues.forEach((el, i) => { el.textContent = `대기 ${snap.queues[i]}명`; });
      while (buses.length > snap.vehicles.length) buses.pop().marker.remove();
      snap.vehicles.forEach((v, i) => {
        if (!buses[i]) {
          const element = document.createElement('div'); element.className = 'bus-marker'; element.style.background = colors[i % colors.length];
          buses.push({ element, marker: new maplibregl.Marker({ element }).setLngLat(coordinate(depot)).addTo(map) });
        }
        const bus = buses[i];
        bus.element.textContent = `${i + 1}호 · ${v.load}명`;
        bus.element.title = v.active ? '운행 중' : '출발 대기';
        bus.element.style.opacity = v.active ? '1' : '0.55';
        bus.marker.setLngLat(v.active ? positionOnPath(paths[v.from], network, v.progress) : coordinate(depot));
      });
    },
  };
}
