import type { Box, LineStyle, Side } from '../types';
import type { Placement } from './layout-engine';
import { connectorRoute, connectorPath, clearConnectorSegments, type Connector, type ConnectorOptions, type Point, type PortChoice, type Segment } from './connector-renderer';

export interface BatchRelationInput {
  key: string;
  fragments: Box[];
  card: Pick<Placement, 'x' | 'y' | 'width' | 'height'> & { side?: Side };
  previous?: PortChoice;
  bounds?: Box;
}
export interface SegmentReference { id: string; reversed: boolean }
export interface BatchStroke {
  id: string;
  path: string;
  members: string[];
  from: Point;
  to: Point;
  parts: Segment[];
  length: number;
  shared: boolean;
}
export interface BatchRelation {
  key: string;
  path: string;
  choice: PortChoice;
  connector: Connector;
  segments: SegmentReference[];
  shared: boolean;
  fingerprint: string;
}
export interface ConnectorBatch {
  segments: BatchStroke[];
  relations: Map<string, BatchRelation>;
  corridors: Partial<Record<Side, number>>;
  sharedCount: number;
  geometry: string;
}
export interface BatchOptions extends ConnectorOptions {
  minSharedLength?: number;
  maxDetourRatio?: number;
  /** Defer exploratory shared-corridor searches during a live gesture. Existing
   * routes are still checked against every card and coincident ink is shared. */
  optimizeShared?: boolean;
}
export interface RoutedConnector { input: BatchRelationInput; connector: Connector; side: Side; fingerprint: string }
interface LineRecord { route: RoutedConnector; index: number; part: Segment; u: Point; offset: number; low: number; high: number }
const EPSILON = 0.0001;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const number = (n: number) => Math.round(n * 10000) / 10000;
const pointKey = (p: Point) => `${number(p.x)},${number(p.y)}`;
const samePoint = (a: Point, b: Point) => distance(a, b) < EPSILON;
function primitiveLength(part: Segment): number {
  if (!part.control) return distance(part.from, part.to);
  let last = part.from, length = 0;
  for (let i = 1; i <= 32; i++) {
    const t = i / 32, u = 1 - t, c = part.control, d = part.control2;
    const p = d ? {
      x: u ** 3 * part.from.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * part.to.x,
      y: u ** 3 * part.from.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t ** 3 * part.to.y
    } : { x: u * u * part.from.x + 2 * u * t * c.x + t * t * part.to.x, y: u * u * part.from.y + 2 * u * t * c.y + t * t * part.to.y };
    length += distance(last, p); last = p;
  }
  return length;
}
const routeLength = (route: Connector) => route.segments.reduce((sum, part) => sum + primitiveLength(part), 0);
// Shared ink is useful only if each member stays just as easy to follow. Count
// the route's geometric turns, not SVG primitives (rounded corners and shared
// interval cuts introduce primitives without adding a turn).
function routeTurns(route: Connector): number {
  const points = route.points.filter((point, i, all) => !i || !samePoint(point, all[i - 1]));
  let turns = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
    const b = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y };
    if (Math.abs(a.x * b.y - a.y * b.x) > EPSILON * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || dot(a, b) < 0) turns++;
  }
  return turns;
}
const cardBox = (card: BatchRelationInput['card']): Box => ({ left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height });
function sideOf(input: BatchRelationInput, body?: Box): Side {
  const middle = body ? (body.left + body.right) / 2 : input.fragments.reduce((sum, b) => sum + (b.left + b.right) / 2, 0) / Math.max(1, input.fragments.length);
  return input.card.side ?? (input.card.x + input.card.width / 2 < middle ? 'left' : 'right');
}
function lineRecord(route: RoutedConnector, part: Segment, index: number): LineRecord | undefined {
  if (part.control || distance(part.from, part.to) < EPSILON) return;
  let u = { x: part.to.x - part.from.x, y: part.to.y - part.from.y };
  const length = Math.hypot(u.x, u.y); u = { x: u.x / length, y: u.y / length };
  if (u.x < -EPSILON || Math.abs(u.x) < EPSILON && u.y < 0) u = { x: -u.x, y: -u.y };
  const a = dot(part.from, u), b = dot(part.to, u);
  return { route, part, index, u, offset: u.x * part.from.y - u.y * part.from.x, low: Math.min(a, b), high: Math.max(a, b) };
}
const groupKey = (line: LineRecord) => `${line.route.side}|${pointKey(line.u)}|${number(line.offset)}`;
function onLine(line: LineRecord, t: number): Point {
  return { x: line.u.x * t - line.u.y * line.offset, y: line.u.y * t + line.u.x * line.offset };
}
function overlaps(a: LineRecord, b: LineRecord): number { return Math.min(a.high, b.high) - Math.max(a.low, b.low); }

