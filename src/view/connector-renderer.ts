import type { Box, LineStyle } from '../types';
import type { Placement } from './layout-engine';

type Edge = 'top' | 'right' | 'bottom' | 'left';
export interface Point { x: number; y: number }
interface Port extends Point { edge: Edge; nx: number; ny: number }
export interface PortChoice { fragment: number; source: Edge; target: Edge }
export interface ConnectorOptions {
  /** Rendered text rectangles, measured once for this Markdown view. */
  obstacles?: readonly Box[];
  body?: Box;
  lineWidth?: number;
  clearance?: number;
  /** Other cards are protected even during controlled contact with source text. */
  cardObstacles?: readonly Box[];
  /** Current content-coordinate draw area; an offscreen detour is not a connection. */
  bounds?: Box;
  corridorX?: number;
  preferCorridor?: boolean;
}
export interface Connector { path: string; choice: PortChoice; segments: Segment[]; points: Point[] }
export interface Segment { from: Point; to: Point; control?: Point; control2?: Point }

function validBox(box: Box): boolean {
  return Object.values(box).every(Number.isFinite) && box.right > box.left && box.bottom > box.top;
}
function ports(box: Box): Port[] {
  const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
  return [
    { edge: 'left', x: box.left, y, nx: -1, ny: 0 },
    { edge: 'right', x: box.right, y, nx: 1, ny: 0 },
    { edge: 'top', x, y: box.top, nx: 0, ny: -1 },
    { edge: 'bottom', x, y: box.bottom, nx: 0, ny: 1 }
  ];
}
function padded(box: Box, amount: number): Box {
  return { left: box.left - amount, right: box.right + amount, top: box.top - amount, bottom: box.bottom + amount };
}
// Clip against the open interior: a path can run exactly along its clearance
// boundary. This operates on whole segments, including diagonal straight lines.
function crosses(a: Point, b: Point, box: Box): boolean {
  let enter = 0, leave = 1;
  for (const [from, delta, low, high] of [
    [a.x, b.x - a.x, box.left, box.right], [a.y, b.y - a.y, box.top, box.bottom]
  ]) {
    if (delta === 0) {
      if (from <= low || from >= high) return false;
    } else {
      const first = (low - from) / delta, last = (high - from) / delta;
      enter = Math.max(enter, Math.min(first, last));
      leave = Math.min(leave, Math.max(first, last));
      if (enter >= leave) return false;
    }
  }
  return true;
}
function clearLine(a: Point, b: Point, obstacles: readonly Box[]): boolean {
  return !obstacles.some(box => crosses(a, b, box));
}
// A quadratic lies inside the convex hull of its three control points. Reject
// uncertain hulls by subdivision, rather than missing a curved crossing between
// a handful of samples. A 0.02 CSS-px leaf is conservative, including at tangency.
function clearCurve(a: Point, c: Point, b: Point, obstacles: readonly Box[], depth = 0): boolean {
  const bounds = { left: Math.min(a.x, c.x, b.x), right: Math.max(a.x, c.x, b.x), top: Math.min(a.y, c.y, b.y), bottom: Math.max(a.y, c.y, b.y) };
  const nearby = obstacles.filter(box => box.left < bounds.right && box.right > bounds.left && box.top < bounds.bottom && box.bottom > bounds.top);
  if (!nearby.length) return true;
  if (depth >= 12 || Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) < 0.02) return false;
  const ac = midpoint(a, c), cb = midpoint(c, b), middle = midpoint(ac, cb);
  return clearCurve(a, ac, middle, nearby, depth + 1) && clearCurve(middle, cb, b, nearby, depth + 1);
}
function midpoint(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function toward(a: Point, b: Point, amount: number): Point {
  const length = distance(a, b);
  return { x: a.x + (b.x - a.x) * amount / length, y: a.y + (b.y - a.y) * amount / length };
}
function clean(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && distance(point, result[result.length - 1]) < 0.001) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      const cross = (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      if (Math.abs(cross) > 0.001) break;
      result.pop(); // Collapse collinearity and immediate reversals before safety checks.
    }
    if (!result.length || distance(point, result[result.length - 1]) >= 0.001) result.push(point);
  }
  return result;
}
function segments(points: Point[], radius: number, minimumLead = 0): Segment[] | undefined {
  const result: Segment[] = [];
  let from = points[0];
  for (let i = 1; i < points.length; i++) {
    const corner = points[i], next = points[i + 1];
    let r = next ? Math.min(radius, distance(from, corner) / 3, distance(corner, next) / 3) : 0;
    if (i === 1 && next) r = Math.min(r, Math.max(0, distance(points[0], corner) - minimumLead));
    if (next && radius > 0 && r < 0.01) return;
    if (r > 0.01) {
      const before = toward(corner, from, r), after = toward(corner, next, r);
      result.push({ from, to: before }, { from: before, control: corner, to: after });
      from = after;
    } else { result.push({ from, to: corner }); from = corner; }
  }
  return result;
}
function cubicTransition(a: Port, escape: Point, approach: Point, b: Port, scale: number): Segment[] {
  const handle = Math.min(180, Math.max(18, distance(escape, approach) * scale));
  return [
    { from: a, to: escape },
    { from: escape, control: { x: escape.x + a.nx * handle, y: escape.y + a.ny * handle },
      control2: { x: approach.x + b.nx * handle, y: approach.y + b.ny * handle }, to: approach },
    { from: approach, to: b }
  ];
}
function clearCubic(a: Point, c: Point, d: Point, b: Point, obstacles: readonly Box[], depth = 0): boolean {
  const bounds = { left: Math.min(a.x, c.x, d.x, b.x), right: Math.max(a.x, c.x, d.x, b.x),
    top: Math.min(a.y, c.y, d.y, b.y), bottom: Math.max(a.y, c.y, d.y, b.y) };
  const nearby = obstacles.filter(box => box.left < bounds.right && box.right > bounds.left && box.top < bounds.bottom && box.bottom > bounds.top);
  if (!nearby.length) return true;
  if (depth >= 16 || Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) < 0.02) return false;
  const ac = midpoint(a, c), cd = midpoint(c, d), db = midpoint(d, b), left = midpoint(ac, cd), right = midpoint(cd, db), middle = midpoint(left, right);
  return clearCubic(a, ac, left, middle, nearby, depth + 1) && clearCubic(middle, right, db, b, nearby, depth + 1);
}
function clearPart(part: Segment, obstacles: readonly Box[]): boolean {
  return part.control2 && part.control ? clearCubic(part.from, part.control, part.control2, part.to, obstacles)
    : part.control ? clearCurve(part.from, part.control, part.to, obstacles) : clearLine(part.from, part.to, obstacles);
}
export function connectorPath(parts: Segment[]): string {
  return `M ${parts[0].from.x} ${parts[0].from.y}` + parts.map(s => s.control2 && s.control
    ? ` C ${s.control.x} ${s.control.y} ${s.control2.x} ${s.control2.y} ${s.to.x} ${s.to.y}` : s.control
      ? ` Q ${s.control.x} ${s.control.y} ${s.to.x} ${s.to.y}` : ` L ${s.to.x} ${s.to.y}`).join('');
}
function sourceContact(a: Port, to: Point, box: Box): boolean {
  const edge = a.edge === 'top' ? box.top : box.bottom;
  return a.x >= box.left && a.x <= box.right && Math.abs(a.y - edge) <= 1 &&
    (to.y - a.y) * a.ny > 0 && !crosses(a, to, box);
}
function safe(parts: Segment[], source: Port, obstacles: readonly Box[], protectedBoxes: readonly Box[], card: Box,
  cards: readonly Box[] = [], bounds?: Box): boolean {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (bounds && [part.from, part.to, ...(part.control ? [part.control] : []), ...(part.control2 ? [part.control2] : [])].some(p =>
      p.x < bounds.left || p.x > bounds.right || p.y < bounds.top || p.y > bounds.bottom)) return false;
    if (!clearPart(part, cards)) return false;
    if (!i) {
      // Only the initial straight normal lead may touch the padded source.
      // A curve's chord cannot establish that its actual arc leaves the glyph.
      if (part.control || part.control2) return false;
      if (obstacles.some((box, j) => crosses(part.from, part.to, protectedBoxes[j]) && !sourceContact(source, part.to, box))) return false;
    } else if (!clearPart(part, protectedBoxes)) return false;
    // Do not take a shortcut through the card to arrive at its far edge.
    if (!clearPart(part, [card])) return false;
  }
  return true;
}

