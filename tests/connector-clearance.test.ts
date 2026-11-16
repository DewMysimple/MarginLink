import { describe, expect, it } from 'vitest';
import { connectorRoute, clearConnectorSegments } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';

const source = { left: 420, right: 492, top: 120, bottom: 140 };
const body = { left: 180, right: 820, top: 0, bottom: 600 };
const card = { x: 48, y: 70, width: 84, height: 84 };
const rows = (gap: number) => [
  { left: 180, right: 820, top: 100 - gap, bottom: 120 - gap },
  { left: 180, right: 820, top: 120, bottom: 140 },
  { left: 180, right: 820, top: 140 + gap, bottom: 160 + gap }
];
const inside = (p: { x: number; y: number }, b: typeof source, radius: number) =>
  p.x > b.left - radius + .001 && p.x < b.right + radius - .001 &&
  p.y > b.top - radius + .001 && p.y < b.bottom + radius - .001;

describe('explicit compact whitespace budget for dense visual rows', () => {
  it.each(['straight', 'elbow', 'curve'] as const)('%s uses a real narrow lane without shrinking any text rectangle', style => {
    const obstacles = rows(3.5), options = { body, obstacles, lineWidth: 2, minimumClearance: .5 };
    const snapshot = structuredClone({ obstacles, card, source });
    expect(connectorRoute([source], card, style, undefined, { ...options, minimumClearance: undefined })).toBeUndefined();
    const route = connectorRoute([source], card, style, undefined, options);
    expect(route).toBeDefined();
    expect(route!.clearance).toBe(.5);
    expect(clearConnectorSegments(route!.segments, [source], card, { ...options, clearance: route!.clearance })).toBe(true);
    // Independent sampling checks the full rendered width, plus a real .5px
    // gap, rather than checking a conveniently smaller glyph approximation.
    for (const p of svgSamples(route!.path).filter(p => p.command > 1)) {
      expect(obstacles.some(b => inside(p, b, 1.5))).toBe(false);
    }
    expect({ obstacles, card, source }).toEqual(snapshot);
  });

  it('retains the preferred generous gap whenever it has a safe complete route', () => {
    const route = connectorRoute([source], card, 'elbow', undefined,
      { body, obstacles: rows(10), lineWidth: 2, minimumClearance: .5 });
    expect(route).toBeDefined();
    expect(route!.clearance).toBe(1.5);
  });

  it.each(['straight', 'elbow'] as const)('%s fits the actual highlighted stroke exactly between 3.5px rows', style => {
    const options = { body, obstacles: rows(3.5), lineWidth: 2.5, minimumClearance: .5 };
    const route = connectorRoute([source], card, style, undefined, options);
    expect(route).toBeDefined();
    expect(route!.clearance).toBe(.5);
    expect(clearConnectorSegments(route!.segments, [source], card, { ...options, clearance: .5 })).toBe(true);
    for (const p of svgSamples(route!.path).filter(p => p.command > 1)) {
      expect(options.obstacles.some(b => inside(p, b, 1.75))).toBe(false);
    }
  });

  it.each([0, 1, 2.9])('keeps a %spx closed lane blocked instead of crossing text', gap => {
    expect(connectorRoute([source], card, 'elbow', undefined,
      { body, obstacles: rows(gap), lineWidth: 2, minimumClearance: .5 })).toBeUndefined();
  });

  it('cannot override an explicit larger minimum or a thicker visible stroke', () => {
    expect(connectorRoute([source], card, 'elbow', undefined,
      { body, obstacles: rows(3.5), lineWidth: 2, minimumClearance: 1.5 })).toBeUndefined();
    expect(connectorRoute([source], card, 'elbow', undefined,
      { body, obstacles: rows(3.5), lineWidth: 5, minimumClearance: .5 })).toBeUndefined();
  });
});
