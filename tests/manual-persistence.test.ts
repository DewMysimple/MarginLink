import { describe, expect, it, vi } from 'vitest';
import { LayoutStore, MAX_LAYOUTS, MAX_NOTE_LAYOUTS } from '../src/core/layout-store';
import { DEFAULT_PREFERENCES } from '../src/types';
import { MarginOverlay } from '../src/view/margin-overlay';
import { layoutCards, type LayoutInput } from '../src/view/layout-engine';
import { StableLayout } from '../src/view/stable-layout';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(), parseLinktext: vi.fn() }));

const key = (n: number) => n.toString(16).padStart(64, '0');
const position = { side: 'left' as const, xNormalized: .25, yOffset: 3 };
const input: LayoutInput = {
  width: 1000, height: 600, body: { left: 180, right: 820, top: 0, bottom: 600 },
  viewport: { left: 0, right: 1000, top: 0, bottom: 600 }, density: 'auto', layout: 'balanced',
  lineHeight: 24, preferences: { ...DEFAULT_PREFERENCES, placementMode: 'free' },
  anchors: [0, 1, 2, 3, 4, 5].map(i => ({ key: String(i), x: 400 + i * 20, y: 160 + Math.floor(i / 2) * 24 }))
};

describe('bounded initialization of observed UI positions', () => {
  it.each(['free', 'snap'] as const)('repairs colliding legacy snapshots in %s without rewriting their coordinates', placementMode => {
    const changed = vi.fn(), updated = Date.now();
    const anchors = [100, 150, 195, 600].map((y, i) => ({ key: key(i), x: 700, y }));
    const records = anchors.map(a => ({ source: 'A.md', key: a.key, side: 'right' as const, xNormalized: 0, yOffset: 0, updated }));
    const store = new LayoutStore(records, changed);
    const data = { ...input, preferences: { ...DEFAULT_PREFERENCES, placementMode },
      anchors: anchors.map(a => ({ ...a, manual: store.get('A.md', a.key) })) };
    const layout = new StableLayout(), before = layout.update(data, 0, 'fixed');
    const [a, b, c, isolated] = before;
    expect(b.y - a.y - a.height).toBeCloseTo(10);
    expect(c.y - b.y - b.height).toBeCloseTo(10);
    expect(isolated.y).toBe(600 - isolated.height / 2);
    expect(layoutCards(data).map(p => p.y)).toEqual(before.map(p => p.y));
    const scroll = 127.5;
    const scrolled = layout.update({ ...data, anchors: data.anchors.map(a => ({ ...a, y: a.y - scroll })) }, scroll, 'fixed');
    for (let i = 0; i < before.length; i++) expect(scrolled[i].y).toBeCloseTo(before[i].y - scroll);
    const reflow = { ...data, anchors: data.anchors.map((a, i) => ({ ...a, y: 100 + i * 130 })) };
    expect(layout.update(reflow, 0, 'fixed').map(p => p.y)).toEqual(reflow.anchors.map(a => a.y - 42));
    expect(layout.update(data, 0, 'fixed')).toEqual(before);
    expect(store.snapshot()).toEqual(records);
    expect(changed).not.toHaveBeenCalled();

    // A real move to the inner edge can intentionally overlap even a member
    // of the repaired stack. The neighbouring display slots stay where seen.
    store.set('A.md', data.anchors[0].key, { side: 'right', xNormalized: 0, yOffset: (b.y + 42 - data.anchors[0].y) / 24 });
    const moved = layout.update({ ...data, anchors: data.anchors.map(a => ({ ...a, manual: store.get('A.md', a.key) })) }, 0, 'fixed');
    for (const card of before.slice(1)) expect(moved.find(p => p.key === card.key)).toEqual(card);
    expect(moved.find(p => p.key === a.key)?.y).toBeCloseTo(b.y);
    expect(new LayoutStore(store.snapshot(), changed).get('A.md', a.key)?.initial).toBeUndefined();
  });

  it('distinguishes new automatic and deliberate edge slots even when their coordinates match', () => {
    const edge = { side: 'left' as const, xNormalized: 1, yOffset: 0 };
    const store = new LayoutStore([], vi.fn());
    store.setMany('A.md', [{ key: key(1), position: edge }]);
    store.set('A.md', key(2), edge);
    const reopened = new LayoutStore(store.snapshot(), vi.fn());
    expect(reopened.get('A.md', key(1))).toEqual({ ...edge, initial: true });
    expect(reopened.get('A.md', key(2))).toEqual(edge);
    const manual = { ...input, preferences: { ...DEFAULT_PREFERENCES, placementMode: 'manual' as const },
      anchors: [1, 2].map(i => ({ key: key(i), x: 380, y: 160, manual: reopened.get('A.md', key(i)) })) };
    const [a, b] = new StableLayout().update(manual, 0, 'fixed');
    expect([a.x, a.y]).toEqual([b.x, b.y]);
  });
  it('initializes one batch without replacing existing positions or refreshing timestamps on another render', () => {
    const changed = vi.fn(), store = new LayoutStore([], changed);
    store.set('A.md', key(1), position); changed.mockClear();
    const entries = [1, 2, 3].map(n => ({ key: key(n), position: { ...position, yOffset: n } }));
    store.setMany('A.md', entries);
    expect(store.get('A.md', key(1))).toEqual(position);
    expect(store.snapshot()).toHaveLength(3); expect(changed).toHaveBeenCalledOnce();
    const saved = store.snapshot(); changed.mockClear();
    for (let frame = 0; frame < 20; frame++) store.setMany('A.md', entries);
    expect(store.snapshot()).toEqual(saved); expect(changed).not.toHaveBeenCalled();
    expect(new LayoutStore(saved, vi.fn()).snapshot()).toEqual(saved);
  });

  it('never churns or evicts existing positions when first displays exceed the note budget', () => {
    const changed = vi.fn(), store = new LayoutStore([], changed);
    store.setMany('A.md', Array.from({ length: MAX_NOTE_LAYOUTS }, (_, n) => ({ key: key(n), position })));
    const saved = store.snapshot(); changed.mockClear();
    for (let frame = 0; frame < 5; frame++) store.setMany('A.md', [{ key: key(999), position }]);
    expect(store.snapshot()).toEqual(saved); expect(changed).not.toHaveBeenCalled();
    store.set('A.md', key(999), position);
    expect(store.get('A.md', key(999))).toEqual(position);
    expect(store.snapshot()).toHaveLength(MAX_NOTE_LAYOUTS);
  });

  it('keeps the global budget and rejects invalid snapshots without losing another note', () => {
    const records = Array.from({ length: MAX_LAYOUTS }, (_, n) => ({ source: `${Math.floor(n / 100)}.md`, key: key(n), ...position, updated: Date.now() }));
    const changed = vi.fn(), store = new LayoutStore(records, changed), saved = store.snapshot();
    store.setMany('New.md', [{ key: key(999), position }]);
    store.setMany('0.md', [{ key: key(0), position: { ...position, yOffset: 81 } }], true);
    expect(store.snapshot()).toEqual(saved); expect(changed).not.toHaveBeenCalled();
    store.set('New.md', key(999), position);
    expect(store.get('New.md', key(999))).toEqual(position); expect(store.snapshot()).toHaveLength(MAX_LAYOUTS);
  });
});

