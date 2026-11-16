import { describe, expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import type { EditorBridge } from '../src/editor/editor-extension';
import type { SelectionAction } from '../src/editor/selection-action';
import { DragController } from '../src/editor/drag-controller';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));
class Events extends EventTarget {
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  }
}
class ElementStub extends Events {
  style = {}; dataset = {}; hidden = false;
  classes = new Set<string>();
  classList = { add: (...n: string[]) => n.forEach(v => this.classes.add(v)), remove: (...n: string[]) => n.forEach(v => this.classes.delete(v)),
    toggle: (n: string, on: boolean) => on ? this.classes.add(n) : this.classes.delete(n) };
  createEl() { return new ElementStub(); }
  createDiv() { return new ElementStub(); }
  createSpan() { return new ElementStub(); }
  getBoundingClientRect() { return { left: 700, right: 732, top: 300, bottom: 332 }; }
}
function pointer(type: string, x = 716, y = 316, pointerId = 1) {
  return Object.assign(new Event(type, { cancelable: true }), { button: 0, clientX: x, clientY: y, pointerId });
}
function key(value: string, repeat = false) { return Object.assign(new Event('keydown', { cancelable: true }), { key: value, repeat }); }
function setup() {
  const win = new Events(), doc = Object.assign(new Events(), { defaultView: win });
  const root = Object.assign(new ElementStub(), { ownerDocument: doc });
  const selection = { main: { from: 0, to: 7 }, ranges: [{}] };
  const bridge = { alive: true, revision: 1, cm: { hasFocus: true, state: { selection, doc: { toString: () => 'streams' } } },
    text: 'streams', rangeRects: () => [{ top: 280, bottom: 298, right: 694 }] };
  const view = { file: { path: 'Source.md' }, getMode: () => 'source' };
  const snapshot = { sourcePath: 'Source.md', from: 0, to: 7, text: 'streams', selected: 'streams', revision: 1 };
  const action = { capture: vi.fn(() => snapshot), open: vi.fn() };
  const drag = new DragController(root as unknown as HTMLElement, view as unknown as MarkdownView, action as unknown as SelectionAction);
  drag.update(bridge as unknown as EditorBridge, { left: 0, top: 0, width: 1400 } as DOMRect,
    { left: 0, right: 1400, top: 0, bottom: 800 }, { left: 360, right: 1040, top: 0, bottom: 800 });
  const down = () => drag.handle.dispatchEvent(pointer('pointerdown'));
  const move = (x: number, y = 316, id = 1) => doc.dispatchEvent(pointer('pointermove', x, y, id));
  const up = (x = 716, y = 316, id = 1) => doc.dispatchEvent(pointer('pointerup', x, y, id));
  return { drag, doc, win, view, bridge, selection, action, snapshot, down, move, up };
}
describe('selection handle activation', () => {
  it('opens one picker from a plain click; the subsequent browser click does not reopen it', () => {
    const s = setup(); s.down(); s.up(); s.up(); s.drag.handle.dispatchEvent(new Event('click'));
    expect(s.action.capture).toHaveBeenCalledTimes(1); expect(s.action.open).toHaveBeenCalledExactlyOnceWith(s.view, s.bridge, s.snapshot, undefined);
  });
  it('accepts exactly the threshold as a click and keeps a drag irreversible after returning to the handle', () => {
    const s = setup(); s.down(); s.move(720); s.up(720); expect(s.action.open).toHaveBeenCalledTimes(1);
    s.action.open.mockClear(); s.down(); s.move(721); s.up(); expect(s.action.open).not.toHaveBeenCalled();
  });
  it('opens only on a legal margin drop, using final release displacement without a pointermove', () => {
    const s = setup(); s.down(); s.up(1200); expect(s.action.open).toHaveBeenCalledExactlyOnceWith(s.view, s.bridge, s.snapshot, 'right');
    s.action.open.mockClear(); s.down(); s.move(1200); s.up(700); expect(s.action.open).not.toHaveBeenCalled();
  });
  it('does not activate a sub-threshold release outside the handle', () => {
    const s = setup(); s.down(); s.up(716, 334); expect(s.action.open).not.toHaveBeenCalled();
  });
  it.each(['Escape', 'pointercancel', 'blur', 'revision', 'selection', 'file', 'mode', 'dead'])('cancels %s without a later click reopening', reason => {
    const s = setup(); s.down();
    if (reason === 'Escape') s.doc.dispatchEvent(key('Escape'));
    if (reason === 'pointercancel') s.doc.dispatchEvent(pointer('pointercancel'));
    if (reason === 'blur') s.win.dispatchEvent(new Event('blur'));
    if (reason === 'revision') s.bridge.revision++;
    if (reason === 'selection') s.selection.main.to--;
    if (reason === 'file') s.view.file.path = 'Other.md';
    if (reason === 'mode') s.view.getMode = () => 'preview';
    if (reason === 'dead') s.bridge.alive = false;
    s.up(); s.drag.handle.dispatchEvent(new Event('click')); expect(s.action.open).not.toHaveBeenCalled();
  });
  it('ignores unrelated pointer releases, cancellation, and new presses during the captured gesture', () => {
    const s = setup(); s.down(); s.drag.handle.dispatchEvent(pointer('pointerdown', 716, 316, 2));
    s.move(1200, 316, 2); s.up(1200, 316, 2); s.doc.dispatchEvent(pointer('pointercancel', 716, 316, 2));
    expect(s.action.open).not.toHaveBeenCalled(); s.up(); expect(s.action.capture).toHaveBeenCalledTimes(1); expect(s.action.open).toHaveBeenCalledTimes(1);
  });
  it.each(['Enter', ' '])('preserves %s activation and suppresses repeated or follow-up native clicks', value => {
    const s = setup(); s.drag.handle.dispatchEvent(key(value)); s.drag.handle.dispatchEvent(key(value, true)); s.drag.handle.dispatchEvent(new Event('click'));
    expect(s.action.open).toHaveBeenCalledTimes(1);
  });
  it('removes pending document listeners on destroy and keeps a second pane independent', () => {
    const a = setup(), b = setup(); a.down(); b.down(); a.drag.destroy(); a.up(); b.up();
    expect(a.action.open).not.toHaveBeenCalled(); expect(b.action.open).toHaveBeenCalledTimes(1);
  });
});
