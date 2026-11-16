import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/types';
import { LayoutStore } from '../src/core/layout-store';
import { layoutCards, overlapsCard, positionFromDrop, type LayoutInput, type Placement } from '../src/view/layout-engine';
import { StableLayout } from '../src/view/stable-layout';

const input: LayoutInput = {
  width: 1400, height: 800, body: { left: 360, right: 1040, top: 0, bottom: 800 },
  viewport: { left: 0, right: 1400, top: 40, bottom: 760 }, density: 'auto', layout: 'balanced',
  preferences: { ...DEFAULT_PREFERENCES, placementMode: 'free' }, lineHeight: 24,
  anchors: [['Early Access', 490, 180], ['dives', 723, 180], ['Verse', 351, 203], ['Scene Graph', 455, 203], ['model-assisted', 620, 203], ['ship', 783, 226]]
    .map(([key, x, y]) => ({ key: String(key), x: Number(x), y: Number(y) }))
};
function unchangedOthers(before: Placement[], after: Placement[], target = 'ship') {
  for (const p of before.filter(p => p.key !== target)) expect(after.find(a => a.key === p.key)).toEqual(p);
}
describe('independent user-directed card placement', () => {
  it('free drops preserve each corner grab point even on top of another card', () => {
    const target = input.anchors.find(a => a.key === 'ship')!;
    const occupied = layoutCards(input).filter(a => a.key !== target.key), original = structuredClone(occupied);
    for (const side of ['left', 'right'] as const) for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]]) {
      const neighbor = occupied.find(p => p.side === side)!;
      const dx = side === 'left' ? -8 : 8;
      const drop = positionFromDrop(input, target, neighbor.x + dx + 84 * u, neighbor.y + 10 + 84 * v, occupied, { u, v })!;
      expect(drop.placement).toMatchObject({ x: neighbor.x + dx, y: neighbor.y + 10, side });
      expect(overlapsCard(drop.placement, neighbor)).toBe(true);
      expect(drop.snapped).toBe(false);
    }
    expect(occupied).toEqual(original);
  });
  it.each(['free', 'snap'] as const)('local %s commit/reset keeps all other automatic and manual slots unchanged', placementMode => {
    const data: LayoutInput = { ...input, preferences: { ...input.preferences!, placementMode },
      anchors: input.anchors.map(a => a.key === 'Verse' ? { ...a, manual: { side: 'left', xNormalized: .2, yOffset: 2 } } : a) };
    const cache = new StableLayout(), initial = cache.update(data, 0, 'fixed');
    const ship = data.anchors.find(a => a.key === 'ship')!, dives = initial.find(p => p.key === 'dives')!;
    const drop = positionFromDrop(data, ship, dives.x + 42, dives.y + 42, initial.filter(p => p.key !== ship.key))!;
    const moved = { ...data, anchors: data.anchors.map(a => a.key === 'ship' ? { ...a, manual: drop.relative } : a) };
    for (let render = 0; render < 4; render++) {
      const frame = cache.update(moved, 0, 'fixed'); unchangedOthers(initial, frame);
      expect(frame.find(a => a.key === 'ship')).toEqual(drop.placement);
    }
    const reset = cache.update(data, 0, 'fixed'); unchangedOthers(initial, reset);
  });
  it('restores deliberately overlapping saved rectangles without moving either member', () => {
    const a = input.anchors[1], b = input.anchors[5];
    const first = positionFromDrop(input, a, 1200, 350, [])!;
    const second = positionFromDrop(input, b, 1210, 360, [first.placement])!;
    const saved = { ...input, anchors: [{ ...a, manual: first.relative }, { ...b, manual: second.relative }] };
    expect(overlapsCard(first.placement, second.placement)).toBe(true);
    for (const cache of [new StableLayout(), new StableLayout()]) {
      const frame = cache.update(saved, 0, 'reopen');
      expect(frame.find(p => p.key === a.key)).toEqual(first.placement);
      expect(frame.find(p => p.key === b.key)).toEqual(second.placement);
      const scroll = 130;
      const moved = cache.update({ ...saved, anchors: saved.anchors.map(a => ({ ...a, y: a.y - scroll })) }, scroll, 'reopen');
      for (const original of frame) expect(moved.find(p => p.key === original.key)).toEqual({ ...original, y: original.y - scroll });
    }
  });
  it('a keyboard-style centre move onto another card only writes the selected occurrence', () => {
    const changed = vi.fn(), store = new LayoutStore([], changed);
    const keys = new Map(input.anchors.map((a, i) => [a.key, (i + 1).toString(16).padStart(64, '0')]));
    store.set('Test.md', keys.get('Verse')!, { side: 'left', xNormalized: .2, yOffset: 2 });
    changed.mockClear(); const prior = store.snapshot();
    const withStore = () => ({ ...input, anchors: input.anchors.map(a => ({ ...a, manual: store.get('Test.md', keys.get(a.key)) })) });
    const cache = new StableLayout(), initial = cache.update(withStore(), 0, 'fixed');
    const ship = input.anchors.find(a => a.key === 'ship')!, dives = initial.find(p => p.key === 'dives')!;
    const move = positionFromDrop(input, ship, dives.x + 42, dives.y + 42, initial.filter(p => p.key !== ship.key))!;
    store.set('Test.md', keys.get('ship')!, move.relative);
    const frame = cache.update(withStore(), 0, 'fixed'); unchangedOthers(initial, frame);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.snapshot().filter(r => r.key !== keys.get('ship'))).toEqual(prior);
    expect(frame.find(a => a.key === 'ship')).toEqual(move.placement);
  });
  it('auto mode continues to avoid every occupied card and ignores manual overlap', () => {
    const auto = { ...input, preferences: { ...input.preferences!, placementMode: 'auto' as const } };
    const cards = layoutCards({ ...auto, anchors: input.anchors.map(a => ({ ...a, manual: { side: 'right', xNormalized: .2, yOffset: 0 } })) });
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlapsCard(cards[i], cards[j])).toBe(false);
  });
  it('snap ignores a nearby neighbour that is off-grid', () => {
    const data = { ...input, preferences: { ...input.preferences!, placementMode: 'snap' as const, snapGrid: 12 } };
    const target = input.anchors[5], occupied = [{ ...layoutCards(input)[0], side: 'right' as const, x: 1111, y: 300 }];
    const alone = positionFromDrop(data, target, 1158, 342, [])!;
    expect(positionFromDrop(data, target, 1158, 342, occupied)).toEqual(alone);
  });
});
