import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type Box, type Side } from '../src/types';
import { MarginOverlay } from '../src/view/margin-overlay';
import type { ConnectorBatch, SegmentReference } from '../src/view/connector-batch';
import { clearConnectorSegments } from '../src/view/connector-renderer';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(), parseLinktext: vi.fn() }));

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent?: ElementStub;
  ownerDocument = documentStub;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  removed = false;
  private classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name)
  };
  constructor(readonly tag = 'div') { super(); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  appendChild(child: ElementStub) { child.parent = this; this.children.push(child); return child; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
}
const documentStub = { createElementNS: (_namespace: string, tag: string) => new ElementStub(tag) };
interface CardStub {
  shell: ElementStub;
  button: ElementStub;
  path: ElementStub;
  anchor: { fragments: Box[]; element: ElementStub; occurrence: { label: string } };
  placement: { key: string; side: Side; x: number; y: number; width: number; height: number };
  routeBounds?: Box;
}
interface OverlayProbe {
  paintConnectors(): void;
  updateContinuations(scope?: ReadonlySet<string>): void;
  highlight(key?: string): void;
  togglePin(key: string): void;
  hover(key?: string): void;
  clearFocus(): void;
  batch?: ConnectorBatch;
  sharedPaths: Map<string, ElementStub>;
  scrollTop: number;
  cardDrag: { dragging: boolean };
  scrolling: boolean;
  diagnostics?: { renders: number; measurements: number; routes: number; svgWrites: number; markerWrites: number; work: number[] };
}
function fixture() {
  const hostRect = { left: 40, top: 20 }, svg = new ElementStub('svg'), cards = new Map<string, CardStub>();
  for (const [key, left, sourceY, cardY] of [['ship', 700, 300, 30], ['dives', 500, 180, 390]] as const) {
    const path = new ElementStub('path'); path.style.display = 'none'; path.dataset.logical = 'true'; svg.appendChild(path);
    cards.set(key, { shell: new ElementStub(), button: new ElementStub(), path,
      anchor: { element: new ElementStub(), occurrence: { label: key }, fragments: [{ left: left + hostRect.left, right: left + 40 + hostRect.left, top: sourceY + hostRect.top, bottom: sourceY + 20 + hostRect.top }] },
      placement: { key, side: 'right', x: 856, y: cardY, width: 84, height: 84 } });
  }
  const host = { preferences: { ...DEFAULT_PREFERENCES, lineStyle: 'elbow' as const, lineWidth: 2 } };
  const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, {
    hostRect, svg, host, cards, scrollTop: 0, sharedPaths: new Map(), batchSignature: '', cardDrag: { dragging: false },
    layoutInput: { viewport: { left: 0, right: 1000, top: 0, bottom: 600 }, body: { left: 180, right: 820, top: 0, bottom: 600 } },
    obstacles: [120, 150, 180, 210, 240, 270, 300, 330, 360].map(top => ({ left: 180, right: 820, top, bottom: top + 20 })),
    textObstacles: { revision: 1 }, highlightedElements: [], view: { contentEl: { contains: () => true } }
  }) as unknown as OverlayProbe;
  return { overlay, host, cards, svg, scroll: (amount: number) => {
    overlay.scrollTop += amount;
    for (const card of cards.values()) { card.placement.y -= amount; for (const f of card.anchor.fragments) { f.top -= amount; f.bottom -= amount; } }
  } };
}
const active = (element: ElementStub) => element.classList.contains('margin-link-active');
function ends(path: string): [number[], number[]] {
  const commands = [...path.matchAll(/([MLQC])\s+([^MLQC]+)/g)].map(([, , values]) => values.trim().split(/[\s,]+/).map(Number));
  return [commands[0].slice(0, 2), commands.at(-1)!.slice(-2)];
}
function assertOrderedGeometry(f: ReturnType<typeof fixture>, key: string) {
  const card = f.cards.get(key)!, references = JSON.parse(card.shell.dataset.routeSegments) as SegmentReference[];
  expect(references.length).toBeGreaterThan(0);
  let previous: number[] | undefined;
  for (const reference of references) {
    const path = f.overlay.sharedPaths.get(reference.id)!; expect(path).toBeDefined();
    expect(JSON.parse(path.dataset.members)).toContain(key);
    let [from, to] = ends(path.attributes.d); if (reference.reversed) [from, to] = [to, from];
    if (previous) expect(Math.hypot(from[0] - previous[0], from[1] - previous[1])).toBeLessThan(0.001);
    previous = to;
  }
  expect(previous).toEqual(ends(card.path.attributes.d)[1]);
}

