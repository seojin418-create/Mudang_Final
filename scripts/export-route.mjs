// 보고서 그림용으로 교내 도로, 정류장, 정류장 사이 최단 경로 좌표를 results/route-geometry.json에 저장합니다.
// 사용: node scripts/export-route.mjs  (그다음 python scripts/figures.py)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { csv } from '../src/gtfs.js';
import { shortestPath } from '../src/routing.js';
import { attachStops, withStops } from '../src/snap.js';
import roads from '../src/campus-roads.json' with { type: 'json' };

const read = name => csv(readFileSync(new URL(`../data/${name}.csv`, import.meta.url), 'utf8'));
const stops = read('stops').filter(s => s.use === '1').sort((a, b) => Number(a.sequence) - Number(b.sequence));
const attached = attachStops({ nodes: roads.nodes, edges: roads.edges },
  stops.map(s => ({ id: s.stop_id, x: Number(s.stop_lon), y: Number(s.stop_lat) })));
const network = withStops(roads, attached);
const loop = [...stops, stops[0]];
const legs = loop.slice(1).map((s, i) => {
  const path = shortestPath(network, attached.stopNodes[loop[i].stop_id], attached.stopNodes[s.stop_id]);
  return { from: loop[i].stop_name, to: s.stop_name, meters: Math.round(path.meters),
    coords: path.nodes.map(n => [network.nodes[n].x, network.nodes[n].y]) };
});
const seen = new Set(), roadLines = [];
for (const e of roads.edges) {
  const key = [e.from, e.to].sort().join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  roadLines.push([[roads.nodes[e.from].x, roads.nodes[e.from].y], [roads.nodes[e.to].x, roads.nodes[e.to].y]]);
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/route-geometry.json', import.meta.url), JSON.stringify({
  stops: stops.map(s => ({ id: s.stop_id, name: s.stop_name, x: Number(s.stop_lon), y: Number(s.stop_lat) })),
  legs, roads: roadLines }));
console.log(`구간 ${legs.length}개, 한 바퀴 ${legs.reduce((s, l) => s + l.meters, 0)}m, 도로 선 ${roadLines.length}개`);