/** Route from a real text fragment's top/bottom midpoint through whitespace.
 * Long vertical legs use the margin corridor, never the body column. Failure is
 * local to this connector; it does not move cards or mutate a saved layout. */
export function connectorRoute(fragments: Box[], card: Pick<Placement, 'x' | 'y' | 'width' | 'height'>,
  style: LineStyle = 'curve', previous?: PortChoice, options: ConnectorOptions = {}): Connector | undefined {
  const cardBox = { left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height };
  if (!validBox(cardBox)) return;
  const sources = fragments.map((box, fragment) => ({ box, fragment })).filter(({ box }) => validBox(box));
  if (!sources.length) return;
  const padding = Math.max(0.5, (options.lineWidth ?? 1.5) / 2) + Math.max(0, options.clearance ?? 1.5);
  const minY = Math.min(cardBox.top, ...sources.map(s => s.box.top)) - padding - 12;
  const maxY = Math.max(cardBox.bottom, ...sources.map(s => s.box.bottom)) + padding + 12;
  // Rows beyond the route's possible vertical extent cannot intersect it.
  const allObstacles = [...(options.obstacles ?? []), ...sources.map(s => s.box)].filter(validBox);
  const otherCards = (options.cardObstacles ?? []).filter(validBox).map(box => padded(box, padding));
  const obstacles = allObstacles
    .filter(box => validBox(box) && box.bottom + padding > minY && box.top - padding < maxY);
  const protectedBoxes = obstacles.map(box => padded(box, padding));
  const lead = padding + 0.5, targets = ports(cardBox);
  const tail = Math.max(12, 3 * (options.lineWidth ?? 1.5));
  const body = options.body ?? {
    left: Math.min(...sources.map(s => s.box.left)), right: Math.max(...sources.map(s => s.box.right)), top: 0, bottom: 0
  };
  const rightSide = (cardBox.left + cardBox.right) / 2 >= (body.left + body.right) / 2;
  const corridor = options.corridorX ?? (rightSide ? body.right + padding + 2 : body.left - padding - 2);
  let best: Connector | undefined, bestScore = Infinity;
  for (const { box, fragment } of sources) for (const a of ports(box).filter(port => !!port.ny)) {
    for (const extra of style === 'curve' ? [0, 3, 7, 16, 32] : [0, 3, 7]) {
      const escape = { x: a.x, y: a.y + a.ny * (lead + extra) };
      for (const b of targets) for (const approachLength of style === 'curve' ? [Math.max(36, tail * 2), tail, lead] : [tail, lead]) {
        const approach = { x: b.x + b.nx * approachLength, y: b.y + b.ny * approachLength };
        const candidates = [
          [a, escape, approach, b],
          [a, escape, { x: corridor, y: escape.y }, { x: corridor, y: approach.y }, approach, b]
        ];
        // Elbows keep every leg orthogonal. Other styles may use the short
        // direct span when it has verified whitespace all the way to the card.
        if (style === 'elbow') candidates[0] = [a, escape, { x: approach.x, y: escape.y }, approach, b];
        for (const candidate of candidates) {
          const points = clean(candidate);
          const shapes = style === 'curve'
            ? [
              ...(candidate === candidates[0] && points.length > 2 ? [0.35, 0.18, 0.08].map(scale => cubicTransition(a, escape, approach, b, scale)) : []),
              ...[24, 12, 6, 3, 1, 0.2, 0.05].map(radius => segments(points, radius, padding + 0.1))
            ] : [segments(points, 0)];
          for (const parts of shapes) {
            if (!parts || !safe(parts, a, obstacles, protectedBoxes, cardBox, otherCards, options.bounds)) continue;
            let score = parts.reduce((sum, s) => sum + distance(s.from, s.to), 0) + parts.length * 0.2;
            if (parts.some(part => part.control2)) score -= 24;
            // The complete route may be long while its final decorative fold is
            // only a few pixels. Prefer a clean normal entry, not a longer detour.
            const lastLength = points.length > 2 ? distance(points[points.length - 2], points[points.length - 1]) : Infinity;
            if (lastLength < tail - 0.001) score += 100000;
            if (options.preferCorridor && points.some((p, i) => i > 0 && p.x === corridor && points[i - 1].x === corridor && Math.abs(p.y - points[i - 1].y) >= 24)) score -= 10000;
            if (previous?.fragment === fragment && previous.source === a.edge && previous.target === b.edge) score -= 4;
            if (score < bestScore) { bestScore = score; best = { path: connectorPath(parts), choice: { fragment, source: a.edge, target: b.edge }, segments: parts, points }; }
            break;
          }
        }
      }
    }
  }
  if (best) return best;
  // Only expand after the inexpensive candidates fail. The rectilinear visibility
  // grid is induced by actual padded obstacle edges, not a fixed list of exits.
  return searchRoute(sources, targets, allObstacles, otherCards, cardBox, lead, padding, corridor, style, previous, options, tail)
    ?? searchRoute(sources, targets, allObstacles, otherCards, cardBox, lead, padding, corridor, style, previous, options, lead);
}

