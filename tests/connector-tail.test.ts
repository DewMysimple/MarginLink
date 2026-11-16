import { describe, expect, it } from 'vitest';
import { connectorRoute } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';
const source = { left: 420, right: 492, top: 120, bottom: 140 };
const body = { left: 180, right: 820, top: 0, bottom: 600 };
function linePoints(path: string) {
  return [...path.matchAll(/([ML])\s+(-?[\d.e]+)\s+(-?[\d.e]+)/g)].map(([, , x, y]) => ({ x: Number(x), y: Number(y) }));
}
describe('clean normal entry at card edges', () => {
  it.each(['straight', 'elbow'] as const)('%s removes the documented three-pixel tail on both sides at all heights', style => {
    for (const x of [48, 856]) for (const y of [30, 88, 200]) for (const lineWidth of [1.5, 5]) {
      const card = { x, y, width: 84, height: 84 };
      const route = connectorRoute([source], card, style, undefined, { body, lineWidth })!;
      const points = linePoints(route.path), last = points.at(-1)!, previous = points.at(-2)!;
      expect(Math.hypot(last.x - previous.x, last.y - previous.y)).toBeGreaterThanOrEqual(Math.max(12, 3 * lineWidth) - 0.001);
      expect(Math.min(Math.abs(last.x - x), Math.abs(last.x - x - 84), Math.abs(last.y - y), Math.abs(last.y - y - 84))).toBeLessThan(0.001);
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1], b = points[i], c = points[i + 1];
        expect(Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x))).toBeGreaterThan(0.001);
      }
      if (style === 'elbow') for (let i = 1; i < points.length; i++) expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
    }
  });
  it.each(['straight', 'elbow', 'curve'] as const)('%s keeps a genuinely short collinear connection clean', style => {
    const text = { left: 100, right: 140, top: 100, bottom: 116 }, card = { x: 110, y: 128, width: 20, height: 20 };
    const route = connectorRoute([text], card, style)!;
    expect(route).toBeDefined();
    const samples = svgSamples(route.path);
    expect(samples[0]).toMatchObject({ x: 120, y: 116 });
    expect(samples.at(-1)).toMatchObject({ x: 120, y: 128 });
    expect(samples.every(p => Math.abs(p.x - 120) < 0.001 && p.y >= 116 && p.y <= 128)).toBe(true);
  });
  it('keeps an equivalent entry port for one-pixel target movement', () => {
    const card = { x: 856, y: 200, width: 84, height: 84 }, route = connectorRoute([source], card, 'elbow', undefined, { body })!;
    for (const delta of [-1, 0, 1]) expect(connectorRoute([source], { ...card, y: card.y + delta }, 'elbow', route.choice, { body })?.choice).toEqual(route.choice);
  });
});
