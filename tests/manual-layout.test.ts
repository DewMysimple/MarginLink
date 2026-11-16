import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/types';
import { dimensions, lane, layoutCards, overlapsCard, positionFromDrop, positionRelative, type LayoutInput, type Placement } from '../src/view/layout-engine';
import { StableLayout } from '../src/view/stable-layout';

const input: LayoutInput = {
  width: 1400, height: 800, body: { left: 360, right: 1040, top: 0, bottom: 800 },
  viewport: { left: 0, right: 1400, top: 40, bottom: 760 }, density: 'auto', layout: 'balanced',
  preferences: { ...DEFAULT_PREFERENCES, placementMode: 'manual' }, lineHeight: 24,
  anchors: [
    { key: 'left-a', x: 440, y: 300 }, { key: 'left-b', x: 480, y: 300 },
    { key: 'right-a', x: 920, y: 300 }, { key: 'right-b', x: 960, y: 300 }
  ]
};
const byKey = (cards: Placement[]) => new Map(cards.map(card => [card.key, card]));

describe('fully manual layout has no automatic balancing or collision packing', () => {
  it('ignores left/right preference, neighbouring cards and anchor arrival order', () => {
    const reference = byKey(layoutCards(input));
    for (const layout of ['balanced', 'left', 'right'] as const) {
      for (const anchors of [input.anchors, [...input.anchors].reverse(), [input.anchors[1]], [input.anchors[3], input.anchors[0]]]) {
        const cards = layoutCards({ ...input, layout, anchors }, [...reference.values()]);
        for (const card of cards) expect(card).toEqual(reference.get(card.key));
      }
    }
    expect(reference.get('left-a')!.side).toBe('left');
    expect(reference.get('left-b')!.side).toBe('left');
    expect(reference.get('right-a')!.side).toBe('right');
    expect(overlapsCard(reference.get('left-a')!, reference.get('left-b')!)).toBe(true);
  });

  it('respects an explicit source-side hint only when no user position exists', () => {
    const anchor = { ...input.anchors[0], preferred: 'right' as const };
    expect(layoutCards({ ...input, anchors: [anchor] })[0].side).toBe('right');
    expect(layoutCards({ ...input, anchors: [{ ...anchor, manual: { side: 'left', xNormalized: .2, yOffset: 1 } }] })[0].side).toBe('left');
  });

  it('restores exact overlapping saved positions and keeps an unavailable side', () => {
    const anchors = input.anchors.slice(0, 2).map(anchor => ({ ...anchor, manual: { side: 'right' as const, xNormalized: .3, yOffset: 2 } }));
    const saved = { ...input, anchors }, before = layoutCards(saved);
    expect(before).toHaveLength(2);
    expect(overlapsCard(before[0], before[1])).toBe(true);
    expect(layoutCards({ ...saved, body: { ...saved.body, right: 1380 } })).toEqual([]);
    expect(layoutCards(saved)).toEqual(before);
  });

  it('hides an unavailable initial side instead of silently moving to an empty opposite lane', () => {
    const data = { ...input, body: { ...input.body, left: 30 }, anchors: [{ key: 'near-left', x: 35, y: 300 }] };
    expect(dimensions(data, 'right')).toBeDefined();
    expect(layoutCards(data)).toEqual([]);
  });

  it('never snaps or pushes neighbouring cards during a manual drop', () => {
    const occupied = layoutCards(input), neighbor = occupied[0], anchor = input.anchors[3];
    const drop = positionFromDrop({ ...input, preferences: { ...input.preferences!, snapGrid: 32 } }, anchor,
      neighbor.x + 42 - 7, neighbor.y + 42 + 5, occupied)!;
    expect(drop.placement).toMatchObject({ x: neighbor.x - 7, y: neighbor.y + 5, side: 'left' });
    expect(drop.snapped).toBe(false);
    expect(overlapsCard(drop.placement, neighbor)).toBe(true);
  });
});

