import { describe, expect, it } from 'vitest';
import type { Box, LineStyle } from '../src/types';
import { connectorRoute } from '../src/view/connector-renderer';

// Independent SVG evaluator: assertions inspect the emitted path itself, not
// the router's candidate points or its collision helper.
function samples(path: string): { x: number; y: number; command: number }[] {
  const commands = [...path.matchAll(/([MLQ])\s+([^MLQ]+)/g)];
  let current = { x: 0, y: 0 };
  const points: { x: number; y: number; command: number }[] = [];
  commands.forEach(([, command, numbers], index) => {
    const values = numbers.trim().split(/[\s,]+/).map(Number);
    if (command === 'M') { current = { x: values[0], y: values[1] }; points.push({ ...current, command: index }); return; }
    const end = command === 'Q' ? { x: values[2], y: values[3] } : { x: values[0], y: values[1] };
    const control = { x: values[0], y: values[1] };
    const steps = Math.ceil(Math.hypot(current.x - end.x, current.y - end.y) * 5) + 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      points.push({
        x: command === 'Q' ? u * u * current.x + 2 * u * t * control.x + t * t * end.x : current.x + (end.x - current.x) * t,
        y: command === 'Q' ? u * u * current.y + 2 * u * t * control.y + t * t * end.y : current.y + (end.y - current.y) * t,
        command: index
      });
    }
    current = end;
  });
  expect(points.every(p => Number.isFinite(p.x + p.y))).toBe(true);
  return points;
}
function inside(p: { x: number; y: number }, box: Box, padding = 0): boolean {
  return p.x > box.left - padding + 0.001 && p.x < box.right + padding - 0.001 &&
    p.y > box.top - padding + 0.001 && p.y < box.bottom + padding - 0.001;
}
const source = { left: 420, right: 492, top: 120, bottom: 140 };
const body = { left: 180, right: 820, top: 0, bottom: 600 };
const text = [
  { left: 180, right: 820, top: 90, bottom: 110 },
  { left: 180, right: 820, top: 120, bottom: 140 },
  { left: 180, right: 800, top: 150, bottom: 170 },
  { left: 180, right: 820, top: 180, bottom: 208 }
];
const styles: LineStyle[] = ['straight', 'elbow', 'curve'];

describe('text-safe connector routing', () => {
  it.each(styles)('%s completes both same-height margin routes from top/bottom midpoints', style => {
    for (const x of [48, 856]) for (const lineWidth of [1, 5]) {
      const card = { x, y: 88, width: 84, height: 84 };
      const route = connectorRoute([source], card, style, undefined, { body, obstacles: text, lineWidth });
      expect(route).toBeDefined();
      const points = samples(route!.path), start = points[0];
      expect(start.x).toBe(456);
      expect([120, 140]).toContain(start.y);
      expect(route!.choice.source).toBe(start.y === 120 ? 'top' : 'bottom');
      expect(points[1].x).toBe(start.x);
      for (const p of points) expect(text.some(box => inside(p, box))).toBe(false);
      // Only the initial, perpendicular contact lead is exempt from the
      // line-radius plus 1.5 px whitespace around rendered text.
      for (const p of points.filter(p => p.command > 1)) expect(text.some(box => inside(p, box, lineWidth / 2 + 1.5))).toBe(false);
      const end = points.at(-1)!;
      expect(end.x === x || end.x === x + 84 || end.y === 88 || end.y === 172).toBe(true);
    }
  });
  it.each(styles)('%s avoids a heading beneath a densely linked paragraph', style => {
    const heading = { left: 180, right: 820, top: 150, bottom: 190 };
    const route = connectorRoute([source], { x: 856, y: 300, width: 84, height: 84 }, style, undefined, { body, obstacles: [text[1], heading], lineWidth: 5 })!;
    expect(route).toBeDefined();
    const points = samples(route.path);
    expect(points.some(p => p.y > heading.top && p.y < heading.bottom)).toBe(true);
    expect(points.some(p => inside(p, heading, 4))).toBe(false);
  });
  it.each(styles)('%s routes a wrapped alias from a real fragment', style => {
    const fragments = [source, { left: 180, right: 230, top: 150, bottom: 170 }];
    const route = connectorRoute(fragments, { x: 48, y: 140, width: 84, height: 84 }, style, undefined, { body, obstacles: text })!;
    const start = samples(route.path)[0], fragment = fragments[route.choice.fragment];
    expect(start.x).toBe((fragment.left + fragment.right) / 2);
    expect([fragment.top, fragment.bottom]).toContain(start.y);
    expect(samples(route.path).some(p => fragments.some(box => inside(p, box)))).toBe(false);
  });
  it('omits only the connector when no stroke clearance exists, and restores it when spacing returns', () => {
    const packed = [text[1], { left: 180, right: 820, top: 100, bottom: 120 }, { left: 180, right: 820, top: 140, bottom: 160 }];
    const card = { x: 856, y: 88, width: 84, height: 84 }, original = { ...card };
    expect(connectorRoute([source], card, 'curve', undefined, { body, obstacles: packed, lineWidth: 5 })).toBeUndefined();
    expect(connectorRoute([source], card, 'curve', undefined, { body, obstacles: text, lineWidth: 5 })).toBeDefined();
    expect(card).toEqual(original);
  });
  it('uses actual curve geometry and obeys clearance around an inline-code obstacle', () => {
    const code = { left: 600, right: 700, top: 116, bottom: 144 };
    const route = connectorRoute([source], { x: 856, y: 80, width: 84, height: 84 }, 'curve', undefined,
      { body, obstacles: [text[1], code], lineWidth: 5 })!;
    expect(route).toBeDefined();
    expect(route.path).toContain(' Q ');
    expect(samples(route.path).some(p => inside(p, code, 4))).toBe(false);
  });
  it('does not replace the single-link safety check when no document obstacles were supplied', () => {
    const fragments = [source, { left: 450, right: 500, top: 146, bottom: 166 }];
    const route = connectorRoute(fragments, { x: 856, y: 260, width: 84, height: 84 })!;
    expect(samples(route.path).some(p => fragments.some(box => inside(p, box)))).toBe(false);
  });
});
