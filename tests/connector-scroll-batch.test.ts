import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Box, LineStyle } from '../src/types';
import * as renderer from '../src/view/connector-renderer';
import { connectorBatch, type BatchOptions, type BatchRelationInput } from '../src/view/connector-batch';
import { svgSamples } from './svg-path';

const body = { left: 180, right: 820, top: 0, bottom: 650 };
const bounds = { left: 0, right: 1000, top: 0, bottom: 650 };
const obstacles = [120, 150, 180, 210, 240, 270, 300, 330, 360].map(top => ({ left: 180, right: 820, top, bottom: top + 20 }));
const inputs: BatchRelationInput[] = [
  { key: 'ship', fragments: [{ left: 700, right: 740, top: 300, bottom: 320 }], card: { x: 856, y: 260, width: 84, height: 84, side: 'right' } },
  { key: 'dives', fragments: [{ left: 500, right: 540, top: 180, bottom: 200 }], card: { x: 856, y: 390, width: 84, height: 84, side: 'right' } }
];
const options: BatchOptions = { body, bounds, obstacles, lineWidth: 2, optimizeShared: false };
const styles: LineStyle[] = ['straight', 'elbow', 'curve'];
const inside = (point: { x: number; y: number }, box: Box, padding = 0) =>
  point.x > box.left - padding + .001 && point.x < box.right + padding - .001 &&
  point.y > box.top - padding + .001 && point.y < box.bottom + padding - .001;

afterEach(() => vi.restoreAllMocks());

