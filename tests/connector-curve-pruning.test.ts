import { describe, expect, it } from 'vitest';
import { clearConnectorSegments, connectorRoute, type Segment } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';

describe('curve routing pruning preserves real geometric exits', () => {
  it('retains a collinear card closer than the ordinary minimum normal lead', () => {
    const source = { left: 100, right: 140, top: 100, bottom: 116 };
    const card = { x: 110, y: 116.05, width: 20, height: 20 };
    const route = connectorRoute([source], card, 'curve')!;
    expect(route).toBeDefined();
    expect(route.choice).toEqual({ fragment: 0, source: 'bottom', target: 'top' });
    expect(route.segments).toEqual([{ from: expect.objectContaining({ x: 120, y: 116 }), to: expect.objectContaining({ x: 120, y: 116.05 }) }]);
    expect(clearConnectorSegments(route.segments, [source], card)).toBe(true);
  });

  it('allows a rounded arc to turn before a blocked nominal escape point', () => {
    const source = { left: 400, right: 440, top: 100, bottom: 116 };
    const card = { x: 900, y: 80, width: 84, height: 84 };
    const obstacles = [
      // The 1.5px-padded right edge is only .0001px right of the source
      // midpoint. A small genuine round clears it before the nominal escape.
      { left: 300, right: 418.5001, top: 80, bottom: 96.85 },
      { left: 180, right: 820, top: 116, bottom: 160 }
    ];
    const options = { body: { left: 180, right: 820, top: 0, bottom: 300 }, obstacles, lineWidth: 2, clearance: .5 };
    const route = connectorRoute([source], card, 'curve', undefined, options)!;
    expect(route).toBeDefined();
    expect(route.choice.source).toBe('top');
    expect(route.segments.some(part => part.control)).toBe(true);
    expect(clearConnectorSegments(route.segments, [source], card, options)).toBe(true);
    // Independently check the complete stroked arc against the padded corner.
    for (const point of svgSamples(route.path).filter(point => point.command > 1)) {
      expect(obstacles.some(box => point.x > box.left - 1.5 + .00001 && point.x < box.right + 1.5 - .00001 &&
        point.y > box.top - 1.5 + .00001 && point.y < box.bottom + 1.5 - .00001)).toBe(false);
    }
  });

  it.each(['obstacles', 'cardObstacles'] as const)('rejects a blocked terminal straight leg in %s after a smooth middle', kind => {
    const source = { left: 100, right: 140, top: 100, bottom: 116 };
    const card = { x: 500, y: 70, width: 84, height: 84 };
    const parts: Segment[] = [
      { from: { x: 120, y: 100 }, to: { x: 120, y: 97.5 } },
      { from: { x: 120, y: 97.5 }, control: { x: 120, y: 30 }, control2: { x: 488, y: 30 }, to: { x: 488, y: 112 } },
      { from: { x: 488, y: 112 }, to: { x: 500, y: 112 } }
    ];
    expect(clearConnectorSegments(parts, [source], card)).toBe(true);
    expect(clearConnectorSegments(parts, [source], card, { [kind]: [{ left: 492, right: 495, top: 110, bottom: 114 }] })).toBe(false);
  });
});