/** Split real coincident intervals, not entire relations. Each normal stroke is
 * emitted once, while each occurrence retains its own ordered source-to-card
 * references (including reverse traversal of a shared trunk). */
export function partitionConnectorRoutes(routes: RoutedConnector[], minimum: number, corridors: Partial<Record<Side, number>>): ConnectorBatch {
  // Fragmentation must not turn a long continuous coincident interval into
  // several sub-threshold pieces. Keep turns and reverse traversal intact.
  routes = routes.map(route => {
    const parts: Segment[] = [];
    for (const part of route.connector.segments) {
      const last = parts.at(-1);
      if (last && !last.control && !part.control && samePoint(last.to, part.from)) {
        const a = { x: last.to.x - last.from.x, y: last.to.y - last.from.y };
        const b = { x: part.to.x - part.from.x, y: part.to.y - part.from.y };
        if (Math.abs(a.x * b.y - a.y * b.x) < EPSILON && dot(a, b) > 0) { last.to = part.to; continue; }
      }
      parts.push({ ...part });
    }
    return { ...route, connector: { ...route.connector, segments: parts } };
  });
  const groups = new Map<string, LineRecord[]>(), strokes = new Map<string, BatchStroke>();
  const pieces = new Map<string, Map<number, SegmentReference[]>>();
  for (const route of routes) {
    pieces.set(route.input.key, new Map());
    route.connector.segments.forEach((part, index) => {
      const line = lineRecord(route, part, index);
      if (line) { const key = groupKey(line); const group = groups.get(key) ?? []; group.push(line); groups.set(key, group); }
      else {
        const id = `private:${route.input.key}:${index}`;
        strokes.set(id, { id, path: connectorPath([part]), members: [route.input.key], from: part.from, to: part.to, parts: [part], length: primitiveLength(part), shared: false });
        pieces.get(route.input.key)!.set(index, [{ id, reversed: false }]);
      }
    });
  }
  for (const [groupName, lines] of groups) {
    const cuts = [...new Set(lines.flatMap(l => [l.low, l.high]))].sort((a, b) => a - b);
    const intervals: { low: number; high: number; lines: LineRecord[]; shared: boolean; token: string }[] = [];
    for (let i = 1; i < cuts.length; i++) {
      const low = cuts[i - 1], high = cuts[i]; if (high - low < EPSILON) continue;
      const middle = (low + high) / 2, covering = lines.filter(l => l.low < middle && l.high > middle);
      const eligible = covering.filter(a => covering.some(b => a.route.input.key !== b.route.input.key && overlaps(a, b) >= minimum));
      if (eligible.length > 1) intervals.push({ low, high, lines: eligible, shared: true, token: JSON.stringify(eligible.map(l => [l.route.input.key, l.index]).sort()) });
      for (const line of covering.filter(l => !eligible.includes(l))) intervals.push({ low, high, lines: [line], shared: false, token: `${line.route.input.key}:${line.index}` });
    }
    // Remove artificial cuts whose neighbouring coverage is identical. This also
    // keeps a qualifying common interval measurable as one continuous stroke.
    const merged: typeof intervals = [];
    for (const interval of intervals) {
      const before = [...merged].reverse().find(other => other.token === interval.token && other.shared === interval.shared && Math.abs(other.high - interval.low) < EPSILON);
      if (before) before.high = interval.high; else merged.push({ ...interval });
    }
    for (const interval of merged) {
      let from = onLine(lines[0], interval.low), to = onLine(lines[0], interval.high);
      const privateReverse = !interval.shared && dot(interval.lines[0].part.to, interval.lines[0].u) < dot(interval.lines[0].part.from, interval.lines[0].u);
      if (privateReverse) [from, to] = [to, from];
      const part = { from, to };
      const id = `${interval.shared ? 'shared' : 'private'}:${groupName}:${number(interval.low)}:${number(interval.high)}:${interval.shared ? '' : interval.token}`;
      const members = [...new Set(interval.lines.map(l => l.route.input.key))].sort();
      strokes.set(id, { id, path: connectorPath([part]), members, from, to, parts: [part], length: interval.high - interval.low, shared: interval.shared });
      for (const original of interval.lines) {
        const target = pieces.get(original.route.input.key)!;
        const refs = target.get(original.index) ?? [];
        const reversed = interval.shared && dot(original.part.to, original.u) < dot(original.part.from, original.u);
        if (!refs.some(r => r.id === id && r.reversed === reversed)) refs.push({ id, reversed });
        target.set(original.index, refs);
      }
    }
  }
  const relations = new Map<string, BatchRelation>();
  for (const route of routes) {
    const refs = route.connector.segments.flatMap((part, index) => {
      const list = pieces.get(route.input.key)!.get(index) ?? [];
      return list.sort((a, b) => {
        const start = (r: SegmentReference) => r.reversed ? strokes.get(r.id)!.to : strokes.get(r.id)!.from;
        return distance(part.from, start(a)) - distance(part.from, start(b));
      });
    }).filter((ref, index, list) => !index || ref.id !== list[index - 1].id || ref.reversed !== list[index - 1].reversed);
    // Join private primitives into a single path to retain normal SVG joins.
    const combined: SegmentReference[] = [];
    for (const ref of refs) {
      const stroke = strokes.get(ref.id)!, lastRef = combined.at(-1), last = lastRef ? strokes.get(lastRef.id) : undefined;
      if (!stroke.shared && last && !last.shared && !ref.reversed && !lastRef!.reversed && samePoint(last.to, stroke.from)) {
        last.parts.push(...stroke.parts); last.to = stroke.to; last.length += stroke.length; last.path = connectorPath(last.parts); strokes.delete(stroke.id);
      } else combined.push(ref);
    }
    relations.set(route.input.key, { key: route.input.key, path: route.connector.path, choice: route.connector.choice, connector: route.connector,
      segments: combined, shared: combined.some(r => strokes.get(r.id)!.shared), fingerprint: route.fingerprint });
  }
  return { segments: [...strokes.values()], relations, corridors, sharedCount: [...strokes.values()].filter(s => s.shared).length, geometry: '' };
}