describe('scroll neighbourhood changes revalidate existing routes independently', () => {
  it.each(styles)('%s follows repeated exact subpixel section translations without a new route search', style => {
    const initial = connectorBatch(inputs, style, options);
    let previous = initial;
    const original = new Map([...previous.relations].map(([key, relation]) => [key, relation.connector]));
    const originalJSON = JSON.stringify(previous);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    let offset = 0;
    for (const dy of [.3125, -.1875, -.3125, .1875, .3125]) {
      offset += dy;
      const shifted = inputs.map(input => ({ ...input, fragments: input.fragments.map(box => ({ ...box, top: box.top + offset, bottom: box.bottom + offset })),
        card: { ...input.card, y: input.card.y + offset } }));
      const next = connectorBatch(shifted, style, { ...options,
        obstacles: obstacles.map(box => ({ ...box, top: box.top + offset, bottom: box.bottom + offset })) }, previous);
      expect(next.relations.size).toBe(2);
      for (const [key, relation] of next.relations) {
        const before = original.get(key)!;
        expect(relation.connector.points).toEqual(before.points.map(point => ({ x: point.x, y: point.y + offset })));
        expect(relation.connector.segments).toEqual(before.segments.map(part => ({ ...part,
          from: { x: part.from.x, y: part.from.y + offset }, to: { x: part.to.x, y: part.to.y + offset },
          ...(part.control ? { control: { x: part.control.x, y: part.control.y + offset } } : {}),
          ...(part.control2 ? { control2: { x: part.control2.x, y: part.control2.y + offset } } : {}) })));
        expect(relation.connector.clearance).toBe(before.clearance);
        expect(relation.choice).toEqual(before.choice);
      }
      previous = next;
    }
    expect(solve).not.toHaveBeenCalled();
    expect(JSON.stringify(initial)).toBe(originalJSON);
  });

  it.each(['card', 'fragment'] as const)('rebuilds a %s that does not share the section translation', changed => {
    const before = connectorBatch(inputs, 'curve', options);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const next = inputs.map(input => input.key !== 'ship' ? input : changed === 'card'
      ? { ...input, card: { ...input.card, y: input.card.y + .3125 } }
      : { ...input, fragments: input.fragments.map(box => ({ ...box, top: box.top + .3125, bottom: box.bottom + .3125 })) });
    connectorBatch(next, 'curve', options, before);
    expect(solve).toHaveBeenCalledTimes(1); expect(solve.mock.calls[0][1]).toBe(next[0].card);
  });

  it('rejects a translated curve when a newly measured obstacle intersects it', () => {
    const before = connectorBatch(inputs, 'curve', options), dy = .3125;
    const point = svgSamples(before.relations.get('ship')!.path).find(point => point.x > 760 && point.x < 800 && point.y > 285 && point.y < 335)!;
    const blocker = { left: point.x - 2, right: point.x + 2, top: point.y + dy - 2, bottom: point.y + dy + 2 };
    const next = inputs.map(input => ({ ...input, fragments: input.fragments.map(box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })),
      card: { ...input.card, y: input.card.y + dy } }));
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const after = connectorBatch(next, 'curve', { ...options, obstacles: [
      ...obstacles.map(box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })), blocker
    ] }, before);
    expect(solve).toHaveBeenCalledTimes(1); expect(after.relations.size).toBe(2);
    expect(svgSamples(after.relations.get('ship')!.path).some(point => inside(point, blocker, 2.5))).toBe(false);
  });

  it.each(styles)('%s reuses safe routes after distant obstacles, obstacle order and coverage change', style => {
    let previous = connectorBatch(inputs, style, options);
    expect(previous.relations.size).toBe(2);
    const original = new Map([...previous.relations].map(([key, relation]) => [key, relation.connector]));
    const solve = vi.spyOn(renderer, 'connectorRoute');
    for (const next of [
      { ...options, obstacles: [...obstacles, { left: 30, right: 80, top: 500, bottom: 520 }] },
      { ...options, obstacles: [...obstacles].reverse() },
      { ...options, bounds: { ...bounds, top: -100, bottom: 800 } },
      { ...options, bounds: { ...bounds, top: 10, bottom: 600 } }
    ]) {
      previous = connectorBatch(inputs, style, next, previous);
      expect(previous.relations.size).toBe(2);
      for (const [key, relation] of previous.relations) {
        expect(relation.connector.points).toBe(original.get(key)!.points);
        expect(relation.connector.path).toBe(original.get(key)!.path);
      }
    }
    expect(solve).not.toHaveBeenCalled();
  });

  it('rechecks each relation against its current bounds even when global coverage changes', () => {
    const before = connectorBatch(inputs, 'curve', options);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const next = inputs.map(input => input.key === 'ship' ? { ...input, bounds: { ...bounds, right: 850 } } : input);
    const after = connectorBatch(next, 'curve', { ...options, bounds: { ...bounds, bottom: 800 } }, before);
    expect(solve).toHaveBeenCalledExactlyOnceWith(next[0].fragments, next[0].card, 'curve', before.relations.get('ship')!.choice, expect.objectContaining({ bounds: next[0].bounds }));
    expect(after.relations.has('ship')).toBe(false);
    expect(after.relations.get('dives')!.connector.points).toBe(before.relations.get('dives')!.connector.points);
  });

  it('reroutes only the curve intersected by a newly measured text obstacle', () => {
    const before = connectorBatch(inputs, 'curve', options);
    const point = svgSamples(before.relations.get('ship')!.path).find(point => point.x > 760 && point.x < 800 && point.y > 285 && point.y < 335);
    expect(point).toBeDefined();
    const blocker = { left: point!.x - 2, right: point!.x + 2, top: point!.y - 2, bottom: point!.y + 2 };
    expect(svgSamples(before.relations.get('dives')!.path).some(point => inside(point, blocker, 2.5))).toBe(false);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const after = connectorBatch(inputs, 'curve', { ...options, obstacles: [...obstacles, blocker] }, before);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(solve.mock.calls[0][1]).toBe(inputs[0].card);
    expect(after.relations.get('dives')!.connector.points).toBe(before.relations.get('dives')!.connector.points);
    expect(after.relations.has('ship')).toBe(true);
    expect(svgSamples(after.relations.get('ship')!.path).some(point => inside(point, blocker, 2.5))).toBe(false);
  });

  it('checks changed external card obstacles before reusing a curve', () => {
    const before = connectorBatch(inputs, 'curve', options);
    const point = svgSamples(before.relations.get('ship')!.path).find(point => point.x > 760 && point.x < 800 && point.y > 285 && point.y < 335)!;
    const blocker = { left: point.x - 2, right: point.x + 2, top: point.y - 2, bottom: point.y + 2 };
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const after = connectorBatch(inputs, 'curve', { ...options, cardObstacles: [blocker] }, before);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(after.relations.get('dives')!.connector.points).toBe(before.relations.get('dives')!.connector.points);
    for (const relation of after.relations.values()) expect(svgSamples(relation.path).some(point => inside(point, blocker, 2.5))).toBe(false);
  });

  it.each([
    { lineWidth: 3 }, { clearance: 2 }, { minimumClearance: .5 },
    { body: { ...body, right: 810 } }, { corridorX: 840 }, { preferCorridor: true }
  ])('rebuilds when its routing policy changes to %j', change => {
    const before = connectorBatch(inputs, 'curve', options);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    connectorBatch(inputs, 'curve', { ...options, ...change }, before);
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it('does not reuse curve geometry when switching to straight lines', () => {
    const before = connectorBatch(inputs, 'curve', options);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const after = connectorBatch(inputs, 'straight', options, before);
    expect(solve).toHaveBeenCalledTimes(2);
    expect(after.relations.size).toBe(2);
    expect(after.segments.some(segment => /[QC]/.test(segment.path))).toBe(false);
  });

  it('retries failed relations when newly measured geometry opens a passage', () => {
    const blocked = connectorBatch(inputs, 'curve', { ...options, obstacles: [{ ...bounds }] });
    expect(blocked.relations.size).toBe(0);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const after = connectorBatch(inputs, 'curve', options, blocked);
    expect(solve).toHaveBeenCalledTimes(2);
    expect(after.relations.size).toBe(2);
  });
});
