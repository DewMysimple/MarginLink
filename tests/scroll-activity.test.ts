import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import { MarginOverlay, type OverlayHost } from '../src/view/margin-overlay';
import type { LayoutInput } from '../src/view/layout-engine';
import type { StableLayout } from '../src/view/stable-layout';
import { TextObstacles } from '../src/view/text-obstacles';
import { DEFAULT_PREFERENCES, type Anchor, type LineMode } from '../src/types';
import { parseWikilinks } from '../src/core/wikilink-parser';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(),
  parseLinktext: (path: string) => ({ path, subpath: '' }) }));
vi.mock('../src/editor/drag-controller', () => ({ DragController: class { cancel() {} destroy() {} update() {} } }));
vi.mock('../src/view/card-drag-controller', () => ({ CardDragController: class { cancel() {} destroy() {} placement() {} } }));
vi.mock('../src/view/card-renderer', () => ({ renderCard: vi.fn() }));

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent?: ElementStub;
  connectedRoot = false;
  hidden = false;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  style = { position: '', setProperty: vi.fn() };
  classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() };
  box = { left: 0, top: 0, width: 1000, height: 800 };
  scrollTop = 0;
  scrollLeft = 0;
  clientLeft = 0;
  clientTop = 0;
  get clientWidth() { return this.box.width; }
  get clientHeight() { return this.box.height; }
  get parentElement() { return this.parent; }
  get isConnected(): boolean { return this.connectedRoot || this.parent?.isConnected === true; }
  constructor(readonly ownerDocument: DocumentStub) { super(); }
  getBoundingClientRect() {
    const { left, top, width, height } = this.box;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  closest() { return undefined; }
  createDiv() { return this.appendChild(this.ownerDocument.createElement()); }
  createEl() { return this.createDiv(); }
  replaceChildren() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  appendChild(child: ElementStub) { child.parent = this; this.children.push(child); return child; }
  contains(node: ElementStub): boolean { return this === node || this.children.some(child => child.contains(node)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
}
interface DocumentStub {
  defaultView: EventTarget & {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
    requestAnimationFrame: ReturnType<typeof vi.fn>;
    cancelAnimationFrame: ReturnType<typeof vi.fn>;
  };
  fonts: EventTarget;
  createElement(): ElementStub;
  createElementNS(): ElementStub;
}
interface ActivityProbe {
  decorations: { element: ElementStub };
  scrolling: boolean;
  scroller?: ElementStub;
  scrollIdleTimer?: number;
  resizing: boolean;
  resizeIdleTimer?: number;
  stableLayout: StableLayout;
  layoutInput: LayoutInput;
  layoutGeometry: string;
  cards: Map<string, { shell: ElementStub; generation: number }>;
  collapsedCards: ActivityProbe['cards'];
  hovered?: string;
  focused?: string;
  onScroll(event: Event): void;
  clearCards(): void;
}
const live: MarginOverlay[] = [];
function fixture(lines: LineMode = 'numbers') {
  const win = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: vi.fn((_callback: FrameRequestCallback) => 1), cancelAnimationFrame: vi.fn(),
    getComputedStyle: () => ({ position: 'relative', fontSize: '15px', paddingLeft: '0px', paddingRight: '0px' })
  });
  const doc: DocumentStub = { defaultView: win, fonts: new EventTarget(),
    createElement: () => new ElementStub(doc), createElementNS: () => new ElementStub(doc) };
  const container = new ElementStub(doc), scroller = new ElementStub(doc), nested = new ElementStub(doc);
  container.connectedRoot = true;
  const source = 'A [[Target]]', data = { path: 'A.md' };
  let body = new ElementStub(doc);
  body.box = { left: 200, top: 0, width: 600, height: 2000 };
  container.appendChild(body);
  const replaceBody = () => {
    const next = new ElementStub(doc);
    next.box = { ...body.box }; body.remove(); body = container.appendChild(next);
  };
  const preview = Object.assign(new ElementStub(doc), {
    querySelector: (selector: string) => selector === '.markdown-preview-view' ? scroller : body
  });
  const view = { contentEl: container, getMode: () => 'preview', file: data, data: source, previewMode: { containerEl: preview } };
  const anchors = vi.fn<() => Anchor[]>(() => []);
  const overlay = new MarginOverlay(view as unknown as MarkdownView, {
    preferences: { ...DEFAULT_PREFERENCES, lines }, reading: { anchors }, layouts: { get: () => undefined },
    app: { metadataCache: { getFirstLinkpathDest: () => null } }, cardNavigation: { take: () => undefined }
  } as unknown as OverlayHost);
  Object.assign(overlay, { confirmedSource: data.path, path: data.path, mode: 'preview' });
  live.push(overlay);
  const probe = overlay as unknown as ActivityProbe;
  probe.scroller = scroller;
  const schedule = vi.spyOn(overlay, 'schedule').mockImplementation(() => {});
  const scroll = (target = scroller) => probe.onScroll({ target } as unknown as Event);
  return { overlay, probe, schedule, scroll, scroller, nested, container, body, replaceBody, view, win, anchors };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  for (const overlay of live.splice(0)) overlay.destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('per-view native scroll activity lifecycle', () => {
  it('ignores detached ink style records but schedules repair of host-removed reading decorations', () => {
    let notify!: (records: object[]) => void;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() {} disconnect() {}
    });
    const f = fixture();
    notify([{ type: 'attributes', target: f.nested, attributeName: 'style' }]);
    expect(f.schedule).not.toHaveBeenCalled();
    notify([{ type: 'childList', target: f.container, addedNodes: [], removedNodes: [f.probe.decorations.element] }]);
    expect(f.schedule).toHaveBeenCalledOnce();
  });
  it.each(['same preview', 'changed note', 'replaced sizer'])('repairs removed Reading decorations in the owning live preview (%s)', change => {
    let notify!: (records: object[]) => void;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() {} disconnect() {}
    });
    const f = fixture(), layer = f.probe.decorations.element;
    f.win.requestAnimationFrame.mock.calls[0][0](0);
    expect(layer.parentElement).toBe(f.body);
    layer.remove();
    if (change === 'changed note') f.view.file = { path: 'B.md' };
    if (change === 'replaced sizer') f.replaceBody();
    notify([
      { type: 'attributes', target: f.container, attributeName: 'style' },
      { type: 'childList', target: f.body, addedNodes: [], removedNodes: [layer] }
    ]);
    expect(layer.parentElement).toBe(change === 'same preview' ? f.body : undefined);
    expect(f.schedule).toHaveBeenCalledOnce();
  });
  it('keeps one quiet timer across wheel packets, then requests one settled render', () => {
    const f = fixture();
    f.scroll(); expect(f.probe.scrolling).toBe(true); expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(120); f.scroll();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(159); expect(f.probe.scrolling).toBe(true);
    const before = f.schedule.mock.calls.length;
    vi.advanceTimersByTime(1);
    expect(f.probe.scrolling).toBe(false); expect(f.probe.scrollIdleTimer).toBeUndefined();
    expect(f.schedule).toHaveBeenCalledTimes(before + 1); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000); expect(f.schedule).toHaveBeenCalledTimes(before + 1);
  });

  it('does not start or prolong this note’s gesture for a nested scrolling control', () => {
    const f = fixture(); f.scroll(f.nested);
    expect(f.probe.scrolling).toBe(false); expect(vi.getTimerCount()).toBe(0);
    f.scroll(); vi.advanceTimersByTime(100); f.scroll(f.nested); vi.advanceTimersByTime(60);
    expect(f.probe.scrolling).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('settles split views independently', () => {
    const a = fixture(), b = fixture();
    a.scroll(); vi.advanceTimersByTime(100); b.scroll();
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(60);
    expect(a.probe.scrolling).toBe(false); expect(b.probe.scrolling).toBe(true);
    vi.advanceTimersByTime(100); expect(b.probe.scrolling).toBe(false);
  });

  it('cancels a pending settled render when clearing the current note', () => {
    const f = fixture(); f.scroll(); f.schedule.mockClear(); f.probe.clearCards();
    expect(f.probe.scrolling).toBe(false); expect(f.probe.scrollIdleTimer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(1000);
    expect(f.schedule).not.toHaveBeenCalled();
  });

  it('removes the capture listener and pending timer when unloading', () => {
    const f = fixture(), remove = vi.spyOn(f.container, 'removeEventListener');
    f.scroll(); f.schedule.mockClear(); f.overlay.destroy();
    live.splice(live.indexOf(f.overlay), 1);
    expect(remove).toHaveBeenCalledWith('scroll', f.probe.onScroll, true);
    expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(1000);
    expect(f.schedule).not.toHaveBeenCalled();
  });
});

describe('per-view resize activity', () => {
  function prepare(lines?: LineMode) {
    let notify!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() {} unobserve() {} disconnect() {}
    });
    const f = fixture(lines), freeze = vi.spyOn(f.overlay, 'freezeLayout');
    f.overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
    const render = () => f.win.requestAnimationFrame.mock.calls[0][0](0);
    const changeWidth = (width: number) => { f.container.box.width = f.scroller.box.width = width; notify(); };
    const pointer = (name: string, pointerId: number, handle = false) => {
      const event = Object.assign(new Event(name), { pointerId, button: 0 });
      Object.defineProperty(event, 'target', { value: { closest: () => handle ? f.container : null } });
      f.win.dispatchEvent(event);
    };
    render();
    return { ...f, freeze, notify, changeWidth, pointer, render };
  }

  it('renders a real width change before paint, then coalesces the matching observer delivery', () => {
    const f = prepare();
    expect(f.anchors).toHaveBeenCalledOnce();
    expect(f.freeze).toHaveBeenCalledOnce();

    // A narrower pane with a body whose width and origin remain fixed only
    // changes the lanes. The RO pass sees it immediately and reuses the text.
    f.changeWidth(950); f.notify();
    expect(f.overlay.diagnostics).toMatchObject({ renders: 2, measurements: 1 });
    expect(f.anchors).toHaveBeenCalledOnce();
    expect(f.freeze).toHaveBeenCalledOnce();

    // Actual text wrapping/origin changes invalidate text even within the
    // same resize gesture, and postponing initialization survives a second step.
    vi.advanceTimersByTime(120);
    f.body.box.width = 550;
    f.changeWidth(900);
    expect(f.anchors).toHaveBeenCalledTimes(2);
    expect(f.freeze).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(159);
    expect(f.schedule).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.schedule).toHaveBeenCalledOnce();
    expect(f.probe.resizeIdleTimer).toBeUndefined();
  });

  it.each(['pointerup', 'pointercancel', 'blur'])('keeps a paused native divider held until %s', end => {
    const f = prepare();
    f.pointer('pointerdown', 2);
    f.render();
    expect(f.freeze).toHaveBeenCalledTimes(2);
    f.pointer('pointerdown', 3, true);
    f.changeWidth(950);
    f.pointer('pointerup', 2);
    vi.advanceTimersByTime(500);
    expect(f.probe.resizing).toBe(true);
    expect(f.freeze).toHaveBeenCalledTimes(2);
    expect(f.schedule).not.toHaveBeenCalled();
    f.pointer(end, 3);
    vi.advanceTimersByTime(160);
    expect(f.probe.resizing).toBe(false);
    expect(f.schedule).toHaveBeenCalledOnce();
    f.render();
    expect(f.freeze).toHaveBeenCalledTimes(3);
  });

  it('clears old placement entries when a same-size text body is replaced', () => {
    const f = prepare(), { stableLayout, layoutGeometry, layoutInput } = f.probe;
    const oldLayout = { ...layoutInput, anchors: [{ key: 'old-anchor', x: 350, y: 120 }] };
    expect(stableLayout.update(oldLayout, 0, layoutGeometry).map(p => p.key)).toEqual(['old-anchor']);

    f.replaceBody();
    // No old anchor remains under virtualization, but the pane size and lane
    // geometry are identical. Rendering must not dereference the old anchor.
    expect(() => f.notify()).not.toThrow();
    expect(f.anchors).toHaveBeenCalledTimes(2);
    expect(stableLayout.update(layoutInput, 0, layoutGeometry)).toEqual([]);
  });

  it('keeps collapsed cards out of the DOM and restores their presentation only during the same resize', () => {
    const f = prepare('none');
    const occurrence = parseWikilinks(f.view.data)[0], key = String(occurrence.start);
    const rect = { left: 350, right: 460, top: 100, bottom: 124 };
    f.anchors.mockReturnValue([{ key, occurrence, rect, fragments: [rect] }]);
    f.overlay.invalidateReadingAnchors(); f.render();
    const card = f.probe.cards.get(key)!;
    expect(card.shell.isConnected).toBe(true);
    f.probe.hovered = f.probe.focused = key;

    // Move the same fixed-width body with the native divider, closing both lanes.
    f.body.box.left = 25; f.changeWidth(650);
    expect(f.probe.cards.size).toBe(0);
    expect(f.probe.collapsedCards.get(key)).toBe(card);
    expect(card.shell.isConnected).toBe(false);
    expect(f.probe.hovered).toBeUndefined(); expect(f.probe.focused).toBeUndefined();
    expect(f.anchors).toHaveBeenCalledTimes(2);
    f.notify();
    expect(f.overlay.diagnostics?.renders).toBe(3);

    f.body.box.left = 100; f.changeWidth(800);
    expect(f.anchors).toHaveBeenCalledTimes(3);
    expect(f.probe.cards.get(key)).toBe(card);
    expect(card.shell.isConnected).toBe(true);
    expect(card.generation).toBe(1);
    expect(f.probe.collapsedCards.size).toBe(0);

    f.body.box.left = 25; f.changeWidth(650);
    vi.advanceTimersByTime(160);
    expect(f.probe.collapsedCards.size).toBe(0);
    f.body.box.left = 100; f.changeWidth(800);
    expect(f.probe.cards.get(key)).not.toBe(card);
  });

  it('skips text obstacle measurement when a resized hover pane has no interaction', () => {
    const read = vi.spyOn(TextObstacles.prototype, 'read').mockReturnValue([]);
    const f = prepare('hover');
    expect(read).toHaveBeenCalledOnce();
    f.body.box.left = 175; f.changeWidth(950);
    expect(f.anchors).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
    f.render();
    expect(read).toHaveBeenCalledOnce();
  });

  it('keeps a reading invalidation triggered during the current anchor measurement', () => {
    const f = prepare();
    f.anchors.mockImplementationOnce(() => { f.overlay.invalidateReadingAnchors(); return []; });
    f.overlay.invalidateReadingAnchors();
    f.render(); f.render();
    expect(f.anchors).toHaveBeenCalledTimes(3);
  });
});
