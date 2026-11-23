import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineStyle } from '../src/types';
import { connectorBatch, ConnectorRouteCache, type BatchRelationInput, type ConnectorBatch } from '../src/view/connector-batch';
import * as renderer from '../src/view/connector-renderer';
import { svgSamples } from './svg-path';

const body = { left: 180, right: 820, top: 0, bottom: 650 };
const bounds = { left: 0, right: 1000, top: 0, bottom: 650 };
const obstacles = [120, 150, 180, 210, 240, 270, 300, 330, 360].map(top => ({ left: 180, right: 820, top, bottom: top + 20 }));
const inputs: BatchRelationInput[] = [
  { key: 'ship', fragments: [{ left: 700, right: 740, top: 300, bottom: 320 }], card: { x: 856, y: 260, width: 84, height: 84, side: 'right' } },
  { key: 'dives', fragments: [{ left: 500, right: 540, top: 180, bottom: 200 }], card: { x: 856, y: 390, width: 84, height: 84, side: 'right' } }
];
const options = { body, bounds, obstacles, lineWidth: 2, optimizeShared: false };
const styles: LineStyle[] = ['straight', 'elbow', 'curve'];
function leaveCoverage(style: LineStyle = 'curve') {
  const cache = new ConnectorRouteCache();
  const before = connectorBatch(inputs, style, options, undefined, cache); cache.remember(before);
  const empty = connectorBatch([], style, options, before, cache); cache.remember(empty);
  return { cache, before, empty };
}
afterEach(() => vi.restoreAllMocks());

describe('bounded per-view offscreen route hints', () => {
  it.each(styles)('%s returns through empty coverage without solving or emitting cached offscreen strokes', style => {
    const { cache, before, empty } = leaveCoverage(style);
    expect(empty.relations.size).toBe(0); expect(empty.segments).toEqual([]); expect(cache.size).toBe(2);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const returned = connectorBatch(inputs, style, options, empty, cache);
    expect(returned.relations.size).toBe(2); expect(solve).not.toHaveBeenCalled();
    for (const [key, relation] of returned.relations) expect(relation.connector.points).toBe(before.relations.get(key)!.connector.points);
  });

  it('applies an exact section translation to safe offscreen hints before returning', () => {
    const { cache, before, empty } = leaveCoverage(), dy = .3125;
    const shifted = inputs.map(input => ({ ...input, fragments: input.fragments.map(box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })),
      card: { ...input.card, y: input.card.y + dy } }));
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const returned = connectorBatch(shifted, 'curve', { ...options,
      obstacles: obstacles.map(box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })) }, empty, cache);
    expect(returned.relations.size).toBe(2); expect(solve).not.toHaveBeenCalled();
    for (const [key, relation] of returned.relations) expect(relation.connector.points).toEqual(before.relations.get(key)!.connector.points.map(point => ({ x: point.x, y: point.y + dy })));
  });

  it('solves only a genuinely moved card when returning through cached routes', () => {
    const { cache, before, empty } = leaveCoverage();
    const moved = inputs.map(input => input.key === 'ship' ? { ...input, card: { ...input.card, y: input.card.y + .5 } } : input);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const returned = connectorBatch(moved, 'curve', options, empty, cache);
    expect(solve).toHaveBeenCalledTimes(1); expect(solve.mock.calls[0][1]).toBe(moved[0].card);
    expect(returned.relations.get('dives')!.connector.points).toBe(before.relations.get('dives')!.connector.points);
  });

  it('rejects a cached curve intersected by a newly measured obstacle', () => {
    const { cache, before, empty } = leaveCoverage();
    const point = svgSamples(before.relations.get('ship')!.path).find(point => point.x > 760 && point.x < 800 && point.y > 285 && point.y < 335)!;
    const blocker = { left: point.x - 2, right: point.x + 2, top: point.y - 2, bottom: point.y + 2 };
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const environment = { ...options, obstacles: [...obstacles, blocker] };
    const returned = connectorBatch(inputs, 'curve', environment, empty, cache);
    expect(solve).toHaveBeenCalledTimes(1); expect(returned.relations.size).toBe(2);
    for (const input of inputs) {
      const connector = returned.relations.get(input.key)!.connector;
      expect(renderer.clearConnectorSegments(connector.segments, input.fragments, input.card, { ...environment, clearance: connector.clearance })).toBe(true);
    }
  });

  it.each([{ style: 'straight' as const, lineWidth: 2 }, { style: 'curve' as const, lineWidth: 3 }])('rejects cached geometry for new style/width %j', change => {
    const { cache, empty } = leaveCoverage();
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const returned = connectorBatch(inputs, change.style, { ...options, lineWidth: change.lineWidth }, empty, cache);
    expect(solve).toHaveBeenCalledTimes(2); expect(returned.relations.size).toBe(2);
    if (change.style === 'straight') expect(returned.segments.some(segment => /[QC]/.test(segment.path))).toBe(false);
  });

  it('checks current bounds rather than emitting an old offscreen hint through the clip', () => {
    const { cache, before, empty } = leaveCoverage();
    const next = inputs.map(input => input.key === 'ship' ? { ...input, bounds: { ...bounds, right: 850 } } : input);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const returned = connectorBatch(next, 'curve', options, empty, cache);
    expect(solve).toHaveBeenCalledTimes(1); expect(returned.relations.has('ship')).toBe(false);
    expect(returned.relations.get('dives')!.connector.points).toBe(before.relations.get('dives')!.connector.points);
  });

  it('retries a failed uncached route when a passage becomes available', () => {
    const cache = new ConnectorRouteCache();
    const blocked = connectorBatch(inputs, 'curve', { ...options, obstacles: [{ ...bounds }] }, undefined, cache); cache.remember(blocked);
    expect(blocked.relations.size).toBe(0); expect(cache.size).toBe(0);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const returned = connectorBatch(inputs, 'curve', options, blocked, cache);
    expect(solve).toHaveBeenCalledTimes(2); expect(returned.relations.size).toBe(2);
  });

  it('limits successful hints to 100, refreshes active entries and leaves get read-only', () => {
    const relation = connectorBatch([inputs[0]], 'curve', options).relations.get('ship')!;
    const batch = (...keys: string[]): ConnectorBatch => ({ segments: [], corridors: {}, sharedCount: 0,
      relations: new Map(keys.map(key => [key, { ...relation, key }])) });
    const cache = new ConnectorRouteCache();
    cache.remember(batch(...Array.from({ length: 100 }, (_, index) => String(index))));
    expect(cache.size).toBe(100); expect(cache.get('0')).toBeDefined();
    cache.remember(batch('100'));
    expect(cache.size).toBe(100); expect(cache.get('0')).toBeUndefined();
    cache.remember(batch('1')); cache.remember(batch('101'));
    expect(cache.size).toBe(100); expect(cache.get('1')).toBeDefined(); expect(cache.get('2')).toBeUndefined();
    expect(Object.keys(cache.get('1')!).sort()).toEqual(['connector', 'fingerprint', 'originX', 'originY']);
    cache.clear(); expect(cache.size).toBe(0); expect(cache.get('1')).toBeUndefined();
  });

  it.each([0, -1])('handles a disabled capacity of %s without retaining entries or looping', limit => {
    const cache = new ConnectorRouteCache(limit);
    cache.remember(connectorBatch(inputs, 'curve', options));
    expect(cache.size).toBe(0); expect(cache.get('ship')).toBeUndefined();
    cache.clear(); expect(cache.size).toBe(0);
  });
});
