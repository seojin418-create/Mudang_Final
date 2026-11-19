import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFeed } from '../src/gtfs.js';
import { network, stopNodes } from '../src/network.js';
import { connectRoute } from '../src/routing.js';

const files = Object.fromEntries(['stops', 'routes', 'trips', 'stop_times', 'calendar', 'calendar_dates']
  .map(name => [name, readFileSync(new URL(`../gtfs/${name}.txt`, import.meta.url), 'utf8')]));

test('무당이 GTFS는 반도체대학에서 출발해 돌아오는 순환 노선입니다', () => {
  const route = readFeed(files);
  assert.deepEqual(route.visits.map(v => v.name),
    ['반도체대학', '교육대학원', '학생회관', 'AI공학관', '중앙도서관', '예체대', '글로벌센터', '반도체대학']);
  assert.equal(route.departures[1] - route.departures[0], 300);
});

test('모든 구간이 교내 도로로 연결됩니다', () => {
  const route = readFeed(files);
  const paths = connectRoute(route, network, stopNodes);
  assert.equal(paths.length, route.visits.length - 1);
  assert.ok(paths.every(p => p.meters > 0));
});
