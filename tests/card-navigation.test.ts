import { describe, expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import { CardNavigation, type CardVisit } from '../src/view/card-navigation';
import { StableLayout } from '../src/view/stable-layout';

function setup() {
  const navigation = new CardNavigation();
  const file = { path: 'Note.md' }, receive = vi.fn();
  const leaf = { setEphemeralState: receive, view: { getState: () => ({ file: file.path }) } };
  const read = () => ({ scroll: 0, cursor: { line: 12 } });
  const view = { leaf, file, getEphemeralState: read, getMode: () => 'preview' } as unknown as MarkdownView;
  const visit: CardVisit = { path: file.path, source: 'text', mode: 'preview', geometry: 'wide', merged: true,
    top: 2400, left: 0, line: 91.05, sourceMode: false, layout: new StableLayout(), anchors: new Map() };
  const open = async () => {
    let state: Record<string, unknown> = {};
    await navigation.open(view, 'Target.html', visit, async () => { state = view.getEphemeralState(); file.path = 'Target.html'; });
    expect(view.getEphemeralState).toBe(read);
    return state;
  };
  return { navigation, file, view, visit, receive, open };
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
});
