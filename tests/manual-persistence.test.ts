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
  const placements = new StableLayout().update(input, 0, 'fixed');
  const cards = new Map(placements.map(p => [p.key, { placement: p, anchor: { layoutKey: key(Number(p.key)) } }]));
  const state = { layoutInput: structuredClone(input), layoutSource: 'current text', bridge: () => ({ text: 'current text' }), cards, cardDrag: { dragging: false }, confirmedSource: 'A.md', path: 'A.md', mode: 'source',
    view: { file: { path: 'A.md' }, getMode: () => 'source' }, legacyLayoutKeys: new Map(), host: { layouts: store } };
  const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, state) as unknown as Pick<MarginOverlay, 'freezeLayout'>;
  return { overlay, state, store, changed, placements };
}

describe('freeze real measured geometry before navigating or changing mode', () => {
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
