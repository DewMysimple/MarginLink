import { describe, expect, it } from 'vitest';
import { continuationPair, containsBox, relationNumberPair } from '../src/view/continuation';
const viewport = { left: 0, right: 600, top: 0, bottom: 300 };
const body = { left: 100, right: 450, top: 0, bottom: 300 };
const source = { left: 200, right: 260, top: 120, bottom: 140 };
const target = { left: 480, right: 564, top: 70, bottom: 154 };
describe('safe paired continuation labels', () => {
  it('places two distinct labels in whitespace while keeping endpoints clear', () => {
    const pair = continuationPair(source, target, viewport, body, [source])!;
    expect(pair).toHaveLength(2);
    for (const p of pair) {
      expect(containsBox(viewport, p)).toBe(true);
      for (const o of [source, target]) expect(p.right <= o.left || p.left >= o.right || p.bottom <= o.top || p.top >= o.bottom).toBe(true);
    }
    expect(pair[0]).not.toEqual(pair[1]);
  });
  it('uses margin whitespace when both text exits are sealed', () => {
    const barriers = [{ left: 100, right: 450, top: 70, bottom: 120 }, { left: 100, right: 450, top: 140, bottom: 180 }];
    expect(continuationPair(source, target, viewport, body, barriers)).toBeDefined();
  });
  it('does not resurrect an endpoint clipped by this pane', () => {
    expect(continuationPair({ ...source, top: -2 }, target, viewport, body, [])).toBeUndefined();
    expect(continuationPair(source, { ...target, bottom: 320 }, viewport, body, [])).toBeUndefined();
  });
  it('never covers text when no label slot exists', () => {
    expect(continuationPair(source, target, viewport, body, [viewport])).toBeUndefined();
  });
  it('keeps dense source numbers beside their visual line and guarantees the pair when whitespace search is exhausted', () => {
    const occupied = [];
    for (let index = 0; index < 6; index++) {
      const pair = relationNumberPair(source, { ...target, top: 20 + index * 40, bottom: 50 + index * 40 }, viewport, body, [], occupied, 16);
      expect(Math.abs((pair[0].top + pair[0].bottom) / 2 - (source.top + source.bottom) / 2)).toBeLessThanOrEqual(16);
      expect(pair[0].right <= body.left || pair[0].left >= body.right).toBe(true);
      occupied.push(...pair);
    }
    const pair = relationNumberPair(source, target, viewport, body, [viewport]);
    expect(pair).toHaveLength(2);
    expect(pair[0].top).toBe(122);
    expect(containsBox(target, pair[1])).toBe(true);
  });
});
