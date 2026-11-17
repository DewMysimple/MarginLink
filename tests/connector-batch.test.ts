import { describe, expect, it } from 'vitest';
import type { Box, LineStyle } from '../src/types';
import { connectorBatch, partitionConnectorRoutes, type BatchRelationInput, type ConnectorBatch, type RoutedConnector } from '../src/view/connector-batch';
import type { Point, Segment } from '../src/view/connector-renderer';

// Independent evaluator for the SVG actually rendered by the batch. No route
// implementation geometry/safety helper is used by these assertions.
function sample(path: string): Point[] {
  const commands = [...path.matchAll(/([MLQC])\s+([^MLQC]+)/g)]; let from = { x: 0, y: 0 }; const points: Point[] = [];
  for (const [, command, values] of commands) {
    const n = values.trim().split(/[\s,]+/).map(Number);
    if (command === 'M') { from = { x: n[0], y: n[1] }; points.push(from); continue; }
    const end = command === 'C' ? { x: n[4], y: n[5] } : command === 'Q' ? { x: n[2], y: n[3] } : { x: n[0], y: n[1] };
    const steps = Math.ceil(Math.hypot(end.x - from.x, end.y - from.y) * 3) + 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      points.push(command === 'C' ? {
        x: u ** 3 * from.x + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t ** 3 * end.x,
        y: u ** 3 * from.y + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t ** 3 * end.y
      } : command === 'Q' ? { x: u * u * from.x + 2 * u * t * n[0] + t * t * end.x, y: u * u * from.y + 2 * u * t * n[1] + t * t * end.y }
        : { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t });
    }
    from = end;
  }
  return points;
}
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function trace(batch: ConnectorBatch, key: string): Point[] {
  const relation = batch.relations.get(key)!; expect(relation).toBeDefined();
  const strokes = new Map(batch.segments.map(s => [s.id, s])); const result: Point[] = [];
  for (const reference of relation.segments) {
    const stroke = strokes.get(reference.id)!; expect(stroke.members).toContain(key);
    const points = sample(stroke.path); if (reference.reversed) points.reverse();
    if (result.length) expect(dist(result.at(-1)!, points[0])).toBeLessThan(0.001);
    result.push(...points);
  }
  expect(dist(result[0], sample(relation.path)[0])).toBeLessThan(0.001);
  expect(dist(result.at(-1)!, sample(relation.path).at(-1)!)).toBeLessThan(0.001);
  return result;
}
const body = { left: 180, right: 820, top: 0, bottom: 650 };
const inputs: BatchRelationInput[] = [
  { key: 'ship', fragments: [{ left: 700, right: 740, top: 300, bottom: 320 }], card: { x: 856, y: 30, width: 84, height: 84, side: 'right' } },
  { key: 'dives', fragments: [{ left: 500, right: 540, top: 180, bottom: 200 }], card: { x: 856, y: 390, width: 84, height: 84, side: 'right' } }
];
const obstacles = [120, 150, 180, 210, 240, 270, 300, 330, 360].map(top => ({ left: 180, right: 820, top, bottom: top + 20 }));
const styles: LineStyle[] = ['straight', 'elbow', 'curve'];
function inside(p: Point, box: Box): boolean { return p.x > box.left + 0.001 && p.x < box.right - 0.001 && p.y > box.top + 0.001 && p.y < box.bottom - 0.001; }

