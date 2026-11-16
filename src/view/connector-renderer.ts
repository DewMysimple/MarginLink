import type { Box, LineStyle } from '../types';
import type { Placement } from './layout-engine';

type Edge = 'top' | 'right' | 'bottom' | 'left';
interface Point { x: number; y: number }
interface Port extends Point { edge: Edge; nx: number; ny: number }
export interface PortChoice { fragment: number; source: Edge; target: Edge }
export interface ConnectorOptions {
  /** Rendered text rectangles, measured once for this Markdown view. */
  obstacles?: readonly Box[];
  body?: Box;
  lineWidth?: number;
  clearance?: number;
}
interface Connector { path: string; choice: PortChoice }
interface Segment { from: Point; to: Point; control?: Point }

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
  return points.filter((p, i) => !i || distance(p, points[i - 1]) > 0.001);
}
function segments(points: Point[], radius: number): Segment[] {
  const result: Segment[] = [];
  let from = points[0];
  for (let i = 1; i < points.length; i++) {
    const corner = points[i], next = points[i + 1];
    // Keep the complete first normal lead: its controlled contact with the
    // source text is the sole exception to normal stroke clearance.
    const r = i > 1 && next ? Math.min(radius, distance(from, corner) / 3, distance(corner, next) / 3) : 0;
    if (r > 0.01) {
      const before = toward(corner, from, r), after = toward(corner, next, r);
      result.push({ from, to: before }, { from: before, control: corner, to: after });
      from = after;
    } else { result.push({ from, to: corner }); from = corner; }
  }
  return result;
}
function pathFor(parts: Segment[]): string {
  return `M ${parts[0].from.x} ${parts[0].from.y}` + parts.map(s => s.control
    ? ` Q ${s.control.x} ${s.control.y} ${s.to.x} ${s.to.y}` : ` L ${s.to.x} ${s.to.y}`).join('');
}
function sourceContact(a: Port, to: Point, box: Box): boolean {
  const edge = a.edge === 'top' ? box.top : box.bottom;
  return a.x >= box.left && a.x <= box.right && Math.abs(a.y - edge) <= 1 &&
    (to.y - a.y) * a.ny > 0 && !crosses(a, to, box);
}
function safe(parts: Segment[], source: Port, obstacles: readonly Box[], protectedBoxes: readonly Box[], card: Box): boolean {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!i) {
      if (obstacles.some((box, j) => crosses(part.from, part.to, protectedBoxes[j]) && !sourceContact(source, part.to, box))) return false;
    } else if (part.control ? !clearCurve(part.from, part.control, part.to, protectedBoxes) : !clearLine(part.from, part.to, protectedBoxes)) return false;
    // Do not take a shortcut through the card to arrive at its far edge.
    if (part.control ? !clearCurve(part.from, part.control, part.to, [card]) : !clearLine(part.from, part.to, [card])) return false;
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
  const obstacles = [...(options.obstacles ?? []), ...sources.map(s => s.box)]
    .filter(box => validBox(box) && box.bottom + padding > minY && box.top - padding < maxY);
  const protectedBoxes = obstacles.map(box => padded(box, padding));
  const lead = padding + 0.5, targets = ports(cardBox);
  const body = options.body ?? {
    left: Math.min(...sources.map(s => s.box.left)), right: Math.max(...sources.map(s => s.box.right)), top: 0, bottom: 0
  };
  const rightSide = (cardBox.left + cardBox.right) / 2 >= (body.left + body.right) / 2;
  const corridor = rightSide ? body.right + padding + 2 : body.left - padding - 2;
  let best: Connector | undefined, bestScore = Infinity;
  for (const { box, fragment } of sources) for (const a of ports(box).filter(port => !!port.ny)) {
    for (const extra of [0, 3, 7]) {
      const escape = { x: a.x, y: a.y + a.ny * (lead + extra) };
      for (const b of targets) {
        const approach = { x: b.x + b.nx * lead, y: b.y + b.ny * lead };
        const candidates = [
          [a, escape, approach, b],
          [a, escape, { x: corridor, y: escape.y }, { x: corridor, y: approach.y }, approach, b]
        ];
        // Elbows keep every leg orthogonal. Other styles may use the short
        // direct span when it has verified whitespace all the way to the card.
        if (style === 'elbow') candidates[0] = [a, escape, { x: approach.x, y: escape.y }, approach, b];
        for (const candidate of candidates) {
          const points = clean(candidate);
          for (const radius of style === 'curve' ? [8, 3, 0] : [0]) {
            const parts = segments(points, radius);
            if (!safe(parts, a, obstacles, protectedBoxes, cardBox)) continue;
            let score = parts.reduce((sum, s) => sum + distance(s.from, s.to), 0) + parts.length * 0.2;
            if (previous?.fragment === fragment && previous.source === a.edge && previous.target === b.edge) score -= 4;
            if (score < bestScore) { bestScore = score; best = { path: pathFor(parts), choice: { fragment, source: a.edge, target: b.edge } }; }
            break;
          }
        }
      }
    }
  }
  return best;
}
