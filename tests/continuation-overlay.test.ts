import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type LineMode } from '../src/types';
import { MarginOverlay } from '../src/view/margin-overlay';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(), parseLinktext: vi.fn() }));

class ElementStub extends EventTarget {
  hidden = false;
  tabIndex = 0;
  type = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: ElementStub[] = [];
  attributes: Record<string, string> = {};
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  private classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, value: boolean) => value ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name)
  };
  createEl(_tag: string, { cls }: { cls: string }) {
    const child = new ElementStub(); child.classList.add(cls); this.children.push(child); return child;
  }
}
interface TestCard {
  shell: ElementStub;
  button: ElementStub;
  path: ElementStub;
  anchor: { occurrence: { label: string }; fragments: { left: number; right: number; top: number; bottom: number }[]; element: ElementStub };
  placement: { key: string; side: string; x: number; y: number; width: number; height: number };
  continuation?: [ElementStub, ElementStub];
}
function fixture(lines: LineMode = 'always') {
  const root = new ElementStub(), host = { preferences: { ...DEFAULT_PREFERENCES, lines } };
  const cards = new Map<string, TestCard>();
  for (const [key, sourceY, targetY] of [['first', 120, 70], ['second', 210, 190]] as const) {
    const shell = new ElementStub(); shell.dataset.routeState = 'blocked';
    cards.set(key, { shell, button: new ElementStub(), path: new ElementStub(),
      anchor: { occurrence: { label: key }, fragments: [{ left: 240, right: 300, top: sourceY + 20, bottom: sourceY + 40 }], element: new ElementStub() },
      placement: { key, side: 'right', x: 480, y: targetY, width: 84, height: 84 } });
  }
  const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, {
    root, host, cards, continuationNumbers: new Map(), routePlacements: [...cards.values()].map(c => c.placement),
    scrollTop: 0, hostRect: { left: 40, top: 20 }, obstacles: [], highlightedElements: [],
    layoutInput: { viewport: { left: 0, right: 600, top: 0, bottom: 300 }, body: { left: 100, right: 450, top: 0, bottom: 300 } },
    view: { contentEl: { contains: () => true } }
  }) as unknown as { updateContinuations(): void };
  let generation = 0;
  const invalidate = () => Object.assign(overlay, { batchSignature: String(++generation) });
  const resetBlocked = () => { invalidate(); for (const card of cards.values()) card.shell.dataset.routeState = 'blocked'; };
  return { overlay, root, host, cards, first: cards.get('first')!, second: cards.get('second')!, resetBlocked, invalidate };
}
const active = (element: ElementStub) => element.classList.contains('margin-link-active');

describe('continuation markers in the overlay', () => {
  it('pairs matching numbers per occurrence, distinguishes relationships and exposes both ends to the keyboard', () => {
    const f = fixture(); f.overlay.updateContinuations();
    expect(f.root.children).toHaveLength(4);
    for (const [key, card] of f.cards) {
      const [source, target] = card.continuation!;
      expect(source.dataset.relation).toBe(key); expect(target.dataset.relation).toBe(key);
      expect(source.dataset.end).toBe('source'); expect(target.dataset.end).toBe('target');
      expect(source.textContent).toBe(target.textContent);
      expect(source.textContent).toMatch(/^\d+$/);
      for (const marker of [source, target]) { expect(marker.hidden).toBe(false); expect(marker.tabIndex).toBe(0); }
      expect(card.shell.dataset.routeState).toBe('continuation');
    }
    expect(f.first.continuation![0].textContent).not.toBe(f.second.continuation![0].textContent);
  });
  it('pointer and keyboard events highlight both matching ends and only their own relationship', () => {
    const f = fixture(); f.overlay.updateContinuations();
    f.first.continuation![0].dispatchEvent(new Event('pointerenter'));
    expect(f.first.continuation!.every(active)).toBe(true); expect(active(f.first.button)).toBe(true); expect(active(f.first.path)).toBe(true);
    expect(f.first.anchor.element.classList.contains('margin-link-anchor-active')).toBe(true);
    expect(f.second.continuation!.some(active)).toBe(false); expect(active(f.second.button)).toBe(false);
    f.second.continuation![1].dispatchEvent(new Event('focusin'));
    expect(f.first.continuation!.some(active)).toBe(false); expect(f.second.continuation!.every(active)).toBe(true);
    expect(f.first.anchor.element.classList.contains('margin-link-anchor-active')).toBe(false);
    expect(f.second.anchor.element.classList.contains('margin-link-anchor-active')).toBe(true);
    f.second.continuation![1].dispatchEvent(new Event('focusout'));
    expect([...f.cards.values()].flatMap(c => c.continuation!).some(active)).toBe(false);
  });
  it('hides existing markers and removes keyboard stops in hidden mode or when either endpoint is offscreen', () => {
    const f = fixture(); f.overlay.updateContinuations();
    f.host.preferences.lines = 'none'; f.resetBlocked(); f.overlay.updateContinuations();
    for (const marker of f.root.children) { expect(marker.hidden).toBe(true); expect(marker.tabIndex).toBe(-1); }
    f.host.preferences.lines = 'always'; f.resetBlocked();
    f.first.anchor.fragments[0].top = 10;
    f.second.placement.y = 290;
    f.overlay.updateContinuations();
    expect(f.root.children.every(marker => marker.hidden)).toBe(true);
  });
  it('removes the fallback when a complete route returns and reuses stable pairs if the route is blocked again', () => {
    const f = fixture(); f.overlay.updateContinuations();
    const numbers = f.root.children.map(marker => marker.textContent);
    for (const card of f.cards.values()) card.shell.dataset.routeState = 'complete';
    f.invalidate();
    f.overlay.updateContinuations();
    expect(f.root.children.every(marker => marker.hidden && marker.tabIndex === -1)).toBe(true);
    f.resetBlocked(); f.overlay.updateContinuations();
    expect(f.root.children).toHaveLength(4); expect(f.root.children.map(marker => marker.textContent)).toEqual(numbers);
    expect(f.root.children.every(marker => !marker.hidden)).toBe(true);
  });
});
