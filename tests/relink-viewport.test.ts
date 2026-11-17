import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateEffect, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';
import { preserveRelinkViewport } from '../src/editor/relink-viewport';

const viewPosition = StateEffect.define<{ anchor: number; offset: number }>({
  map: (value, changes) => ({ ...value, anchor: changes.mapPos(value.anchor) })
});

function fixture() {
  const text = 'before [[old|alias]] after\n'.repeat(120);
  let state = EditorState.create({ doc: text });
  let viewport = { anchor: 2200, offset: 17.25 };
  const pixels = { top: 4503, left: 19 };
  const scrollTo = vi.fn((left: number, top: number) => { pixels.left = left; pixels.top = top; });
  const editor = { getScrollInfo: () => ({ ...pixels }), scrollTo } as unknown as Editor;
  const dispatch = vi.fn((spec: { effects: StateEffect<unknown> }) => {
    if (spec.effects.is(viewPosition)) viewport = spec.effects.value;
  });
  const cm = {
    get state() { return state; },
    scrollSnapshot: () => viewPosition.of({ ...viewport }), dispatch
  } as unknown as EditorView;
  const change: ChangeSpec = { from: 7, to: 20, insert: '[[a much longer path|alias]]' };
  const transact = (changes = change) => {
    state = state.update({ changes }).state;
    viewport = { anchor: 0, offset: 0 }; pixels.top = 0;
  };
  return { editor, cm, change, dispatch, scrollTo, pixels, transact, viewport: () => viewport };
}
afterEach(() => vi.useRealTimers());

describe('relink preserves the visual document anchor rather than revealing the old caret', () => {
  it('maps a saved viewport through the actual target replacement without another text or selection transaction', () => {
    const f = fixture(), original = f.viewport();
    const expected = f.cm.state.changes(f.change).mapPos(original.anchor);
    const restore = preserveRelinkViewport(f.editor, f.cm, f.change);
    f.transact(); restore();
    expect(f.viewport()).toEqual({ anchor: expected, offset: original.offset });
    expect(f.dispatch).toHaveBeenCalledOnce();
    expect(Object.keys(f.dispatch.mock.calls[0][0])).toEqual(['effects']);
    expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the unmapped snapshot after a rejected/no-op content transaction', () => {
    const f = fixture(), before = f.viewport();
    const restore = preserveRelinkViewport(f.editor, f.cm, f.change);
    restore(); expect(f.viewport()).toEqual(before);
    expect(f.dispatch).toHaveBeenCalledOnce(); expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('does not restore stale pixels if another edit changes the document unexpectedly', () => {
    const f = fixture(), restore = preserveRelinkViewport(f.editor, f.cm, f.change);
    f.transact({ from: 0, insert: 'independent edit\n' }); restore();
    expect(f.dispatch).not.toHaveBeenCalled(); expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('uses a synchronous pixel fallback for a host without native snapshots and schedules no later scroll', () => {
    vi.useFakeTimers();
    const f = fixture(), restore = preserveRelinkViewport(f.editor, undefined, f.change);
    f.pixels.top = 448; restore();
    expect(f.scrollTo).toHaveBeenCalledExactlyOnceWith(19, 4503);
    f.pixels.top = 5000; vi.runAllTimers();
    expect(f.pixels.top).toBe(5000); expect(vi.getTimerCount()).toBe(0);
  });
});
