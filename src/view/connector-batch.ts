import type { Box, LineStyle, Side } from '../types';
import type { Placement } from './layout-engine';
import { connectorRoute, connectorPath, clearConnectorSegments, type Connector, type ConnectorOptions, type Point, type PortChoice, type Segment } from './connector-renderer';

export interface BatchRelationInput {
  cardKey?: string;
  targetFraction?: number;
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
  originX: number;
  originY: number;
}
export interface ConnectorBatch {
  segments: BatchStroke[];
  relations: Map<string, BatchRelation>;
  corridors: Partial<Record<Side, number>>;
  sharedCount: number;
  /** Last completed optional search, in coordinates relative to its routes. */
  optimization?: string;
}
type CachedRoute = Pick<BatchRelation, 'connector' | 'fingerprint' | 'originX' | 'originY'>;
/** A view's bounded drawing hints survive leaving measured coverage. They are
 * never emitted as current relations; every candidate must pass current safety. */
export class ConnectorRouteCache {
  private entries = new Map<string, CachedRoute>();
  private readonly limit: number;
  constructor(limit = 100) { this.limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100; }
  get size(): number { return this.entries.size; }
  get(key: string): Readonly<CachedRoute> | undefined { return this.entries.get(key); }
  remember(batch: ConnectorBatch): void {
    for (const [key, relation] of batch.relations) {
      this.entries.delete(key);
      this.entries.set(key, { connector: relation.connector, fingerprint: relation.fingerprint, originX: relation.originX, originY: relation.originY });
    }
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  clear(): void { this.entries.clear(); }
}
export interface BatchOptions extends ConnectorOptions {
  onRouteSearch?: () => void;
  minSharedLength?: number;
  maxDetourRatio?: number;
  /** Defer exploratory shared-corridor searches during a live gesture. Existing
   * routes are still checked against every card and coincident ink is shared. */
  optimizeShared?: boolean;
}
export interface RoutedConnector { input: BatchRelationInput; connector: Connector; side: Side; fingerprint: string; originX: number; originY: number }
interface LineRecord { route: RoutedConnector; index: number; part: Segment; u: Point; offset: number; low: number; high: number }
const EPSILON = 0.0001;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const number = (n: number) => Math.round(n * 10000) / 10000;
const pointKey = (p: Point) => `${number(p.x)},${number(p.y)}`;
const samePoint = (a: Point, b: Point) => distance(a, b) < EPSILON;
function translateConnector(connector: Connector, dx: number, dy: number): Connector {
  if (dx === 0 && dy === 0) return connector;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  const segments = connector.segments.map(part => ({ ...part, from: move(part.from), to: move(part.to),
    ...(part.control ? { control: move(part.control) } : {}), ...(part.control2 ? { control2: move(part.control2) } : {}) }));
  return { ...connector, segments, points: connector.points.map(move), path: connectorPath(segments) };
}
/** A safe section translation or distant virtualized text must not launch the
 * same optional corridor search again. Safety is checked separately on every
 * reused route; this key only remembers a completed visual optimization. */
function sharingKey(routes: RoutedConnector[], options: BatchOptions, minimum: number, cards: readonly Box[]): string {
  const origin = routes[0]?.originY ?? 0;
  const point = (p: Point) => [p.x, p.y - origin];
  const box = (b: Box) => [b.left, b.right, b.top - origin, b.bottom - origin];
  const points = routes.flatMap(route => [
    ...route.input.fragments.flatMap(b => [{ x: b.left, y: b.top }, { x: b.right, y: b.bottom }]),
    { x: route.input.card.x, y: route.input.card.y },
    { x: route.input.card.x + route.input.card.width, y: route.input.card.y + route.input.card.height },
    ...route.connector.segments.flatMap(s => [s.from, s.to, ...(s.control ? [s.control] : []), ...(s.control2 ? [s.control2] : [])])
  ]);
  const pad = Math.max(.5, (options.lineWidth ?? 1.5) / 2) + Math.max(0, options.clearance ?? 1.5);
  const region = { left: Math.min(...points.map(p => p.x)) - pad, right: Math.max(...points.map(p => p.x)) + pad,
    top: Math.min(...points.map(p => p.y)) - pad, bottom: Math.max(...points.map(p => p.y)) + pad };
  const relevant = [...(options.obstacles ?? []), ...(options.cardObstacles ?? []), ...cards]
    .filter(b => b.left <= region.right && b.right >= region.left && b.top <= region.bottom && b.bottom >= region.top)
    .map(b => JSON.stringify(box(b))).sort();
  const limits = routes.map(route => {
    const bounds = route.input.bounds ?? options.bounds;
    return bounds ? box({ left: Math.max(region.left, bounds.left), right: Math.min(region.right, bounds.right),
      top: Math.max(region.top, bounds.top), bottom: Math.min(region.bottom, bounds.bottom) }) : null;
  });
  return JSON.stringify([minimum, options.maxDetourRatio, relevant, limits, routes.map(route => [
    route.input.key, route.side, route.fingerprint, route.originY - origin,
    route.connector.segments.map(s => [point(s.from), point(s.to), s.control && point(s.control), s.control2 && point(s.control2)])
  ])]);
}
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
      segments: combined, shared: combined.some(r => strokes.get(r.id)!.shared), fingerprint: route.fingerprint,
      originX: route.originX, originY: route.originY });
  }
  return { segments: [...strokes.values()], relations, corridors, sharedCount: [...strokes.values()].filter(s => s.shared).length };
}