describe('actual overlay shared-path drawing', () => {
  it('keeps complete routes while scrolling and explores sharing once the native gesture ends', () => {
    const f = fixture(); f.overlay.scrolling = true; f.overlay.paintConnectors();
    expect(f.overlay.batch!.relations.size).toBe(2);
    const moving = f.overlay.batch;
    f.scroll(20); f.overlay.paintConnectors(); expect(f.overlay.batch).toBe(moving);
    f.overlay.scrolling = false; f.overlay.paintConnectors();
    expect(f.overlay.batch!.sharedCount).toBeGreaterThan(0);
    for (const key of f.cards.keys()) assertOrderedGeometry(f, key);
    const settled = f.overlay.batch;
    f.overlay.paintConnectors(); expect(f.overlay.batch).toBe(settled);
  });
  it('draws only the current hover or pin after a pane resize', () => {
    const f = fixture(); f.host.preferences.lines = 'hover';
    Object.assign(f.overlay, { resizeHoverRoutes: true });
    const markers = vi.spyOn(f.overlay, 'updateContinuations').mockImplementation(() => {});
    f.overlay.hover('ship');
    expect([...f.overlay.batch!.relations.keys()]).toEqual(['ship']);
    expect(markers).toHaveBeenLastCalledWith(new Set(['ship']));
    assertOrderedGeometry(f, 'ship');

    f.overlay.togglePin('ship'); f.overlay.hover('dives');
    expect([...f.overlay.batch!.relations.keys()]).toEqual(['ship']);
    f.overlay.togglePin('ship');
    expect([...f.overlay.batch!.relations.keys()]).toEqual(['dives']);
    expect(markers).toHaveBeenLastCalledWith(new Set(['dives']));
    assertOrderedGeometry(f, 'dives');
    expect([...f.overlay.sharedPaths.values()].every(active)).toBe(true);

    f.overlay.hover();
    expect(f.svg.style.display).toBe('none');
    expect([...f.overlay.sharedPaths.values()].some(active)).toBe(false);
  });
  it('skips an unmeasured source while retaining its card as a real route obstacle', () => {
    const f = fixture(); f.overlay.paintConnectors();
    const trunk = f.overlay.batch!.segments.find(stroke => stroke.shared)!;
    const left = (trunk.from.x + trunk.to.x) / 2 - 5, top = (trunk.from.y + trunk.to.y) / 2 - 5;
    const blocker = { left, right: left + 10, top, bottom: top + 10 };
    f.cards.set('outside', { shell: new ElementStub(), button: new ElementStub(), path: new ElementStub('path'),
      anchor: { element: new ElementStub(), occurrence: { label: 'outside' }, fragments: [{ left: 500, right: 540, top: 5000, bottom: 5020 }] },
      placement: { key: 'outside', side: 'right', x: left, y: top, width: 10, height: 10 } });
    f.overlay.paintConnectors();
    expect(f.overlay.batch!.relations.has('outside')).toBe(false);
    expect(f.cards.has('outside')).toBe(true);
    expect(f.overlay.batch!.relations.size).toBe(2);
    for (const relation of f.overlay.batch!.relations.values()) {
      const card = f.cards.get(relation.key)!;
      const fragments = card.anchor.fragments.map(box => ({ left: box.left - 40, right: box.right - 40, top: box.top - 20, bottom: box.bottom - 20 }));
      expect(clearConnectorSegments(relation.connector.segments, fragments, card.placement,
        { lineWidth: 2.5, clearance: relation.connector.clearance, cardObstacles: [blocker] })).toBe(true);
    }
  });
  it('retains a partial card whose port is inside measured coverage', () => {
    const f = fixture(); Object.assign(f.overlay, { textObstacles: { revision: 1, bounds: { top: 0, bottom: 450 } } });
    f.overlay.paintConnectors();
    expect(f.overlay.batch!.relations.size).toBe(2);
    for (const key of f.cards.keys()) assertOrderedGeometry(f, key);
  });
  it('optimizes after a gesture ends even when the final card coordinates have not changed', () => {
    const f = fixture();
    f.overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
    f.overlay.cardDrag.dragging = true; f.overlay.paintConnectors();
    const preview = f.overlay.batch;
    expect(preview!.relations.size).toBe(2);
    f.overlay.cardDrag.dragging = false; f.overlay.paintConnectors();
    expect(f.overlay.batch).not.toBe(preview);
    expect(f.overlay.batch!.sharedCount).toBeGreaterThan(0);
    expect(f.overlay.diagnostics.routes).toBe(2);
    for (const key of f.cards.keys()) assertOrderedGeometry(f, key);
    f.overlay.paintConnectors();
    expect(f.overlay.diagnostics.routes).toBe(2);
  });
  it('creates exactly one visible SVG path per stroke and publishes ordered occurrence references', () => {
    const f = fixture(); f.overlay.paintConnectors();
    expect(f.overlay.batch!.sharedCount).toBeGreaterThan(0);
    expect(f.overlay.sharedPaths.size).toBe(f.overlay.batch!.segments.length);
    expect(f.svg.children.filter(p => p.style.display !== 'none')).toHaveLength(f.overlay.batch!.segments.length);
    for (const stroke of f.overlay.batch!.segments) {
      const path = f.overlay.sharedPaths.get(stroke.id)!;
      expect(path.attributes.d).toBe(stroke.path); expect(JSON.parse(path.dataset.members)).toEqual(stroke.members);
      expect(f.svg.children.filter(p => p.dataset.segment === stroke.id)).toHaveLength(1);
    }
    for (const [key, card] of f.cards) { expect(card.shell.dataset.routeState).toBe('complete'); assertOrderedGeometry(f, key); }
  });
  it('highlights only the selected occurrence’s source, common trunk and target branch', () => {
    const f = fixture(); f.overlay.paintConnectors(); f.overlay.highlight('ship');
    for (const [id, path] of f.overlay.sharedPaths) expect(active(path)).toBe(f.overlay.batch!.segments.find(s => s.id === id)!.members.includes('ship'));
    expect(active(f.cards.get('ship')!.button)).toBe(true); expect(active(f.cards.get('dives')!.button)).toBe(false);
    expect(f.cards.get('ship')!.anchor.element.classList.contains('margin-link-anchor-active')).toBe(true);
    expect(f.cards.get('dives')!.anchor.element.classList.contains('margin-link-anchor-active')).toBe(false);
    f.overlay.highlight('dives');
    for (const [id, path] of f.overlay.sharedPaths) expect(active(path)).toBe(f.overlay.batch!.segments.find(s => s.id === id)!.members.includes('dives'));
    f.overlay.highlight(); expect([...f.overlay.sharedPaths.values()].some(active)).toBe(false);
  });
  it('pins one occurrence per leaf without rebuilding geometry and restores temporary focus after unpinning', () => {
    const a = fixture(), b = fixture();
    a.overlay.paintConnectors(); b.overlay.paintConnectors();
    const batch = a.overlay.batch;
    const geometry = [...a.overlay.sharedPaths.values()].map(el => el.getAttribute('d'));
    a.overlay.hover('ship'); a.overlay.togglePin('ship'); a.overlay.hover('dives');
    expect(active(a.cards.get('ship')!.button)).toBe(true);
    expect(active(b.cards.get('ship')!.button)).toBe(false);
    a.overlay.togglePin('ship');
    expect(active(a.cards.get('dives')!.button)).toBe(true);
    a.overlay.clearFocus();
    expect([...a.overlay.sharedPaths.values()].some(active)).toBe(false);
    expect(a.overlay.batch).toBe(batch);
    expect([...a.overlay.sharedPaths.values()].map(el => el.getAttribute('d'))).toEqual(geometry);
  });
  it('removes obsolete shared paths and member references after deleting one occurrence', () => {
    const f = fixture(); f.overlay.paintConnectors(); const before = new Map(f.overlay.sharedPaths);
    f.cards.get('dives')!.path.remove(); f.cards.delete('dives'); f.overlay.paintConnectors();
    expect(f.overlay.batch!.sharedCount).toBe(0); expect(f.overlay.batch!.relations.has('dives')).toBe(false);
    for (const path of f.overlay.sharedPaths.values()) expect(JSON.parse(path.dataset.members)).toEqual(['ship']);
    for (const [id, path] of before) if (!f.overlay.sharedPaths.has(id)) expect(path.removed).toBe(true);
    expect(f.svg.children.some(p => p.dataset.members?.includes('dives'))).toBe(false); assertOrderedGeometry(f, 'ship');
  });
  it('projects the cached content paths on the first pure scroll without solving or duplicating strokes', () => {
    const f = fixture(); f.overlay.paintConnectors(); const batch = f.overlay.batch, paths = new Map(f.overlay.sharedPaths);
    const contentPaths = new Map([...paths].map(([id, path]) => [id, path.attributes.d]));
    f.scroll(20); f.overlay.paintConnectors();
    expect(f.overlay.batch).toBe(batch); expect(f.overlay.sharedPaths.size).toBe(paths.size);
    for (const [id, path] of f.overlay.sharedPaths) {
      expect(path).toBe(paths.get(id)); expect(path.attributes.d).toBe(contentPaths.get(id)); expect(path.attributes.transform).toBeUndefined();
    }
    for (const key of f.cards.keys()) assertOrderedGeometry(f, key);
  });
  it.each([false, true])('reuses successful and failed content geometry without route solves or SVG writes (blocked=%s)', blocked => {
    const f = fixture();
    if (blocked) Object.assign(f.overlay, { obstacles: [{ left: 0, right: 1000, top: 0, bottom: 600 }] });
    f.overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
    f.overlay.paintConnectors();
    const first = { ...f.overlay.diagnostics }, batch = f.overlay.batch;
    if (blocked) expect(batch!.relations.size).toBe(0);
    for (const amount of [5, 21, -37, 19, -4, 13, -17]) { f.scroll(amount); f.overlay.paintConnectors(); }
    expect(f.overlay.batch).toBe(batch);
    expect(f.overlay.diagnostics.routes).toBe(first.routes);
    expect(f.overlay.diagnostics.svgWrites).toBe(first.svgWrites);
  });
  it('bypasses all connector work in numbers mode and restores the original line style when returning', () => {
    const f = fixture();
    Object.assign(f.host.preferences, { lines: 'numbers' });
    f.overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
    f.overlay.paintConnectors();
    expect(f.overlay.batch).toBeUndefined(); expect(f.overlay.sharedPaths.size).toBe(0);
    expect(f.overlay.diagnostics.routes).toBe(0); expect(f.overlay.diagnostics.svgWrites).toBe(0);
    expect(f.svg.style.display).toBe('none');
    Object.assign(f.host.preferences, { lines: 'always' }); f.overlay.paintConnectors();
    expect(f.host.preferences.lineStyle).toBe('elbow'); expect(f.svg.style.display).toBe('');
    expect(f.overlay.batch!.relations.size).toBe(2);
  });
});
