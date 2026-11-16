import { describe, expect, it } from 'vitest';
import type { Box } from '../src/types';
import { connectorRoute, clearConnectorSegments } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';

const source = { left: 400, right: 450, top: 300, bottom: 318 };
const card = { x: 80, y: 420, width: 84, height: 84 };
const body = { left: 220, right: 820, top: 0, bottom: 700 };
const bounds = { left: 0, right: 1000, top: 0, bottom: 700 };
const wall = { left: 270, right: 290, top: 280, bottom: 420 };
const inside = (p: { x: number; y: number }, box: Box, padding: number) =>
  p.x > box.left - padding + .001 && p.x < box.right + padding - .001 &&
  p.y > box.top - padding + .001 && p.y < box.bottom + padding - .001;

describe('connector search prefers coherent low-turn routes', () => {
  // The old position-only Manhattan search returned seven corners, even
  // though this unobstructed one-corner route has the same total length.
  const obstacles = [
    { left: 552, right: 576, top: 379, bottom: 402 },
    { left: 512, right: 607, top: 368, bottom: 409 },
    { left: 537, right: 583, top: 351, bottom: 369 },
    { left: 345, right: 411, top: 392, bottom: 412 }, wall
  ];
  it.each(['straight', 'elbow'] as const)('%s does not turn equal-length search coordinates into stairs', style => {
    for (const lineWidth of [1.5, 5.5]) for (const boxes of [obstacles, [...obstacles].reverse()]) {
      const options = { body, bounds, obstacles: boxes, lineWidth };
      const route = connectorRoute([source], card, style, undefined, options)!;
      expect(route).toBeDefined();
      expect(route.points).toHaveLength(3);
      expect(route.points[0]).toMatchObject({ x: 425, y: 318 });
      expect(route.points[1]).toEqual({ x: 425, y: 462 });
      expect(route.points[2]).toMatchObject({ x: 164, y: 462 });
      expect(clearConnectorSegments(route.segments, [source], card, options)).toBe(true);
      for (const sample of svgSamples(route.path)) expect(boxes.some(b => inside(sample, b, lineWidth / 2 + 1.5))).toBe(false);
    }
  });

  it('shortcuts the searched middle span in straight mode while retaining both normal leads', () => {
    const boxes = [
      { left: 418, right: 535, top: 463, bottom: 486 },
      { left: 523, right: 627, top: 386, bottom: 423 }, wall
    ];
    for (const lineWidth of [1.5, 5.5]) {
      const options = { body, bounds, obstacles: boxes, lineWidth };
      const route = connectorRoute([source], card, 'straight', undefined, options)!;
      expect(route).toBeDefined();
      expect(route.points.length).toBeLessThanOrEqual(4);
      const first = route.segments[0], last = route.segments.at(-1)!;
      expect(first.from.x).toBe(first.to.x);
      expect(first.to.y).toBeGreaterThan(first.from.y);
      expect(last.from.y).toBe(last.to.y);
      expect(last.from.x - last.to.x).toBeGreaterThanOrEqual(12);
      expect(route.segments.some(s => s.from.x !== s.to.x && s.from.y !== s.to.y)).toBe(true);
      expect(clearConnectorSegments(route.segments, [source], card, options)).toBe(true);
      for (const sample of svgSamples(route.path)) expect(boxes.some(b => inside(sample, b, lineWidth / 2 + 1.5))).toBe(false);

      const elbow = connectorRoute([source], card, 'elbow', undefined, options)!;
      expect(elbow.points.length).toBeLessThanOrEqual(5);
      expect(elbow.segments.every(s => s.from.x === s.to.x || s.from.y === s.to.y)).toBe(true);
      expect(clearConnectorSegments(elbow.segments, [source], card, options)).toBe(true);
    }
  });

  it('checks curved excursions against text beyond the source/card envelope', () => {
    const fragment = { left: 420, right: 492, top: 120, bottom: 140 };
    const target = { x: 856, y: 80, width: 84, height: 84 };
    // This row sits above both endpoints. A former cheap cubic bowed upward
    // through it, while endpoint-only obstacle pruning incorrectly accepted it.
    const above = { left: 498, right: 510, top: 55, bottom: 65 };
    const options = { body, obstacles: [above], lineWidth: 1.5 };
    const route = connectorRoute([fragment], target, 'curve', undefined, options)!;
    expect(route).toBeDefined();
    expect(route.segments.some(s => s.control)).toBe(true);
    expect(clearConnectorSegments(route.segments, [fragment], target, options)).toBe(true);
    expect(svgSamples(route.path).some(p => inside(p, above, 2.25))).toBe(false);
  });
});