/** A batch is ephemeral drawing data scoped to one view. No relation or layout
 * records are written. Safe existing routes are reused when another card moves. */
export function connectorBatch(inputs: BatchRelationInput[], style: LineStyle, options: BatchOptions = {}, previous?: ConnectorBatch, cache?: ConnectorRouteCache): ConnectorBatch {
  const minimum = Math.max(1, options.minSharedLength ?? 24), cards = inputs.map(i => ({ key: i.cardKey ?? i.key, box: cardBox(i.card) }));
  const perInput = (input: BatchRelationInput): ConnectorOptions => ({ ...options, targetFraction: input.targetFraction, bounds: input.bounds ?? options.bounds, cardObstacles: [...(options.cardObstacles ?? []), ...cards.filter(c => c.key !== (input.cardKey ?? input.key)).map(c => c.box)] });
  const search = (...args: Parameters<typeof connectorRoute>) => {
    options.onRouteSearch?.();
    return connectorRoute(...args);
  };
  let routes: RoutedConnector[] = [];
  for (const input of inputs) {
    // A newly measured neighbourhood need not change an existing route. Its
    // own relative endpoints and routing policy establish reuse eligibility.
    // Scrolling can shift a virtual section vertically, and resizing can shift
    // centered text and edge-aligned cards together. Verify the translated path
    // against the current viewport and obstacles before using it.
    const originX = input.fragments[0]?.left ?? input.card.x;
    const originY = input.fragments[0]?.top ?? input.card.y;
    const fragments = input.fragments.map(box => ({ left: box.left - originX, right: box.right - originX, top: box.top - originY, bottom: box.bottom - originY }));
    const body = options.body && { ...options.body, left: options.body.left - originX, right: options.body.right - originX };
    const corridorX = options.corridorX === undefined ? undefined : options.corridorX - originX;
    const fingerprint = JSON.stringify([style, input.targetFraction, fragments, { ...input.card, x: input.card.x - originX, y: input.card.y - originY },
      options.lineWidth, options.clearance, options.minimumClearance, body, corridorX, options.preferCorridor]);
    const old = previous?.relations.get(input.key) ?? cache?.get(input.key), own = perInput(input);
    const candidate = old?.fingerprint === fingerprint && [originX, originY, old.originX, old.originY].every(Number.isFinite)
      ? translateConnector(old.connector, originX - old.originX, originY - old.originY) : undefined;
    const connector = candidate && clearConnectorSegments(candidate.segments, input.fragments, input.card, { ...own, clearance: candidate.clearance ?? own.clearance })
      ? candidate : search(input.fragments, input.card, style, input.previous ?? old?.connector.choice, own);
    if (connector) routes.push({ input, connector, side: sideOf(input, options.body), fingerprint, originX, originY });
  }
  const optimize = options.optimizeShared !== false;
  const cardBoxes = cards.map(card => card.box);
  const unchanged = optimize && previous?.optimization === sharingKey(routes, options, minimum, cardBoxes);
  const corridors: Partial<Record<Side, number>> = !optimize || unchanged ? { ...previous?.corridors } : {};
  const sides: Side[] = !optimize || unchanged ? [] : ['left', 'right'];
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
        const connector = search(route.input.fragments, route.input.card, style, route.connector.choice,
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
  const batch = partitionConnectorRoutes(routes, minimum, corridors);
  batch.optimization = optimize ? sharingKey(routes, options, minimum, cardBoxes) : previous?.optimization;
  return batch;
}
