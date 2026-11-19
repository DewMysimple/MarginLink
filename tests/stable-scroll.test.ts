import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/types';
import { layoutCards, positionFromDrop, type LayoutInput } from '../src/view/layout-engine';
import { StableLayout } from '../src/view/stable-layout';
import { LayoutStore } from '../src/core/layout-store';

const input: LayoutInput = {
  width: 1000, height: 420, body: { left: 180, right: 820, top: 0, bottom: 420 },
  viewport: { left: 0, right: 1000, top: 0, bottom: 420 }, density: 'auto', layout: 'balanced',
  preferences: { ...DEFAULT_PREFERENCES }, lineHeight: 24,
  anchors: [['Early Access', 490, 180], ['dives', 723, 180], ['Verse', 351, 203], ['Scene Graph', 455, 203], ['model-assisted', 620, 203], ['ship', 783, 226]]
    .map(([key, x, y]) => ({ key: String(key), x: Number(x), y: Number(y) }))
};
describe('stable scroll projection', () => {
  it('reproduces the manual 60, 50, 40, 30 boundary without viewport pinning', () => {
    const centers = [60, 50, 40, 30].map(y => {
      const card = layoutCards({ ...input, anchors: [{ key: 'a', x: 490, y, manual: { side: 'right', xNormalized: 0, yOffset: 0 } }] })[0];
      return card.y + card.height / 2;
    });
    expect(centers).toEqual([60, 50, 40, 30]);
  });
  it.each(['auto', 'free', 'snap'] as const)('keeps six-card side/order and <=1px relative drift in %s', placementMode => {
    const cache = new StableLayout();
    const data = { ...input, preferences: { ...DEFAULT_PREFERENCES, placementMode } };
    const initial = cache.update(data, 0, 'fixed');
    const ship = initial.find(p => p.key === 'ship')!;
    expect(ship.y + ship.height / 2).toBe(86);
    for (const scroll of [1, 20, 60, 80, 81, 300, 900, 301, 80, 0]) {
      const frame = cache.update({ ...data, anchors: data.anchors.map(a => ({ ...a, y: a.y - scroll })) }, scroll, 'fixed');
      for (const p of frame) {
        const before = initial.find(b => b.key === p.key)!;
        expect(p.side).toBe(before.side);
        expect(p.y - before.y).toBeCloseTo(-scroll, 5);
      }
      expect(frame.map(p => p.key)).toEqual(initial.map(p => p.key));
    }
  });
  it('retains offscreen cards and their slots across virtualization and new arrivals', () => {
    const cache = new StableLayout();
    const initial = cache.update(input, 0, 'same');
    const next = cache.update({ ...input, anchors: [{ key: 'new', x: 480, y: 10 }] }, 80, 'same');
    expect(next).toHaveLength(7);
    for (const p of initial) expect(next.find(a => a.key === p.key)).toMatchObject({ side: p.side, y: p.y - 80 });
    const back = cache.update(input, 0, 'same');
    for (const p of initial) expect(back.find(a => a.key === p.key)).toEqual(p);
  });
  it('updates real text references after a virtual spacer correction without resolving relative placement', () => {
    const cache = new StableLayout();
    const initial = cache.update(input, 0, 'same');
    const corrected = cache.update({ ...input, anchors: input.anchors.map(a => ({ ...a, y: a.y - 80 + 7 })) }, 80, 'same');
    for (const p of initial) expect(corrected.find(a => a.key === p.key)).toMatchObject({ side: p.side, y: p.y - 73 });
  });
  it('keeps the stationary neighbour clear when a spacer correction and a new snapshot hit it', () => {
    const cache = new StableLayout(), initial = { side: 'right' as const, xNormalized: 0, yOffset: 0, initial: true as const };
    const anchors = [200, 228].map((y, i) => ({ key: String(i), x: 700, y, manual: initial }));
    const before = cache.update({ ...input, anchors }, 0, 'fixed');
    const after = cache.update({ ...input, anchors: [
      { ...anchors[0], y: 120 }, { ...anchors[1], y: 128 }, { ...anchors[1], key: 'new', y: 118 }
    ] }, 100, 'fixed', true);
    expect(after[0].y + after[0].height + 10).toBeLessThanOrEqual(after[1].y);
    expect(after[1].y).toBe(before[1].y - 100);
    expect(after.slice(0, 2).every(p => after[2].y >= p.y + p.height + 10 || after[2].y + after[2].height + 10 <= p.y)).toBe(true);
  });
  it('keeps old relative records intact, including cards displayed while their source is outside', () => {
    const changed = vi.fn(), store = new LayoutStore([], changed);
    const manual = { side: 'right' as const, xNormalized: 0.5, yOffset: 3 };
    store.set('A.md', 'a'.repeat(64), manual);
    changed.mockClear(); const before = store.snapshot();
    const cache = new StableLayout();
    for (const scroll of [0, 160, 200, 300, 1000, 0]) {
      const card = cache.update({ ...input, anchors: [{ key: 'a', x: 490, y: 180 - scroll, manual: store.get('A.md', 'a'.repeat(64)) }] }, scroll, 'fixed')[0];
      expect(card.y + card.height / 2).toBe(252 - scroll);
    }
    expect(store.snapshot()).toEqual(before); expect(changed).not.toHaveBeenCalled();
  });
  it('follows real image reflow past a stale offscreen reservation', () => {
    const layout = new StableLayout(), initial = { ...input, preferences: { ...DEFAULT_PREFERENCES, placementMode: 'manual' as const },
      anchors: [{ key: 'image-caption', x: 850, y: 250 }, { key: 'unmounted-later-section', x: 850, y: 500 }] };
    const before = layout.update(initial, 0, 'image');
    const after = layout.update({ ...initial, anchors: [{ ...initial.anchors[0], y: 1770 }] }, 0, 'image', true);
    expect(after[0].y - before[0].y).toBe(1520);
    expect(after[1]).toEqual(before[1]);
  });
  it('keeps drop constraints bounded independently of static scroll display', () => {
    expect(positionFromDrop(input, input.anchors[0], 870, -2, [])).toBeUndefined();
    const drop = positionFromDrop(input, input.anchors[0], 870, 10, [])!;
    expect(drop.placement.y).toBe(8);
    expect(drop.placement.y + drop.placement.height).toBeLessThanOrEqual(412);
  });
  it('invalidates content geometry deliberately and isolates two view caches', () => {
    const a = new StableLayout(), b = new StableLayout();
    const original = a.update(input, 0, 'A');
    b.update({ ...input, anchors: input.anchors.map(p => ({ ...p, y: p.y - 80 })) }, 80, 'B');
    expect(a.update(input, 0, 'A')).toEqual(original);
    expect(a.update({ ...input, anchors: [input.anchors[0]] }, 0, 'new width')).toHaveLength(1);
    a.clear(); expect(a.update({ ...input, anchors: [] }, 0, 'new width')).toEqual([]);
  });
});
