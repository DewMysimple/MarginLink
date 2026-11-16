import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Box, LineStyle } from '../src/types';
import * as renderer from '../src/view/connector-renderer';
import { connectorBatch, type BatchRelationInput, type ConnectorBatch } from '../src/view/connector-batch';
import { svgSamples } from './svg-path';

const body = { left: 180, right: 820, top: 0, bottom: 650 };
const obstacles = [120, 150, 180, 210, 240, 270, 300, 330, 360].map(top => ({ left: 180, right: 820, top, bottom: top + 20 }));
const inputs: BatchRelationInput[] = [
  { key: 'ship', fragments: [{ left: 700, right: 740, top: 300, bottom: 320 }], card: { x: 856, y: 30, width: 84, height: 84, side: 'right' } },
  { key: 'dives', fragments: [{ left: 500, right: 540, top: 180, bottom: 200 }], card: { x: 856, y: 390, width: 84, height: 84, side: 'right' } }
];
const options = { body, obstacles, lineWidth: 2, optimizeShared: false };
const styles: LineStyle[] = ['straight', 'elbow', 'curve'];
const inside = (p: { x: number; y: number }, b: Box, padding = 0) =>
  p.x > b.left - padding + .001 && p.x < b.right + padding - .001 && p.y > b.top - padding + .001 && p.y < b.bottom + padding - .001;

function ordered(batch: ConnectorBatch, key: string) {
  const relation = batch.relations.get(key)!;
  expect(relation).toBeDefined();
  const points: { x: number; y: number }[] = [];
  for (const reference of relation.segments) {
    const stroke = batch.segments.find(s => s.id === reference.id)!;
    expect(stroke.members).toContain(key);
    const samples = svgSamples(stroke.path);
    if (reference.reversed) samples.reverse();
    if (points.length) expect(Math.hypot(points.at(-1)!.x - samples[0].x, points.at(-1)!.y - samples[0].y)).toBeLessThan(.001);
    points.push(...samples);
  }
  const full = svgSamples(relation.path);
  expect(Math.hypot(points[0].x - full[0].x, points[0].y - full[0].y)).toBeLessThan(.001);
  expect(Math.hypot(points.at(-1)!.x - full.at(-1)!.x, points.at(-1)!.y - full.at(-1)!.y)).toBeLessThan(.001);
  return points;
}

afterEach(() => vi.restoreAllMocks());

describe('live card movement preserves validated routes without global corridor searches', () => {
  it.each(styles)('%s solves only the moved relation while an unobstructed neighbour retains its route', style => {
    // Put one card near its source row so the two independent routes have no
    // common long trunk. Shared-corridor exploration would otherwise short-cut
    // naturally and would not exercise the work deferred during a gesture.
    const independent = inputs.map(i => i.key === 'ship' ? { ...i, card: { ...i.card, y: 260 } } : i);
    const before = connectorBatch(independent, style, options);
    expect(before.sharedCount).toBe(0);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const moved = independent.map(i => i.key === 'dives' ? { ...i, card: { ...i.card, y: i.card.y + .5 } } : i);
    const during = connectorBatch(moved, style, options, before);
    expect(during.relations.size).toBe(2);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(during.relations.get('ship')!.connector.points).toBe(before.relations.get('ship')!.connector.points);
    for (const input of moved) ordered(during, input.key);
    solve.mockClear();
    connectorBatch(moved, style, { ...options, optimizeShared: true }, during);
    expect(solve.mock.calls.length).toBeGreaterThan(1);
  });

  it('rechecks a stationary curve when a moving card blocks its old path', () => {
    const before = connectorBatch(inputs, 'curve', options);
    const original = before.relations.get('ship')!.connector;
    const point = svgSamples(original.path).find(p => p.x > body.right + 1 && p.x < inputs[0].card.x && p.y > 240 && p.y < 280)!;
    expect(point).toBeDefined();
    const moved = inputs.map(i => i.key === 'dives' ? { ...i, card: { ...i.card, x: point.x - 4, y: point.y - 10, width: 8, height: 20 } } : i);
    const blocker = moved[1].card;
    const box = { left: blocker.x, right: blocker.x + blocker.width, top: blocker.y, bottom: blocker.y + blocker.height };
    expect(svgSamples(original.path).some(p => inside(p, box, 2.5))).toBe(true);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const during = connectorBatch(moved, 'curve', options, before);
    expect(solve).toHaveBeenCalledTimes(2);
    expect(during.relations.has('ship')).toBe(true);
    expect(during.relations.get('ship')!.connector.points).not.toBe(original.points);
    expect(ordered(during, 'ship').some(p => inside(p, box, 2.5))).toBe(false);
  });

  it('retains real shared ink and occurrence order after returning to release optimization', () => {
    const during = connectorBatch(inputs, 'curve', options);
    const released = connectorBatch(inputs, 'curve', { ...options, optimizeShared: true }, during);
    expect(released.sharedCount).toBeGreaterThan(0);
    for (const input of inputs) ordered(released, input.key);
    expect(inputs[0].card).toEqual({ x: 856, y: 30, width: 84, height: 84, side: 'right' });
    expect(inputs[1].card).toEqual({ x: 856, y: 390, width: 84, height: 84, side: 'right' });
  });

  it('drops stale shared membership when a dragged card crosses to the opposite margin', () => {
    const before = connectorBatch(inputs, 'curve', { ...options, optimizeShared: true });
    expect(before.sharedCount).toBeGreaterThan(0);
    const moved = inputs.map(i => i.key === 'dives' ? { ...i, card: { ...i.card, x: 48, side: 'left' as const } } : i);
    const during = connectorBatch(moved, 'curve', options, before);
    expect(during.relations.size).toBe(2);
    expect(during.sharedCount).toBe(0);
    expect(during.segments.every(s => s.members.length === 1)).toBe(true);
    for (const input of moved) ordered(during, input.key);
  });
});
