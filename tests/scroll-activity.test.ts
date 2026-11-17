import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import { MarginOverlay, type OverlayHost } from '../src/view/margin-overlay';
import { DEFAULT_PREFERENCES } from '../src/types';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(), parseLinktext: vi.fn() }));
vi.mock('../src/editor/drag-controller', () => ({ DragController: class { cancel() {} destroy() {} } }));
vi.mock('../src/view/card-drag-controller', () => ({ CardDragController: class { cancel() {} destroy() {} } }));

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent?: ElementStub;
  style: Record<string, string> = {};
  classList = { add: vi.fn(), remove: vi.fn() };
  constructor(readonly ownerDocument: DocumentStub) { super(); }
  createDiv() { return this.appendChild(this.ownerDocument.createElement()); }
  setAttribute() {}
  appendChild(child: ElementStub) { child.parent = this; this.children.push(child); return child; }
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
  scrolling: boolean;
  scroller?: ElementStub;
  scrollIdleTimer?: number;
  onScroll(event: Event): void;
  clearCards(): void;
}
const live: MarginOverlay[] = [];
function fixture() {
  const win = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn()
  });
  const doc: DocumentStub = { defaultView: win, fonts: new EventTarget(),
    createElement: () => new ElementStub(doc), createElementNS: () => new ElementStub(doc) };
  const container = new ElementStub(doc), scroller = new ElementStub(doc), nested = new ElementStub(doc);
  const overlay = new MarginOverlay({ contentEl: container } as unknown as MarkdownView,
    { preferences: { ...DEFAULT_PREFERENCES } } as unknown as OverlayHost);
  live.push(overlay);
  const probe = overlay as unknown as ActivityProbe;
  probe.scroller = scroller;
  const schedule = vi.spyOn(overlay, 'schedule').mockImplementation(() => {});
  const scroll = (target = scroller) => probe.onScroll({ target } as unknown as Event);
  return { overlay, probe, schedule, scroll, scroller, nested, container };
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
