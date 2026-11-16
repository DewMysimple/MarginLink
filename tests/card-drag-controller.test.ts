import { describe, expect, it, vi } from 'vitest';
import { CardDragController, type CardDragContext } from '../src/view/card-drag-controller';
import { DEFAULT_PREFERENCES } from '../src/types';
import type { LayoutInput } from '../src/view/layout-engine';

// Node's EventTarget does not normalize boolean capture options on removal.
class Events extends EventTarget {
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  }
}
// Exercise pointer/click ordering without loading Obsidian or a browser host.
class ElementStub extends Events {
  style = {};
  textContent = '';
  private classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach(n => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach(n => this.classes.delete(n)),
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
  };
  createDiv(): ElementStub { return new ElementStub(); }
  contains(node: unknown): boolean { return node === this; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1400, height: 800 }; }
  setPointerCapture() { /* Document listeners handle the test gesture. */ }
  hasPointerCapture() { return false; }
  focus() { /* No mounted DOM. */ }
  remove() { /* No mounted DOM. */ }
}
function pointer(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  return Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId, button: 0 }) as PointerEvent;
}
function click(detail = 1): MouseEvent { return Object.assign(new Event('click', { cancelable: true }), { detail }) as MouseEvent; }
function setup() {
  const win = new Events(), doc = Object.assign(new Events(), { defaultView: win });
  const root = Object.assign(new ElementStub(), { ownerDocument: doc });
  const card = new ElementStub();
  const input: LayoutInput = { width: 1400, height: 800, body: { left: 360, right: 1040, top: 0, bottom: 800 },
    viewport: { left: 0, right: 1400, top: 0, bottom: 800 }, density: 'auto', layout: 'balanced',
    preferences: { ...DEFAULT_PREFERENCES, placementMode: 'free' }, anchors: [{ key: 'a', x: 700, y: 300 }] };
  const context: CardDragContext = { input, anchor: input.anchors[0], occupied: [], valid: () => true };
  const preview = vi.fn(), commit = vi.fn();
  const drag = new CardDragController(root as unknown as HTMLElement, () => context, preview, commit);
  const start = () => drag.start(pointer('pointerdown', 1200, 300), 'a', card as unknown as HTMLElement);
  const move = (x = 1200, y = 500) => doc.dispatchEvent(pointer('pointermove', x, y));
  const up = (x = 1200, y = 500) => doc.dispatchEvent(pointer('pointerup', x, y));
  return { drag, doc, win, card, start, move, up, preview, commit, context };
}

describe('whole-card gestures', () => {
  it('leaves a sub-threshold click available, then commits a real drag once and consumes only its click', () => {
    const s = setup(); s.start(); s.move(1203, 302); s.up(1203, 302);
    expect(s.commit).not.toHaveBeenCalled(); expect(s.drag.consumeClick(click(), 'a')).toBe(false);
    s.start(); s.move(); s.up();
    expect(s.commit).toHaveBeenCalledTimes(1); expect(s.commit.mock.calls[0][1].side).toBe('right');
    expect(s.drag.consumeClick(click(), 'a')).toBe(true);
    s.start(); s.up(1200, 300); expect(s.drag.consumeClick(click(), 'a')).toBe(false);
  });
  it.each(['Escape', 'pointercancel', 'blur', 'focus', 'invalid', 'stale', 'lostcapture'])(
    'restores and suppresses navigation after %s, including when the browser emits no cancelled click', reason => {
      const s = setup(); s.start(); s.move();
      if (reason === 'Escape') s.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
      if (reason === 'pointercancel') s.doc.dispatchEvent(pointer('pointercancel', 1200, 500));
      if (reason === 'blur') s.win.dispatchEvent(new Event('blur'));
      if (reason === 'focus') s.doc.dispatchEvent(new Event('focusin'));
      if (reason === 'invalid') s.up(700, 500);
      if (reason === 'stale') { s.context.valid = () => false; s.up(); }
      if (reason === 'lostcapture') s.card.dispatchEvent(new Event('lostpointercapture'));
      s.up();
      expect(s.commit).not.toHaveBeenCalled(); expect(s.drag.dragging).toBe(false);
      expect(s.preview).toHaveBeenLastCalledWith('a');
      // Keyboard activation remains independent of a pointer cancellation.
      expect(s.drag.consumeClick(click(0), 'a')).toBe(false);
      s.start(); s.up(1200, 300); expect(s.drag.consumeClick(click(), 'a')).toBe(false);
    });
  it('ignores other pointers and validates the actual release point', () => {
    const s = setup(); s.start(); s.doc.dispatchEvent(pointer('pointermove', 1200, 500, 2));
    s.doc.dispatchEvent(pointer('pointerup', 1200, 500, 2)); expect(s.drag.dragging).toBe(true);
    s.move(); s.up(700, 500); expect(s.commit).not.toHaveBeenCalled();
    expect(s.drag.consumeClick(click(), 'a')).toBe(true);
  });
  it('destroys an active gesture without committing or retaining document listeners', () => {
    const s = setup(); s.start(); s.move(); s.drag.destroy(); s.move(); s.up();
    expect(s.commit).not.toHaveBeenCalled(); expect(s.drag.dragging).toBe(false);
  });
});
