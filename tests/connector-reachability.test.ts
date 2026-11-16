import { describe, expect, it } from 'vitest';
import { connectorRoute, clearConnectorSegments } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';
const source = { left: 100, right: 140, top: 100, bottom: 116 };
const card = { x: 500, y: 70, width: 84, height: 84 };
const body = { left: 20, right: 400, top: 0, bottom: 300 };
const wall = { left: 160, right: 180, top: 60, bottom: 160 };
const options = { body, obstacles: [wall], lineWidth: 2 };
const styles = ['straight', 'elbow', 'curve'] as const;
const inside = (p: { x: number; y: number }, b: typeof source, radius = 0) => p.x > b.left - radius + .001 && p.x < b.right + radius - .001 && p.y > b.top - radius + .001 && p.y < b.bottom + radius - .001;
describe('obstacle-edge route search after cheap candidates fail', () => {
  it.each(styles)('connects the documented formerly missing %s route', style => {
    const route = connectorRoute([source], card, style, undefined, options);
    expect(route).toBeDefined();
    const samples = svgSamples(route!.path);
    expect(samples[0].x).toBe(120); expect([100, 116]).toContain(samples[0].y);
    expect(samples.at(-1)).toMatchObject({ x: route!.segments.at(-1)!.to.x, y: route!.segments.at(-1)!.to.y });
    expect(samples.some(p => inside(p, wall, 2.5))).toBe(false);
    expect(samples.some(p => inside(p, source))).toBe(false);
    expect(clearConnectorSegments(route!.segments, [source], card, options)).toBe(true);
  });
  it('uses a reachable obstacle edge rather than a fixed exit distance', () => {
    for (const height of [60, 95, 180]) {
      const obstacle = { ...wall, top: 40, bottom: 40 + height };
      const route = connectorRoute([source], card, 'elbow', undefined, { ...options, obstacles: [obstacle] })!;
      expect(route).toBeDefined();
      expect(svgSamples(route.path).some(p => inside(p, obstacle, 2.5))).toBe(false);
    }
  });
  it('protects other cards independently of the controlled source contact', () => {
    const other = { left: 300, right: 390, top: 0, bottom: 170 };
    const route = connectorRoute([source], card, 'elbow', undefined, { ...options, cardObstacles: [other] })!;
    expect(route).toBeDefined();
    expect(svgSamples(route.path).some(p => inside(p, other, 2.5))).toBe(false);
  });
  it.each(styles)('reports genuinely closed exits for %s and recovers when the tunnel opens', style => {
    const above = { left: 80, right: 155, top: 80, bottom: 100 }, below = { left: 80, right: 155, top: 116, bottom: 138 };
    expect(connectorRoute([source], card, style, undefined, { ...options, obstacles: [above, below] })).toBeUndefined();
    expect(connectorRoute([source], card, style, undefined, { ...options, obstacles: [below] })).toBeDefined();
  });
  it('cannot count a detour outside the current draw area as a visible connection', () => {
    expect(connectorRoute([source], card, 'elbow', undefined, { ...options, bounds: { left: 0, right: 600, top: 80, bottom: 140 } })).toBeUndefined();
    expect(connectorRoute([source], card, 'elbow', undefined, { ...options, bounds: { left: 0, right: 600, top: 0, bottom: 220 } })).toBeDefined();
  });
});
