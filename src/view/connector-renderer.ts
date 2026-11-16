import type { Box, LineStyle } from '../types';
import type { Placement } from './layout-engine';

type Edge = 'top' | 'right' | 'bottom' | 'left';
interface Point { x: number; y: number }
interface Port extends Point { edge: Edge; nx: number; ny: number }
export interface PortChoice { fragment: number; source: Edge; target: Edge }
interface Connector { path: string; choice: PortChoice }

function ports(box: Box): Port[] {
  const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
  return [
    { edge: 'left', x: box.left, y, nx: -1, ny: 0 },
    { edge: 'right', x: box.right, y, nx: 1, ny: 0 },
    { edge: 'top', x, y: box.top, nx: 0, ny: -1 },
    { edge: 'bottom', x, y: box.bottom, nx: 0, ny: 1 }
  ];
}

// The point pair must face into the gap at both ends. For an elbow this
// produces either a pair of opposite ports or one unambiguous 90-degree turn.
function geometry(a: Port, b: Port, style: LineStyle, outward: number, inward: number) {
  const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  const start = `M ${a.x} ${a.y}`;
  if (style === 'straight') return { path: `${start} L ${b.x} ${b.y}`, points: [a, b] };
  if (style === 'elbow') {
    if (a.nx && b.nx) return { path: `${start} H ${midX} V ${b.y} H ${b.x}`, points: [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b] };
    if (a.ny && b.ny) return { path: `${start} V ${midY} H ${b.x} V ${b.y}`, points: [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b] };
    return a.nx
      ? { path: `${start} H ${b.x} V ${b.y}`, points: [a, { x: b.x, y: a.y }, b] }
      : { path: `${start} V ${b.y} H ${b.x}`, points: [a, { x: a.x, y: b.y }, b] };
  }
  const c = { x: a.x + a.nx * outward / 2, y: a.y + a.ny * outward / 2 };
  const d = { x: b.x + b.nx * inward / 2, y: b.y + b.ny * inward / 2 };
  const points: Point[] = [a];
  for (let i = 1; i < 8; i++) {
    const t = i / 8, u = 1 - t;
    points.push({
      x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * b.x,
      y: u ** 3 * a.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t ** 3 * b.y
    });
  }
  points.push(b);
  return { path: `${start} C ${c.x} ${c.y}, ${d.x} ${d.y}, ${b.x} ${b.y}`, points };
}

// Clip the segment to the open interior; touching a text boundary is valid.
function crosses(a: Point, b: Point, box: Box) {
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

export function connectorRoute(fragments: Box[], card: Pick<Placement, 'x' | 'y' | 'width' | 'height'>,
  style: LineStyle = 'curve', previous?: PortChoice): Connector | undefined {
  const targets = ports({ left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height });
  let best: Connector | undefined, bestScore = Infinity, bestCrossings = Infinity;
  for (const [fragment, box] of fragments.entries()) {
    for (const a of ports(box)) for (const b of targets) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const outward = dx * a.nx + dy * a.ny, inward = -dx * b.nx - dy * b.ny;
      if (!(outward > 0 && inward > 0) || !Number.isFinite(outward + inward)) continue;
      const { path, points } = geometry(a, b, style, outward, inward);
      const crossings = fragments.filter((other, i) => i !== fragment &&
        points.some((p, j) => j > 0 && crosses(points[j - 1], p, other))).length;
      let score = 0;
      for (let i = 1; i < points.length; i++) score += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (style === 'elbow' && dx !== 0 && dy !== 0) score += points.length - 2;
      if (previous?.fragment === fragment && previous.source === a.edge && previous.target === b.edge) score -= 4;
      if (crossings < bestCrossings || (crossings === bestCrossings && score < bestScore)) {
        bestScore = score; bestCrossings = crossings;
        best = { path, choice: { fragment, source: a.edge, target: b.edge } };
      }
    }
  }
  return best;
}
