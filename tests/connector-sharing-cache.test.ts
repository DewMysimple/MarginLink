import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectorBatch, type BatchRelationInput } from '../src/view/connector-batch';
import * as renderer from '../src/view/connector-renderer';

const inputs: BatchRelationInput[] = [
  ['early', 300, 120, 60, 158], ['dives', 600, 120, 920, 48], ['verse', 320, 150, 60, 268],
  ['scene', 440, 150, 60, 48], ['model', 600, 150, 920, 158], ['ship', 720, 180, 920, 268]
].map(([key, x, y, cx, cy]) => ({ key: String(key), fragments: [{ left: Number(x), right: Number(x) + 40, top: Number(y), bottom: Number(y) + 20 }],
  card: { x: Number(cx), y: Number(cy), width: 84, height: 84 } }));
const options = { body: { left: 220, right: 820, top: 0, bottom: 440 }, lineWidth: 2, minimumClearance: .5,
  bounds: { left: 0, right: 1100, top: -200, bottom: 650 },
  obstacles: [120, 150, 180].map(top => ({ left: 220, right: 820, top, bottom: top + 20 }))
    .concat([{ left: 220, right: 820, top: 230, bottom: 255 }]) };
afterEach(() => vi.restoreAllMocks());

describe('completed optional sharing searches', () => {
  it('does not repeat an unsuccessful corridor search for unchanged or distant geometry', () => {
    const solve = vi.spyOn(renderer, 'connectorRoute');
    let batch = connectorBatch(inputs, 'curve', options);
    expect(batch.relations.size).toBe(6);
    expect(solve.mock.calls.length).toBeGreaterThan(inputs.length);
    solve.mockClear();
    for (const next of [options, { ...options, obstacles: [...options.obstacles].reverse() },
      { ...options, obstacles: [...options.obstacles, { left: 220, right: 820, top: 500, bottom: 520 }] },
      { ...options, bounds: { ...options.bounds, top: -100, bottom: 600 } }]) {
      batch = connectorBatch(inputs, 'curve', next, batch);
      expect(batch.relations.size).toBe(6);
    }
    expect(solve).not.toHaveBeenCalled();
  });

  it('remembers settled sharing across a safe exact section translation during scrolling', () => {
    let batch = connectorBatch(inputs, 'curve', options);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    const dy = .3125;
    const moved = inputs.map(input => ({ ...input, fragments: input.fragments.map(box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })),
      card: { ...input.card, y: input.card.y + dy } }));
    const environment = { ...options, obstacles: options.obstacles.map(box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy })) };
    batch = connectorBatch(moved, 'curve', { ...environment, optimizeShared: false }, batch);
    batch = connectorBatch(moved, 'curve', environment, batch);
    expect(batch.relations.size).toBe(6); expect(solve).not.toHaveBeenCalled();
    for (const relation of batch.relations.values()) {
      const input = moved.find(input => input.key === relation.key)!;
      expect(renderer.clearConnectorSegments(relation.connector.segments, input.fragments, input.card,
        { ...environment, clearance: relation.connector.clearance })).toBe(true);
    }
  });

  it('explores a genuinely changed card layout after the gesture settles', () => {
    let batch = connectorBatch(inputs, 'curve', options);
    const moved = inputs.map(input => input.key === 'ship' ? { ...input, card: { ...input.card, y: input.card.y + 20 } } : input);
    batch = connectorBatch(moved, 'curve', { ...options, optimizeShared: false }, batch);
    const solve = vi.spyOn(renderer, 'connectorRoute');
    batch = connectorBatch(moved, 'curve', options, batch);
    expect(batch.relations.size).toBe(6); expect(solve.mock.calls.length).toBeGreaterThan(0);
  });

  it('reconsiders shared corridors after a card with no valid own route moves', () => {
    const failed: BatchRelationInput = { key: 'failed', fragments: [{ left: 500, right: 540, top: 120, bottom: 140 }],
      card: { x: 870, y: 320, width: 4, height: 4 }, bounds: { left: 0, right: 1, top: 0, bottom: 1 } };
    let batch = connectorBatch([...inputs, failed], 'curve', options);
    expect(batch.relations.size).toBe(6); expect(batch.relations.has('failed')).toBe(false);
    const original = new Map([...batch.relations].map(([key, relation]) => [key, relation.connector.points]));
    const moved = { ...failed, card: { ...failed.card, y: 325 } };
    const solve = vi.spyOn(renderer, 'connectorRoute');
    batch = connectorBatch([...inputs, moved], 'curve', { ...options, optimizeShared: false }, batch);
    // The move did not invalidate any successful route. Its failed relation is
    // retried, and its real card geometry still changes corridor availability.
    expect(solve).toHaveBeenCalledTimes(1); expect(solve.mock.calls[0][1]).toBe(moved.card);
    for (const [key, relation] of batch.relations) expect(relation.connector.points).toBe(original.get(key));
    solve.mockClear();
    batch = connectorBatch([...inputs, moved], 'curve', options, batch);
    expect(batch.relations.size).toBe(6); expect(batch.relations.has('failed')).toBe(false);
    expect(solve.mock.calls.some(([, card]) => inputs.some(input => input.card === card))).toBe(true);
  });
});