function overlayFixture() {
  const changed = vi.fn(), store = new LayoutStore([], changed);
  const stableLayout = new StableLayout();
  const placements = stableLayout.update(input, 0, 'fixed');
  const cards = new Map(placements.map(p => [p.key, { placement: p, anchor: { layoutKey: key(Number(p.key)) } }]));
  const state = { stableLayout, layoutInput: structuredClone(input), layoutSource: 'current text', bridge: () => ({ text: 'current text' }), cards, cardDrag: { dragging: false }, confirmedSource: 'A.md', path: 'A.md', mode: 'source',
    view: { file: { path: 'A.md' }, getMode: () => 'source' }, legacyLayoutKeys: new Map(), host: { layouts: store } };
  const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, state) as unknown as Pick<MarginOverlay, 'freezeLayout'>;
  return { overlay, state, store, changed, placements };
}

describe('freeze real measured geometry before navigating or changing mode', () => {
  it('freezing a newly seen card next to a legacy slot does not apply its spacing correction twice', () => {
    const f = overlayFixture(), anchors = f.state.layoutInput.anchors;
    const neighbor = f.placements.find(p => p.key === anchors[1].key)!;
    const prior = { side: neighbor.side, xNormalized: neighbor.side === 'left' ? 1 : 0,
      yOffset: (neighbor.y + neighbor.height / 2 - anchors[0].y) / input.lineHeight! };
    f.store.setMany('A.md', [{ key: key(0), position: prior }]);
    const refresh = () => {
      for (const a of anchors) a.manual = f.store.get('A.md', key(Number(a.key)));
      const cards = f.state.stableLayout.update(f.state.layoutInput, 0, 'fixed');
      for (const card of cards) f.state.cards.get(card.key)!.placement = card;
      return new Map(cards.map(p => [p.key, [p.x, p.y]]));
    };
    const before = refresh();
    expect(f.state.cards.get(neighbor.key)!.placement.y).not.toBe(neighbor.y);
    expect(f.overlay.freezeLayout(false)).toBe(true);
    expect(refresh()).toEqual(before);
  });
  it('restores every free card after different sections arrive first on a fresh view', () => {
    const f = overlayFixture(); expect(f.overlay.freezeLayout(false)).toBe(true);
    expect(f.changed).toHaveBeenCalledOnce(); expect(f.store.snapshot()).toHaveLength(6);
    const withPositions = input.anchors.map(a => ({ ...a, manual: f.store.get('A.md', key(Number(a.key))) }));
    for (const first of [[withPositions[5]], withPositions.slice(2, 4)]) {
      const reopened = new StableLayout(); reopened.update({ ...input, anchors: first }, 0, 'new');
      const restored = reopened.update({ ...input, anchors: withPositions }, 0, 'new');
      for (const original of f.placements) {
        const actual = restored.find(p => p.key === original.key)!;
        expect(actual).toMatchObject({ side: original.side, x: original.x, y: original.y });
      }
    }
    f.changed.mockClear(); f.overlay.freezeLayout(false); expect(f.changed).not.toHaveBeenCalled();
  });

  it('captures the visible layout on entering manual rather than restoring an older hidden slot', () => {
    const f = overlayFixture(); f.store.set('A.md', key(0), { ...position, side: 'right', yOffset: 10 });
    f.overlay.freezeLayout();
    const restored = layoutCards({ ...input, preferences: { ...DEFAULT_PREFERENCES, placementMode: 'manual' },
      anchors: input.anchors.map(a => ({ ...a, manual: f.store.get('A.md', key(Number(a.key))) })) });
    for (const p of f.placements) expect(restored.find(r => r.key === p.key)).toMatchObject({ side: p.side, x: p.x, y: p.y });
  });

  it('does not save during a drag, a stale source transition or an ambiguous occurrence', () => {
    const f = overlayFixture(); f.state.cardDrag.dragging = true;
    expect(f.overlay.freezeLayout(false)).toBe(false); f.state.cardDrag.dragging = false;
    f.state.view.file.path = 'B.md'; expect(f.overlay.freezeLayout()).toBe(false); f.state.view.file.path = 'A.md';
    for (const card of f.state.cards.values()) card.anchor.layoutKey = '';
    f.overlay.freezeLayout(false); expect(f.store.snapshot()).toEqual([]); expect(f.changed).not.toHaveBeenCalled();
  });

  it('refuses a pre-edit snapshot and merges splits without replacing occurrences claimed by the recent split', () => {
    const f = overlayFixture();
    Object.assign(f.overlay, { layoutSource: 'outdated text' });
    expect(f.overlay.freezeLayout()).toBe(false); expect(f.changed).not.toHaveBeenCalled();
    Object.assign(f.overlay, { layoutSource: 'current text' });
    const claimed = new Set([key(0)]);
    f.store.set('A.md', key(0), position); f.changed.mockClear();
    expect(f.overlay.freezeLayout(true, claimed)).toBe(true);
    expect(f.store.get('A.md', key(0))).toEqual(position);
    expect(claimed.size).toBe(6); expect(f.store.snapshot()).toHaveLength(6);
    f.changed.mockClear(); expect(f.overlay.freezeLayout(true, claimed)).toBe(false);
    expect(f.changed).not.toHaveBeenCalled();
  });
});
