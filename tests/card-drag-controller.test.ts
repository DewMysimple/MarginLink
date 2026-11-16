import { describe, expect, it, vi } from 'vitest';
import { CardDragController, type CardDragContext } from '../src/view/card-drag-controller';
import { DEFAULT_PREFERENCES } from '../src/types';
import type { CardShape } from '../src/types';
import { layoutCards, type LayoutInput } from '../src/view/layout-engine';

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
  rect = { left: 0, top: 0, width: 1400, height: 800 };
  children: { cls?: string; text?: string }[] = [];
  private classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach(n => this.classes.add(n)),
    remove: (...names: string[]) => names.forEach(n => this.classes.delete(n)),
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  createDiv(options: { cls?: string; text?: string } = {}): ElementStub { this.children.push(options); return new ElementStub(); }
  contains(node: unknown): boolean { return node === this; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture() { /* Document listeners handle the test gesture. */ }
  hasPointerCapture() { return false; }
  focus() { /* No mounted DOM. */ }
  remove() { /* No mounted DOM. */ }
}
function pointer(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  return Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId, button: 0 }) as PointerEvent;
}
function click(detail = 1): MouseEvent { return Object.assign(new Event('click', { cancelable: true }), { detail }) as MouseEvent; }
function setup(cardShape: CardShape = 'square') {
  const win = new Events(), doc = Object.assign(new Events(), { defaultView: win });
  const root = Object.assign(new ElementStub(), { ownerDocument: doc });
  const card = new ElementStub();
  card.rect = { left: 1158, top: 258, width: cardShape === 'horizontal' ? 196 : cardShape === 'icon' ? 36 : 84,
    height: cardShape === 'horizontal' ? 48 : cardShape === 'icon' ? 36 : 84 };
  const input: LayoutInput = { width: 1400, height: 800, body: { left: 360, right: 1040, top: 0, bottom: 800 },
    viewport: { left: 0, right: 1400, top: 0, bottom: 800 }, density: 'auto', layout: 'balanced',
    preferences: { ...DEFAULT_PREFERENCES, placementMode: 'free', cardShape }, anchors: [{ key: 'a', x: 700, y: 300 }] };
  const context: CardDragContext = { input, anchor: input.anchors[0], occupied: [], valid: () => true };
  const preview = vi.fn(), commit = vi.fn();
  const contextProvider = vi.fn<() => CardDragContext | undefined>(() => context);
  const drag = new CardDragController(root as unknown as HTMLElement, contextProvider, preview, commit);
  const press = (x: number, y: number) => drag.start(pointer('pointerdown', x, y), 'a', card as unknown as HTMLElement);
  const start = () => press(1200, 300);
  const move = (x = 1200, y = 500) => doc.dispatchEvent(pointer('pointermove', x, y));
  const up = (x = 1200, y = 500) => doc.dispatchEvent(pointer('pointerup', x, y));
  return { drag, doc, win, root, card, press, start, move, up, preview, commit, context, contextProvider };
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
  it.each<CardShape>(['horizontal', 'square', 'icon'])('keeps the original grab offset through the threshold and the final release for %s', shape => {
    const s = setup(shape);
    const r = s.card.rect, grab = { x: r.left + r.width - 6, y: r.top + 6 };
    s.press(grab.x, grab.y); s.move(grab.x + 3, grab.y + 2);
    expect(s.preview).not.toHaveBeenCalled();
    s.move(grab.x + 8, grab.y + 12);
    expect(s.preview.mock.calls.at(-1)?.[1]).toMatchObject({ x: r.left + 8, y: r.top + 12 });
    s.move(grab.x + 12, grab.y + 30);
    expect(s.preview.mock.calls.at(-1)?.[1]).toMatchObject({ x: r.left + 12, y: r.top + 30 });
    // Release uses its own last coordinates, rather than the previous preview.
    s.up(grab.x + 16, grab.y + 42); s.up(grab.x + 16, grab.y + 42);
    expect(s.commit).toHaveBeenCalledTimes(1);
    const restored = layoutCards({ ...s.context.input, anchors: [{ ...s.context.anchor, manual: s.commit.mock.calls[0][1] }] })[0];
    expect(restored.x).toBeCloseTo(r.left + 16); expect(restored.y).toBeCloseTo(r.top + 42);
  });
  it('uses CSS client coordinates and the whole card rect even when the pointer originated on a child', () => {
    const s = setup(); s.root.rect.left = 200; s.root.rect.top = 100;
    s.card.rect = { left: 1400, top: 300, width: 84, height: 84 };
    const event = pointer('pointerdown', 1478, 306);
    Object.defineProperty(event, 'target', { value: new ElementStub() });
    Object.assign(event, { offsetX: 1, offsetY: 1 });
    s.drag.start(event, 'a', s.card as unknown as HTMLElement); s.move(1486, 318);
    expect(s.preview.mock.calls.at(-1)?.[1]).toMatchObject({ x: 1208, y: 212 });
    s.up(1486, 318); expect(s.commit).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, NaN, Infinity])('safely refuses a card with invalid width %s', width => {
    const s = setup(); s.card.rect.width = width; s.start(); s.move(); s.up();
    expect(s.drag.dragging).toBe(false); expect(s.commit).not.toHaveBeenCalled(); expect(s.preview).not.toHaveBeenCalled();
  });
  it('creates only empty boundary elements and never creates a following text bubble', () => {
    const s = setup(); s.start(); s.move(); s.move(700, 500); s.move(1200, 500); s.up();
    expect(s.root.children).toEqual([{ cls: 'margin-link-position-band' }, { cls: 'margin-link-position-band' }]);
    expect(s.root.classList.contains('margin-link-card-dragging')).toBe(false);
  });
  it('ignores cancellation from a different pointer and removes cancellation listeners on completion', () => {
    const s = setup(); s.start(); s.doc.dispatchEvent(pointer('pointercancel', 1200, 500, 2));
    expect(s.drag.dragging).toBe(true); s.move(); s.up();
    s.doc.dispatchEvent(pointer('pointercancel', 1200, 500));
    expect(s.commit).toHaveBeenCalledTimes(1); expect(s.drag.dragging).toBe(false);
  });
  it('does not commit after the host becomes zero-sized or the target geometry becomes invalid', () => {
    for (const invalid of ['host', 'input'] as const) {
      const s = setup(); s.start(); s.move();
      if (invalid === 'host') s.root.rect.width = 0;
      else s.context.input.body.right = NaN;
      s.up(); expect(s.commit).not.toHaveBeenCalled(); expect(s.drag.dragging).toBe(false);
    }
  });
  it.each(['no-move', 'sub-threshold-move'])('uses the final release displacement when the last pointermove was not delivered: %s', delivery => {
    const s = setup(); s.card.rect = { left: 1200, top: 200, width: 84, height: 84 };
    s.press(1278, 206);
    if (delivery === 'sub-threshold-move') s.move(1281, 208);
    expect(s.preview).not.toHaveBeenCalled();
    s.up(1286, 218); s.up(1286, 218);
    expect(s.commit).toHaveBeenCalledTimes(1);
    const restored = layoutCards({ ...s.context.input, anchors: [{ ...s.context.anchor, manual: s.commit.mock.calls[0][1] }] })[0];
    expect(restored).toMatchObject({ x: 1208, y: 212 });
    expect(s.drag.consumeClick(click(), 'a')).toBe(true);
    s.press(1278, 206); s.up(1278, 206);
    expect(s.commit).toHaveBeenCalledTimes(1); expect(s.drag.consumeClick(click(), 'a')).toBe(false);
  });
  it.each(['host', 'input', 'missing-context', 'invalid-context'])('immediately cancels and restores when active geometry is lost: %s', reason => {
    const s = setup(); s.start(); s.move();
    if (reason === 'host') s.root.rect.width = 0;
    if (reason === 'input') s.context.input.width = 0;
    if (reason === 'missing-context') s.contextProvider.mockReturnValue(undefined);
    if (reason === 'invalid-context') s.contextProvider.mockReturnValue({ ...s.context, valid: () => false });
    s.move(1200, 520);
    expect(s.drag.dragging).toBe(false); expect(s.root.classList.contains('margin-link-card-dragging')).toBe(false);
    expect(s.drag.placement('a')).toBeUndefined(); expect(s.preview).toHaveBeenLastCalledWith('a');
    s.up(); s.move();
    expect(s.commit).not.toHaveBeenCalled(); expect(s.preview.mock.calls.filter(args => args.length === 1)).toHaveLength(1);
    expect(s.drag.consumeClick(click(), 'a')).toBe(true);
  });
  it('keeps the last legal preview during an ordinary invalid drop region and permits returning to a lane', () => {
    const s = setup(); s.start(); s.move(); const legal = s.drag.placement('a');
    s.move(700, 500);
    expect(s.drag.dragging).toBe(true); expect(s.drag.placement('a')).toEqual(legal);
    expect(s.root.classList.contains('margin-link-drop-valid')).toBe(false);
    s.move(1208, 512); expect(s.drag.placement('a')).toMatchObject({ x: 1166, y: 470 });
    s.up(1208, 512); expect(s.commit).toHaveBeenCalledTimes(1);
  });
});
