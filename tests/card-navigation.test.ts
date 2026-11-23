import { describe, expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import { CardNavigation, type CardVisit } from '../src/view/card-navigation';
import { StableLayout } from '../src/view/stable-layout';

function setup() {
  const navigation = new CardNavigation();
  const file = { path: 'Note.md' }, receive = vi.fn();
  const leaf = { setEphemeralState: receive, view: undefined as unknown as MarkdownView };
  const read = () => ({ scroll: 0, cursor: { line: 12 } });
  const view = { leaf, file, getEphemeralState: read, getMode: () => 'preview',
    getState: () => ({ file: file.path }), setState: async () => {} } as unknown as MarkdownView;
  leaf.view = view;
  const visit: CardVisit = { path: file.path, source: 'text', mode: 'preview', geometry: 'wide', merged: true,
    top: 2400, left: 0, line: 91.05, sourceMode: false, layout: new StableLayout(), anchors: new Map() };
  const open = async () => {
    let state: Record<string, unknown> = {};
    await navigation.open(view, 'Target.html', visit, async () => { state = view.getEphemeralState(); file.path = 'Target.html'; });
    expect(view.getEphemeralState).toBe(read);
    return state;
  };
  const replaceView = (path: string) => {
    const file = { path };
    const next = { ...view, file, getState: () => ({ file: file.path }) } as unknown as MarkdownView;
    leaf.view = next;
    return next;
  };
  return { navigation, file, view, visit, receive, open, replaceView };
}

function waiting() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('card navigation belongs to one native leaf and history entry', () => {
  it('preserves other native state and consumes the correct visit only once', async () => {
    const f = setup(), state = await f.open();
    expect(state).toMatchObject({ scroll: 91.05, cursor: { line: 12 } });
    expect(f.navigation.take(f.view)).toBeUndefined();
    f.file.path = 'Note.md'; f.view.leaf.setEphemeralState(state);
    expect(f.receive).toHaveBeenCalledWith(state);
    expect(f.navigation.take(f.view)).toBe(f.visit);
    expect(f.navigation.take(f.view)).toBeUndefined();
  });
  it('supports direct reopen from a card target and yields to an explicit heading', async () => {
    const f = setup(); await f.open(); f.file.path = 'Note.md';
    expect(f.navigation.take(f.view)).toBe(f.visit);
    await f.open(); f.file.path = 'Note.md';
    f.view.leaf.setEphemeralState({ subpath: '#Heading' });
    expect(f.navigation.take(f.view)).toBeUndefined();
  });
  it('preserves outgoing target subpaths and cancels direct restore only in the matching source', async () => {
    const f = setup();
    await f.navigation.open(f.view, 'Target.html', f.visit, async () => {
      f.file.path = 'Target.html'; f.view.leaf.setEphemeralState({ subpath: '#Target' });
    });
    f.navigation.cancel(f.view);
    expect(f.navigation.take(f.replaceView('Note.md'))).toBe(f.visit);
  });
  it('releases snapshots on reset and the leaf hook on close', async () => {
    const f = setup(), state = await f.open();
    f.navigation.forget(f.visit.path);
    f.file.path = 'Note.md'; f.view.leaf.setEphemeralState(state);
    expect(f.navigation.take(f.view)).toBeUndefined();
    f.navigation.retain(new Set());
    expect(f.view.leaf.setEphemeralState).toBe(f.receive);
  });
  it('does not restore or move the source when the viewer opens externally', async () => {
    const f = setup();
    await f.navigation.open(f.view, 'Target.html', f.visit, async () => {});
    expect(f.navigation.take(f.view)).toBeUndefined();
  });
  it('rejects an in-app history marker from a previous plugin instance', async () => {
    const f = setup(), old = await f.open();
    f.navigation.retain(new Set());
    const restarted = new CardNavigation();
    const newVisit = { ...f.visit, top: 5100 };
    f.file.path = 'Note.md';
    let current: Record<string, unknown> = {};
    await restarted.open(f.view, 'Target.html', newVisit, async () => {
      current = f.view.getEphemeralState(); f.file.path = 'Target.html';
    });
    expect(current.marginLinkVisit).not.toBe(old.marginLinkVisit);
    f.file.path = 'Note.md'; f.view.leaf.setEphemeralState(old);
    expect(restarted.take(f.view)).toBeUndefined();
    f.view.leaf.setEphemeralState(current);
    expect(restarted.take(f.view)).toBe(newVisit);
  });

  it('keeps the latest same-leaf open intent when opens complete out of order', async () => {
    const f = setup(), earlier = waiting(), later = waiting();
    const newVisit = { ...f.visit, top: 5100 };
    const firstOpen = f.navigation.open(f.view, 'Target.html', f.visit, () => earlier.promise);
    const nextOpen = f.navigation.open(f.view, 'Target.html', newVisit, () => later.promise);
    f.file.path = 'Target.html'; later.resolve(); await nextOpen;
    earlier.resolve(); await firstOpen;
    const returning = f.replaceView('Note.md');
    expect(f.navigation.take(returning)).toBe(newVisit);
  });

  it('rejects a late open completion after the leaf visited a competing file', async () => {
    const f = setup(), gate = waiting();
    const opened = f.navigation.open(f.view, 'Target.html', f.visit, () => gate.promise);
    f.replaceView('Other.md'); f.navigation.retain(new Set([f.view.leaf]));
    f.replaceView('Target.html'); gate.resolve(); await opened;
    expect(f.navigation.take(f.replaceView('Note.md'))).toBeUndefined();
  });

  it('lets exact state survive a focus update but not be consumed by a stale view', async () => {
    const f = setup(), state = await f.open();
    const returning = f.replaceView('Note.md');
    f.view.leaf.setEphemeralState(state);
    f.view.leaf.setEphemeralState({ focus: true });
    expect(f.navigation.take(f.view)).toBeUndefined();
    expect(f.navigation.take(returning)).toBe(f.visit);
    expect(f.navigation.take(returning)).toBeUndefined();
  });

  it('yields to explicit native scroll and ignores a matching marker on the wrong file', async () => {
    const f = setup(), state = await f.open();
    f.replaceView('Other.md'); f.view.leaf.setEphemeralState(state);
    const returning = f.replaceView('Note.md');
    expect(f.navigation.take(returning)).toBeUndefined();
    f.view.leaf.setEphemeralState(state);
    f.view.leaf.setEphemeralState({ line: 12 });
    expect(f.navigation.take(returning)).toBeUndefined();
  });

  it('does not re-arm a delayed mode restore after native navigation supersedes it', async () => {
    const f = setup(), state = await f.open(), gate = waiting();
    f.file.path = 'Note.md'; f.view.leaf.setEphemeralState(state);
    const visit = f.navigation.take(f.view)!;
    vi.spyOn(f.view, 'setState').mockReturnValue(gate.promise);
    const restore = f.navigation.restoreMode(f.view, visit);
    f.view.leaf.setEphemeralState({ subpath: '#New' });
    gate.resolve(); await restore;
    expect(f.navigation.take(f.view)).toBeUndefined();
  });

  it('re-arms one matching visit after an uncontested mode restore', async () => {
    const f = setup(), state = await f.open();
    const returning = f.replaceView('Note.md'); f.view.leaf.setEphemeralState(state);
    const visit = f.navigation.take(returning)!;
    await f.navigation.restoreMode(returning, visit);
    expect(f.navigation.take(returning)).toBe(f.visit);
    expect(f.navigation.take(returning)).toBeUndefined();
  });

  it('cancels this inbound visit on user input and preserves history for a later return', async () => {
    const f = setup(), state = await f.open(), gate = waiting();
    f.file.path = 'Note.md'; f.view.leaf.setEphemeralState(state);
    vi.spyOn(f.view, 'setState').mockReturnValue(gate.promise);
    const restore = f.navigation.restoreMode(f.view, f.navigation.take(f.view)!);
    f.navigation.cancel(f.view);
    gate.resolve(); await restore;
    expect(f.navigation.take(f.view)).toBeUndefined();
    f.view.leaf.setEphemeralState(state);
    expect(f.navigation.take(f.view)).toBe(f.visit);
    await f.open(); f.file.path = 'Note.md';
    f.navigation.cancel(f.view);
    expect(f.navigation.take(f.view)).toBeUndefined();
  });
});