/** A batch is ephemeral drawing data scoped to one view. No relation or layout
 * records are written. Safe existing routes are reused when another card moves. */
export function connectorBatch(inputs: BatchRelationInput[], style: LineStyle, options: BatchOptions = {}, previous?: ConnectorBatch): ConnectorBatch {
  const geometry = JSON.stringify([options.obstacles ?? [], options.cardObstacles ?? [], options.body, options.bounds, options.lineWidth, options.clearance, options.minimumClearance]);
  const minimum = Math.max(1, options.minSharedLength ?? 24), cards = inputs.map(i => ({ key: i.key, box: cardBox(i.card) }));
  const perInput = (input: BatchRelationInput): ConnectorOptions => ({ ...options, bounds: input.bounds ?? options.bounds, cardObstacles: [...(options.cardObstacles ?? []), ...cards.filter(c => c.key !== input.key).map(c => c.box)] });
  let routes: RoutedConnector[] = [];
  for (const input of inputs) {
    const fingerprint = JSON.stringify([style, input.fragments, input.card, input.bounds, options.lineWidth, options.clearance, options.minimumClearance, options.body]);
    const old = previous?.relations.get(input.key), own = perInput(input);
    const connector = previous?.geometry === geometry && old?.fingerprint === fingerprint && clearConnectorSegments(old.connector.segments, input.fragments, input.card, { ...own, clearance: old.connector.clearance ?? own.clearance })
      ? old.connector : connectorRoute(input.fragments, input.card, style, input.previous ?? old?.choice, own);
    if (connector) routes.push({ input, connector, side: sideOf(input, options.body), fingerprint });
  }
  const corridors: Partial<Record<Side, number>> = options.optimizeShared === false ? { ...previous?.corridors } : {};
  const sides: Side[] = options.optimizeShared === false ? [] : ['left', 'right'];
  for (const side of sides) {
    const members = routes.filter(r => r.side === side); if (members.length < 2 || !options.body) continue;
    const gap = side === 'right' ? Math.min(...members.map(r => r.input.card.x)) - options.body.right : options.body.left - Math.max(...members.map(r => r.input.card.x + r.input.card.width));
    if (gap <= 4) continue;
    const candidates = [previous?.corridors[side], side === 'right' ? options.body.right + gap / 2 : options.body.left - gap / 2,
      side === 'right' ? options.body.right + Math.min(8, gap / 3) : options.body.left - Math.min(8, gap / 3)]
      .filter((x): x is number => x !== undefined && Number.isFinite(x));
    const existing = partitionConnectorRoutes(routes, minimum, {}), baseInk = existing.segments.reduce((sum, s) => sum + s.length, 0);
    const common = existing.segments.filter(s => s.shared && Math.abs(s.from.x - s.to.x) < EPSILON &&
      s.members.every(key => members.some(member => member.input.key === key)) &&
      (side === 'right' ? s.from.x > options.body!.right : s.from.x < options.body!.left)).sort((a, b) => b.length - a.length)[0];
    if (common && common.length >= minimum) { corridors[side] = common.from.x; continue; }
    let best = routes, score = baseInk, bestCorridor: number | undefined;
    for (const corridorX of [...new Set(candidates)]) {
      const proposed = members.map(route => {
        if (route.connector.segments.some(part => !part.control && Math.abs(part.from.x - corridorX) < EPSILON &&
          Math.abs(part.to.x - corridorX) < EPSILON && Math.abs(part.to.y - part.from.y) >= minimum)) return route;
        const connector = connectorRoute(route.input.fragments, route.input.card, style, route.connector.choice,
          { ...perInput(route.input), clearance: route.connector.clearance ?? options.clearance, corridorX, preferCorridor: true });
        if (!connector || routeTurns(connector) > routeTurns(route.connector) ||
            routeLength(connector) > routeLength(route.connector) * (options.maxDetourRatio ?? 1.35) + minimum) return route;
        return { ...route, connector };
      });
      const candidateRoutes = routes.map(route => proposed.find(r => r.input.key === route.input.key) ?? route);
      const batch = partitionConnectorRoutes(candidateRoutes, minimum, {}), ink = batch.segments.reduce((sum, s) => sum + s.length, 0);
      const sharedLength = batch.segments.filter(s => s.shared).reduce((sum, s) => sum + s.length, 0);
      // Real stroke savings must pay for rerouting. Retain near-equivalent old
      // corridors to avoid moving a trunk for tiny pointer movements.
      const hysteresis = previous?.corridors[side] === corridorX ? 4 : 0;
      if (sharedLength >= minimum && ink - hysteresis < score - 1) { best = candidateRoutes; score = ink - hysteresis; bestCorridor = corridorX; }
    }
    routes = best;
    if (bestCorridor !== undefined) corridors[side] = bestCorridor;
    else if (previous?.corridors[side] !== undefined) corridors[side] = previous.corridors[side];
  }
  const batch = partitionConnectorRoutes(routes, minimum, corridors); batch.geometry = geometry; return batch;
}
