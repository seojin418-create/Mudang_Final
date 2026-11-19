// 정류장 좌표를 도로 위 지점에 붙입니다. build-gtfs와 정류장 편집기가 함께 씁니다.
export function meters(a, b) {
  const x = (b.x - a.x) * Math.PI / 180 * Math.cos((a.y + b.y) / 2 * Math.PI / 180);
  const y = (b.y - a.y) * Math.PI / 180;
  return 6371000 * Math.hypot(x, y);
}

// 도로 링크 위에서 정류장 좌표와 가장 가까운 지점을 찾습니다. t는 링크 시작점부터의 비율입니다.
export function nearestRoadPoint(network, point) {
  const k = Math.cos(point.y * Math.PI / 180);
  let best = null;
  for (const edge of network.edges) {
    const a = network.nodes[edge.from], b = network.nodes[edge.to];
    const ax = (a.x - point.x) * k, ay = a.y - point.y, dx = (b.x - a.x) * k, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, d = meters(point, { x, y });
    if (!best || d < best.meters) best = { edge, t, x, y, meters: d };
  }
  return best;
}

// 정류장마다 도로 링크를 나누는 정차 노드를 만듭니다. 원래 링크는 그대로 두고 나눈 링크를 더합니다.
export function attachStops(network, stops) {
  const nodes = {}, edges = [], stopNodes = {}, snapped = {};
  for (const stop of stops) {
    const p = nearestRoadPoint(network, stop);
    snapped[stop.id] = { x: p.x, y: p.y, meters: p.meters };
    const { from, to } = p.edge;
    // 링크 끝점과 겹치면 기존 노드를 그대로 씁니다.
    if (meters(network.nodes[from], p) < 0.5) { stopNodes[stop.id] = from; continue; }
    if (meters(network.nodes[to], p) < 0.5) { stopNodes[stop.id] = to; continue; }
    const id = `stop:${stop.id}`;
    nodes[id] = { x: p.x, y: p.y }; stopNodes[stop.id] = id;
    const split = (a, b) => edges.push({ from: a, to: id, meters: meters(network.nodes[a], p) },
      { from: id, to: b, meters: meters(p, network.nodes[b]) });
    split(from, to);
    if (network.edges.some(e => e.from === to && e.to === from)) split(to, from);
  }
  return { nodes, edges, stopNodes, snapped };
}

// 원래 도로망에 정차 노드와 나눈 링크를 합칩니다.
export function withStops(network, attached) {
  return { nodes: { ...network.nodes, ...attached.nodes }, edges: [...network.edges, ...attached.edges] };
}
