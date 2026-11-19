import roads from './campus-roads.json' with { type: 'json' };
import mudang from './stop-nodes.json' with { type: 'json' };
// x=경도, y=위도. OSM way의 모든 형상 노드를 유지해 도로 굴곡을 따라 이동합니다.
// scripts/build-gtfs.mjs가 정류장 위치에서 도로 링크를 나눈 정차 노드와 링크를 더합니다.
export const network = { nodes: { ...roads.nodes, ...mudang.nodes }, edges: [...roads.edges, ...mudang.edges] };
// S0·S1은 교수님 예제 정차점, ST로 시작하는 정류장은 data/stops.csv의 정류장입니다.
export const stopNodes = { ...roads.stopNodes, ...mudang.stopNodes };