describe('manual cache restores each occurrence without an automatic base', () => {
  it('matches a clean reopen even when virtualized sections arrive in a different order', () => {
    const reference = byKey(layoutCards(input)), cache = new StableLayout();
    cache.update({ ...input, anchors: input.anchors.slice(2) }, 0, 'same');
    const expanded = cache.update({ ...input, anchors: input.anchors.slice(0, 2) }, 0, 'same');
    for (const card of expanded) expect(card).toEqual(reference.get(card.key));
    const reopened = new StableLayout().update(input, 0, 'same');
    for (const card of reopened) expect(card).toEqual(reference.get(card.key));
  });

  it('projects scroll and accepts one changed user record without moving other cards', () => {
    const cache = new StableLayout(), initial = byKey(cache.update(input, 0, 'same'));
    for (const scroll of [80, 300, 30, 0]) {
      const frame = cache.update({ ...input, anchors: input.anchors.map(anchor => ({ ...anchor, y: anchor.y - scroll })) }, scroll, 'same');
      for (const card of frame) expect(card).toEqual({ ...initial.get(card.key)!, y: initial.get(card.key)!.y - scroll });
    }
    const moved = cache.update({ ...input, anchors: input.anchors.map(anchor => anchor.key === 'left-a'
      ? { ...anchor, manual: { side: 'right', xNormalized: .5, yOffset: -1 } } : anchor) }, 0, 'same');
    for (const card of moved.filter(card => card.key !== 'left-a')) expect(card).toEqual(initial.get(card.key));
    expect(moved.find(card => card.key === 'left-a')).toMatchObject({ side: 'right', manual: true, y: 234 });
  });

  it('changes placement strategy without retaining a previous automatic reservation', () => {
    const cache = new StableLayout();
    cache.update({ ...input, preferences: { ...input.preferences!, placementMode: 'auto' } }, 0, 'same');
    expect(cache.update(input, 0, 'same')).toEqual(layoutCards(input));
  });
});

describe('exact text-relative snapshots', () => {
  it('round-trips a fractional horizontal lane instead of shrinking the offset on every restore', () => {
    const data = { ...input, body: { ...input.body, right: 1291.5 } }, anchor = input.anchors[2];
    const card = { ...layoutCards({ ...data, anchors: [anchor] })[0], x: 1307.75 };
    const relative = positionRelative(data, anchor, card)!;
    expect(relative.xNormalized).toBe(.5);
    for (let visit = 0; visit < 4; visit++) {
      const restored = layoutCards({ ...data, anchors: [{ ...anchor, manual: relative }] })[0];
      expect(restored.x).toBe(card.x);
      expect(positionRelative(data, anchor, restored)).toEqual(relative);
    }
  });

  it('refuses a stale rectangle outside its measured lane instead of silently clamping a snapshot', () => {
    const anchor = input.anchors[0], placement = layoutCards(input)[0];
    expect(positionRelative(input, anchor, { ...placement, x: placement.x + 2 })).toBeUndefined();
    expect(positionRelative({ ...input, body: { ...input.body, left: 50 } }, anchor, placement)).toBeUndefined();
  });

  it('round-trips a displayed card without viewport clamping and preserves its scroll offset', () => {
    const anchor = input.anchors[0], band = lane(input, 'right');
    const placement: Placement = { key: anchor.key, side: 'right', x: band.left + 17.25, y: -111.5, width: 84, height: 84, compact: false, shape: 'square' };
    const relative = positionRelative(input, anchor, placement)!;
    const restored = layoutCards({ ...input, anchors: [{ ...anchor, manual: relative }] })[0];
    expect(restored).toEqual({ ...placement, manual: true });
    const scroll = 200;
    expect(positionRelative(input, { ...anchor, y: anchor.y - scroll }, { ...placement, y: placement.y - scroll })).toEqual(relative);
  });

  it('does not silently truncate an exact snapshot to the persistence offset budget', () => {
    const anchor = input.anchors[0], placement = layoutCards(input)[0];
    const relative = positionRelative(input, anchor, { ...placement, y: anchor.y + 100 * 24 - placement.height / 2 });
    expect(relative?.yOffset).toBe(100);
    expect(positionRelative({ ...input, lineHeight: 0 }, anchor, placement)).toBeUndefined();
    expect(positionRelative(input, anchor, { ...placement, y: NaN })).toBeUndefined();
  });
});