/** Revalidate a complete path after shared-segment construction or subdivision. */
export function clearConnectorSegments(parts: Segment[], fragments: Box[], card: Pick<Placement, 'x' | 'y' | 'width' | 'height'>, options: ConnectorOptions = {}): boolean {
  if (!parts.length) return false;
  const padding = Math.max(0.5, (options.lineWidth ?? 1.5) / 2) + Math.max(0, options.clearance ?? 1.5);
  const raw = [...(options.obstacles ?? []), ...fragments].filter(validBox);
  const start = parts[0].from;
  const source = fragments.flatMap(box => ports(box).filter(port => !!port.ny)).find(port => distance(port, start) < 0.01);
  return !!source && safe(parts, source, raw, raw.map(b => padded(b, padding)),
    { left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height },
    (options.cardObstacles ?? []).filter(validBox).map(b => padded(b, padding)), options.bounds);
}

interface SearchStart { source: Port; escape: Point; fragment: number }
interface SearchNode { index: number; cost: number; estimate: number; start: SearchStart; previous?: SearchNode }
function searchRoute(sources: { box: Box; fragment: number }[], targets: Port[], raw: Box[], cards: Box[], card: Box,
  lead: number, padding: number, corridor: number, style: LineStyle, previous: PortChoice | undefined, options: ConnectorOptions, approachLength: number): Connector | undefined {
  const paddedText = raw.map(b => padded(b, padding)), blocked = [...paddedText, ...cards, card];
  const starts: SearchStart[] = [];
  for (const { box, fragment } of sources) for (const source of ports(box).filter(p => !!p.ny)) {
    const escape = { x: source.x, y: source.y + source.ny * lead };
    if (safe([{ from: source, to: escape }], source, raw, paddedText, card, cards, options.bounds)) starts.push({ source, escape, fragment });
  }
  if (!starts.length) return;
  const goals = targets.map(port => ({ port, point: { x: port.x + port.nx * approachLength, y: port.y + port.ny * approachLength } }))
    .filter(g => clearLine(g.point, g.port, [...paddedText, ...cards]) && !blocked.some(b => inside(g.point, b)));
  if (!goals.length) return;
  const points = [...starts.map(s => s.escape), ...goals.map(g => g.point)];
  const envelope = options.bounds ?? {
    left: Math.min(...points.map(p => p.x), ...blocked.map(b => b.left)) - 16,
    right: Math.max(...points.map(p => p.x), ...blocked.map(b => b.right)) + 16,
    top: Math.min(...points.map(p => p.y), ...blocked.map(b => b.top)) - 16,
    bottom: Math.max(...points.map(p => p.y), ...blocked.map(b => b.bottom)) + 16
  };
  const coordinates = (values: number[], min: number, max: number) => [...new Set(values.filter(v => Number.isFinite(v) && v >= min && v <= max))].sort((a, b) => a - b);
  const xs = coordinates([envelope.left, envelope.right, corridor, ...points.map(p => p.x), ...blocked.flatMap(b => [b.left - 0.25, b.right + 0.25])], envelope.left, envelope.right);
  const ys = coordinates([envelope.top, envelope.bottom, ...points.map(p => p.y), ...blocked.flatMap(b => [b.top - 0.25, b.bottom + 0.25])], envelope.top, envelope.bottom);
  const width = xs.length;
  const indexOf = (p: Point) => { const x = xs.indexOf(p.x), y = ys.indexOf(p.y); return x < 0 || y < 0 ? -1 : y * width + x; };
  const position = (index: number): Point => ({ x: xs[index % width], y: ys[Math.floor(index / width)] });
  const goalMap = new Map(goals.map(goal => [indexOf(goal.point), goal]));
  const heuristic = (p: Point) => Math.min(...goals.map(goal => Math.abs(p.x - goal.point.x) + Math.abs(p.y - goal.point.y)));
  const heap: SearchNode[] = [], costs = new Map<number, number>();
  const push = (node: SearchNode) => {
    let i = heap.length; heap.push(node);
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].estimate <= node.estimate) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = node;
  };
  const pop = (): SearchNode => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].estimate < heap[child].estimate) child++;
        if (heap[child].estimate >= last.estimate) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  for (const start of starts) {
    const index = indexOf(start.escape); if (index < 0) continue;
    const cost = previous?.fragment === start.fragment && previous.source === start.source.edge ? 0 : 4;
    if ((costs.get(index) ?? Infinity) <= cost) continue;
    costs.set(index, cost); push({ index, cost, estimate: cost + heuristic(start.escape), start });
  }
  while (heap.length) {
    const node = pop(); if (node.cost !== costs.get(node.index)) continue;
    const point = position(node.index), goal = goalMap.get(node.index);
    if (goal) {
      const path: Point[] = [];
      for (let at: SearchNode | undefined = node; at; at = at.previous) path.push(position(at.index));
      path.reverse();
      const routePoints = clean([node.start.source, ...path, goal.port]);
      for (const radius of style === 'curve' ? [24, 12, 6, 3, 1, 0.2, 0.05] : [0]) {
        const parts = segments(routePoints, radius, padding + 0.1);
        if (parts && safe(parts, node.start.source, raw, paddedText, card, cards, options.bounds)) return {
          path: connectorPath(parts), choice: { fragment: node.start.fragment, source: node.start.source.edge, target: goal.port.edge }, segments: parts, points: routePoints
        };
      }
    }
    const x = node.index % width, y = Math.floor(node.index / width);
    const next = [x > 0 ? node.index - 1 : -1, x + 1 < width ? node.index + 1 : -1,
      y > 0 ? node.index - width : -1, y + 1 < ys.length ? node.index + width : -1];
    for (const index of next) {
      if (index < 0) continue;
      const to = position(index), cost = node.cost + distance(point, to);
      if (cost >= (costs.get(index) ?? Infinity) - 0.001 || !clearLine(point, to, blocked)) continue;
      costs.set(index, cost); push({ index, cost, estimate: cost + heuristic(to), start: node.start, previous: node });
    }
  }
}
function inside(point: Point, box: Box): boolean {
  return point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
}