describe('shared corridor batch rendering', () => {
  it.each(styles)('%s emits one common trunk and retains ordered source-to-card membership', style => {
    const batch = connectorBatch(inputs, style, { body, obstacles, lineWidth: 2 });
    expect(batch.relations.size).toBe(2);
    const common = batch.segments.filter(s => s.shared && s.members.includes('ship') && s.members.includes('dives'));
    expect(common.reduce((sum, s) => sum + s.length, 0)).toBeGreaterThanOrEqual(24);
    for (const key of ['ship', 'dives']) {
      const points = trace(batch, key); expect(points.length).toBeGreaterThan(100);
      expect(points.some(p => obstacles.some(box => inside(p, box)))).toBe(false);
      for (const other of inputs.filter(i => i.key !== key)) expect(points.some(p => inside(p, { left: other.card.x, right: other.card.x + other.card.width, top: other.card.y, bottom: other.card.y + other.card.height }))).toBe(false);
    }
    for (const shared of common) {
      expect(batch.segments.filter(s => s.path === shared.path)).toHaveLength(1);
      for (const key of shared.members) expect(batch.relations.get(key)!.segments.some(r => r.id === shared.id)).toBe(true);
    }
  });
  it('keeps smooth branch-to-trunk junctions tangent in each member’s traversal direction', () => {
    const batch = connectorBatch(inputs, 'curve', { body, obstacles, lineWidth: 2 });
    const strokes = new Map(batch.segments.map(s => [s.id, s])); let checked = 0;
    for (const relation of batch.relations.values()) for (let index = 1; index < relation.segments.length; index++) {
      const left = relation.segments[index - 1], right = relation.segments[index];
      if (!strokes.get(left.id)!.shared && !strokes.get(right.id)!.shared) continue;
      const a = sample(strokes.get(left.id)!.path), b = sample(strokes.get(right.id)!.path);
      if (left.reversed) a.reverse(); if (right.reversed) b.reverse();
      expect(dist(a.at(-1)!, b[0])).toBeLessThan(0.001);
      const end = a.at(-1)!, start = b[0];
      const previous = [...a].reverse().find(p => dist(p, end) > 0.001)!;
      const next = b.find(p => dist(p, start) > 0.001)!;
      const u = { x: end.x - previous.x, y: end.y - previous.y }, v = { x: next.x - start.x, y: next.y - start.y };
      const cosine = (u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y);
      expect(cosine).toBeGreaterThan(0.99); checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
  it('highlights only a member’s source, shared trunk and own destination branch', () => {
    const batch = connectorBatch(inputs, 'elbow', { body, obstacles });
    const ship = batch.segments.filter(s => s.members.includes('ship'));
    const divesOnly = batch.segments.filter(s => s.members.length === 1 && s.members[0] === 'dives');
    expect(ship.some(s => s.shared)).toBe(true); expect(divesOnly.length).toBeGreaterThan(0);
    expect(divesOnly.some(s => ship.some(active => active.id === s.id))).toBe(false);
  });
  it.each(styles)('%s cleans membership after deletion and preserves the surviving relation', style => {
    const before = connectorBatch(inputs, style, { body, obstacles });
    const after = connectorBatch([inputs[0]], style, { body, obstacles }, before);
    expect(after.sharedCount).toBe(0); expect(after.relations.size).toBe(1);
    expect(after.segments.every(s => s.members.length === 1 && s.members[0] === 'ship')).toBe(true);
    trace(after, 'ship');
  });
  it('retains a stable corridor and immutable card coordinates under tiny target movement', () => {
    const original = structuredClone(inputs), before = connectorBatch(inputs, 'elbow', { body, obstacles });
    const moved = inputs.map(i => i.key === 'dives' ? { ...i, card: { ...i.card, y: i.card.y + 0.5 } } : i);
    const after = connectorBatch(moved, 'elbow', { body, obstacles }, before);
    expect(after.sharedCount).toBeGreaterThan(0);
    expect(after.corridors).toEqual(before.corridors);
    expect(inputs).toEqual(original); trace(after, 'ship'); trace(after, 'dives');
  });
  it.each(styles)('%s never shares trunks across opposite margins', style => {
    const opposite = [{ ...inputs[0], card: { ...inputs[0].card, x: 48, side: 'left' as const } }, inputs[1]];
    const batch = connectorBatch(opposite, style, { body, obstacles });
    expect(batch.relations.size).toBe(2); expect(batch.sharedCount).toBe(0);
    trace(batch, 'ship'); trace(batch, 'dives');
  });
  it('invalidates the shared route when a new card occupies its corridor, then recovers', () => {
    const before = connectorBatch(inputs, 'elbow', { body, obstacles, lineWidth: 2 });
    const blocker = { left: 822, right: 847, top: 240, bottom: 270 };
    const blocked = connectorBatch(inputs, 'elbow', { body, obstacles, lineWidth: 2, cardObstacles: [blocker] }, before);
    const protectedBox = { left: blocker.left - 2.5, right: blocker.right + 2.5, top: blocker.top - 2.5, bottom: blocker.bottom + 2.5 };
    expect(blocked.relations.size).toBe(2);
    for (const stroke of blocked.segments) expect(sample(stroke.path).some(p => inside(p, protectedBox))).toBe(false);
    const recovered = connectorBatch(inputs, 'elbow', { body, obstacles, lineWidth: 2 }, blocked);
    expect(recovered.sharedCount).toBeGreaterThan(0); trace(recovered, 'ship'); trace(recovered, 'dives');
  });
  it('respects each fully visible relation’s own viewport bounds', () => {
    const bounds = { left: 0, right: 1000, top: 20, bottom: 500 };
    const batch = connectorBatch(inputs.map(i => ({ ...i, bounds })), 'curve', { body, obstacles });
    expect(batch.relations.size).toBe(2);
    for (const stroke of batch.segments) for (const p of sample(stroke.path)) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.left); expect(p.x).toBeLessThanOrEqual(bounds.right);
      expect(p.y).toBeGreaterThanOrEqual(bounds.top); expect(p.y).toBeLessThanOrEqual(bounds.bottom);
    }
  });
  it('rebuilds style-specific geometry without stale shared members', () => {
    let previous: ConnectorBatch | undefined;
    for (const style of styles) {
      const batch = connectorBatch(inputs, style, { body, obstacles }, previous);
      expect(batch.relations.size).toBe(2); trace(batch, 'ship'); trace(batch, 'dives');
      expect(batch.segments.every(s => s.members.every(key => batch.relations.has(key)))).toBe(true);
      if (style === 'elbow') expect(batch.segments.every(s => !/[QC]/.test(s.path))).toBe(true);
      if (style === 'curve') expect(batch.segments.some(s => /[QC]/.test(s.path))).toBe(true);
      previous = batch;
    }
  });
});

function routed(key: string, points: Point[], side: 'left' | 'right' = 'right'): RoutedConnector {
  const segments: Segment[] = points.slice(1).map((to, index) => ({ from: points[index], to }));
  return { input: { key, fragments: [], card: { x: 0, y: 0, width: 84, height: 84 } }, side, fingerprint: key, originY: 0,
    connector: { choice: { source: 'bottom', target: 'left', fragment: 0 }, path: `M ${points[0].x} ${points[0].y}` + points.slice(1).map(p => ` L ${p.x} ${p.y}`).join(''), segments, points } };
}
describe('continuous overlap partitioning', () => {
  it('splits overlap into one measurable interval and supports reverse member traversal', () => {
    const batch = partitionConnectorRoutes([
      routed('a', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 150, y: 100 }]),
      routed('b', [{ x: 50, y: 80 }, { x: 100, y: 80 }, { x: 100, y: 20 }, { x: 150, y: 20 }])
    ], 24, {});
    const common = batch.segments.filter(s => s.shared); expect(common).toHaveLength(1);
    expect(common[0].length).toBe(60); expect(common[0].members).toEqual(['a', 'b']);
    expect(batch.relations.get('b')!.segments.some(r => r.id === common[0].id && r.reversed)).toBe(true);
    trace(batch, 'a'); trace(batch, 'b');
  });
  it('keeps point crossings and short coincidence independent', () => {
    const point = partitionConnectorRoutes([
      routed('a', [{ x: 0, y: 50 }, { x: 100, y: 50 }]),
      routed('b', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    ], 24, {});
    expect(point.sharedCount).toBe(0); trace(point, 'a'); trace(point, 'b');
    const short = partitionConnectorRoutes([
      routed('a', [{ x: 0, y: 0 }, { x: 0, y: 100 }]),
      routed('b', [{ x: 0, y: 40 }, { x: 0, y: 60 }])
    ], 24, {});
    expect(short.sharedCount).toBe(0); trace(short, 'a'); trace(short, 'b');
  });
  it('recognizes a continuous common interval even when a member’s SVG was fragmented', () => {
    const batch = partitionConnectorRoutes([
      routed('a', [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 0, y: 40 }, { x: 0, y: 60 }]),
      routed('b', [{ x: 0, y: 0 }, { x: 0, y: 60 }])
    ], 24, {});
    expect(batch.sharedCount).toBe(1); expect(batch.segments.find(s => s.shared)!.length).toBe(60);
    trace(batch, 'a'); trace(batch, 'b');
  });
  it('retains ordered geometry when a private route revisits the same collinear line', () => {
    const batch = partitionConnectorRoutes([
      routed('b', [{ x: 60, y: 0 }, { x: 60, y: 60 }, { x: 20, y: 60 }, { x: 20, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 100 }])
    ], 24, {});
    expect(batch.sharedCount).toBe(0); trace(batch, 'b');
  });
  it('preserves reverse traversal instead of removing a member’s return along a shared interval', () => {
    const batch = partitionConnectorRoutes([
      routed('a', [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }]),
      routed('b', [{ x: 0, y: 0 }, { x: 0, y: 100 }])
    ], 24, {});
    expect(batch.relations.get('a')!.segments.map(r => r.reversed)).toEqual([false, true]);
    trace(batch, 'a'); trace(batch, 'b');
  });
  it('does not attach another visit’s long shared interval to a short same-line visit', () => {
    const batch = partitionConnectorRoutes([
      routed('a', [{ x: 60, y: 100 }, { x: 60, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 0 }]),
      routed('c', [{ x: 80, y: 20 }, { x: 80, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 0 }])
    ], 24, {});
    trace(batch, 'a'); trace(batch, 'c');
  });
  it('does not join geometrically identical intervals from opposite margins', () => {
    const batch = partitionConnectorRoutes([
      routed('a', [{ x: 0, y: 0 }, { x: 0, y: 100 }], 'left'),
      routed('b', [{ x: 0, y: 100 }, { x: 0, y: 0 }], 'right')
    ], 24, {});
    expect(batch.sharedCount).toBe(0); trace(batch, 'a'); trace(batch, 'b');
  });
});
