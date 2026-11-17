import { describe, expect, it } from 'vitest';
import type { Box } from '../src/types';
import { connectorRoute, type ConnectorOptions } from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';

const body = { left: 164, right: 864, top: 0, bottom: 710 };
const mirror = (box: Box): Box => ({ ...box, left: 1028 - box.right, right: 1028 - box.left });
const inside = (point: { x: number; y: number }, box: Box, padding: number) =>
  point.x > box.left - padding + .001 && point.x < box.right + padding - .001 &&
  point.y > box.top - padding + .001 && point.y < box.bottom + padding - .001;

describe('curved connections follow nearby whitespace without decorative detours', () => {
  it.each(['right', 'left'] as const)('%s nearly level endpoints use the nearby horizontal lane instead of a large arch', side => {
    const original = {
      source: { left: 430, right: 490, top: 296, bottom: 311 },
      card: { x: 880, y: 273, width: 84, height: 84 },
      obstacles: [
        { left: 164, right: 810, top: 296, bottom: 311 },
        { left: 164, right: 840, top: 252, bottom: 267 }
      ]
    };
    const source = side === 'right' ? original.source : mirror(original.source);
    const card = side === 'right' ? original.card : { ...original.card, x: 64 };
    const obstacles = side === 'right' ? original.obstacles : original.obstacles.map(mirror);
    const options: ConnectorOptions = { body, obstacles, bounds: { left: 0, right: 1028, top: 0, bottom: 710 } };
    const snapshot = structuredClone({ source, card, options });
    const route = connectorRoute([source], card, 'curve', undefined, options)!;
    expect(route).toBeDefined();
    expect(route.choice.target).toBe(side === 'right' ? 'left' : 'right');
    const samples = svgSamples(route.path);
    expect(Math.min(...samples.map(point => point.y))).toBeGreaterThanOrEqual(source.top - 8);
    expect(Math.max(...samples.map(point => point.y))).toBeLessThanOrEqual(source.bottom + 8);
    // Inspect the actual SVG: rounded bends may be curved, but the long lane
    // between text and card stays horizontal instead of slicing diagonally.
    expect(route.segments.filter(part => !part.control && Math.hypot(part.to.x - part.from.x, part.to.y - part.from.y) > 24)
      .every(part => part.from.x === part.to.x || part.from.y === part.to.y)).toBe(true);
    expect(samples.filter(point => point.command > 1).some(point => obstacles.some(box => inside(point, box, 2.25)))).toBe(false);
    expect({ source, card, options }).toEqual(snapshot);
  });

  it('leaves a blocked lower exit through the upper row gap without bowing over the heading', () => {
    const source = { left: 347, right: 388, top: 139, bottom: 158 };
    const card = { x: 64, y: 115, width: 84, height: 84 };
    const obstacles = [
      { left: 164, right: 290, top: 90, bottom: 113 },
      { left: 164, right: 810, top: 139, bottom: 158 },
      { left: 164, right: 340, top: 161, bottom: 176 }
    ];
    const route = connectorRoute([source], card, 'curve', undefined, { body, obstacles })!;
    expect(route).toBeDefined();
    expect(route.choice.source).toBe('top');
    expect(route.choice.target).toBe('right');
    const samples = svgSamples(route.path);
    expect(Math.min(...samples.map(point => point.y))).toBeGreaterThan(130);
    expect(samples.filter(point => point.command > 1).some(point => obstacles.some(box => inside(point, box, 2.25)))).toBe(false);
  });

  it('enters the inner card edge through a narrow margin instead of looping underneath a stack', () => {
    const source = { left: 593, right: 628, top: 482, bottom: 497 };
    const card = { x: 880, y: 554, width: 84, height: 84 };
    const obstacles = [
      { left: 164, right: 800, top: 482, bottom: 497 },
      { left: 164, right: 800, top: 506, bottom: 521 },
      { left: 164, right: 850, top: 458, bottom: 473 }
    ];
    const neighbour = { left: 880, right: 964, top: 460, bottom: 544 };
    const route = connectorRoute([source], card, 'curve', undefined, { body, obstacles, cardObstacles: [neighbour] })!;
    expect(route).toBeDefined();
    expect(route.choice.target).toBe('left');
    const samples = svgSamples(route.path);
    expect(Math.max(...samples.map(point => point.y))).toBeLessThanOrEqual(card.y + card.height / 2);
    expect(samples.some(point => inside(point, neighbour, 2.25))).toBe(false);
    expect(samples.filter(point => point.command > 1).some(point => obstacles.some(box => inside(point, box, 2.25)))).toBe(false);
  });

  it.each([48, 856])('retains a relaxed smooth transition in open space at x=%s', x => {
    const source = { left: 420, right: 492, top: 120, bottom: 140 };
    const card = { x, y: 350, width: 84, height: 84 };
    const route = connectorRoute([source], card, 'curve', undefined, { body })!;
    const cubic = route.segments.find(part => part.control2)!;
    expect(cubic).toBeDefined();
    expect(Math.hypot(cubic.control!.x - cubic.from.x, cubic.control!.y - cubic.from.y)).toBeGreaterThan(60);
    expect(Math.hypot(cubic.control2!.x - cubic.to.x, cubic.control2!.y - cubic.to.y)).toBeGreaterThan(60);
    const samples = svgSamples(route.path);
    expect(samples.filter(point => point.command > 1).some(point => inside(point, source, 2.25))).toBe(false);
  });
});
