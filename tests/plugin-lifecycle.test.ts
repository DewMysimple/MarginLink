import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, type App, type PluginManifest } from 'obsidian';
import MarginLinkPlugin from '../src/main';
import { SETTINGS_VIEW_TYPE } from '../src/ui/settings-view';
import { layoutIdentities } from '../src/core/layout-identity';
import { parseWikilinks } from '../src/core/wikilink-parser';
import { MarginOverlay } from '../src/view/margin-overlay';

vi.mock('obsidian', () => ({
  Plugin: class {
    constructor(readonly app: unknown) {}
    loadData = vi.fn(async () => null);
    saveData = vi.fn(async (_data: unknown) => {});
    addCommand = vi.fn(); addRibbonIcon = vi.fn(); addSettingTab = vi.fn();
    registerView = vi.fn(); registerEvent = vi.fn(); registerEditorExtension = vi.fn(); registerMarkdownPostProcessor = vi.fn();
  },
  MarkdownView: class {}, Modal: class {}, Notice: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}
}));
vi.mock('../src/view/margin-overlay', () => ({ MarginOverlay: class { constructor(readonly view: unknown) {} schedule() {} cancelInteractions() {} destroy() {} } }));
vi.mock('../src/reading/reading-anchors', () => ({ ReadingAnchors: class { clear() {} } }));
vi.mock('../src/editor/selection-action', () => ({ SelectionAction: class { cancel() {} } }));
vi.mock('../src/editor/editor-extension', () => ({ editorExtension: () => undefined }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function note(path: string): MarkdownView {
  return Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    file: { path }, containerEl: new EventTarget(), getMode: () => 'source', editor: { getValue: () => '' }
  });
}
function leaf() {
  return {
    view: { getViewType: () => 'empty' }, location: 'right',
    setViewState: vi.fn<(state: { type: string }) => Promise<void>>(), detach: vi.fn()
  };
}
function fixture(notes: MarkdownView[] = [], ready?: Promise<void>) {
  const leaves: ReturnType<typeof leaf>[] = [];
  const state = { active: notes[0] as MarkdownView | undefined };
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const metadataHandlers = new Map<string, (...args: unknown[]) => void>();
  const workspace = {
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => { handlers.set(name, callback); }),
    onLayoutReady: (callback: () => void) => callback(),
    iterateAllLeaves: (callback: (leaf: { view: unknown }) => void) => [...notes.map(view => ({ view })), ...leaves].forEach(callback),
    getActiveViewOfType: () => state.active,
    getMostRecentLeaf: () => state.active ? { view: state.active } : undefined,
    getLeavesOfType: (type: string) => leaves.filter(item => item.view.getViewType() === type),
    getRightLeaf: vi.fn(() => {
      const item = leaf(); leaves.push(item);
      item.setViewState.mockImplementation(async ({ type }) => { await ready; item.view.getViewType = () => type; });
      item.detach.mockImplementation(() => { const index = leaves.indexOf(item); if (index >= 0) leaves.splice(index, 1); });
      return item;
    }),
    revealLeaf: vi.fn(async (_leaf: unknown) => {}),
    setActiveLeaf: vi.fn(() => { state.active = undefined; }),
    detachLeavesOfType: (type: string) => [...leaves].filter(item => item.view.getViewType() === type).forEach(item => item.detach())
  };
  const app = { workspace, metadataCache: { on: (name: string, callback: (...args: unknown[]) => void) => metadataHandlers.set(name, callback) }, vault: { on: vi.fn() } };
  const plugin = new MarginLinkPlugin(app as unknown as App, {} as PluginManifest);
  return { plugin, workspace, handlers, metadataHandlers, state, leaves };
}

beforeEach(() => { vi.stubGlobal('window', globalThis); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('settings panel lifecycle', () => {
  it('opens one panel for concurrent requests, respects moved tabs, and can reopen a closed tab', async () => {
    const ready = deferred();
    const { plugin, workspace, handlers, leaves } = fixture([note('A.md')], ready.promise);
    await plugin.onload();
    const first = plugin.openSettingsPanel(), second = plugin.openSettingsPanel();
    expect(first).toBe(second);
    expect(workspace.getRightLeaf).toHaveBeenCalledTimes(1);
    ready.resolve(); await first;
    const panel = leaves[0]; panel.location = 'left';
    await plugin.openSettingsPanel();
    expect(workspace.getRightLeaf).toHaveBeenCalledTimes(1);
    expect(workspace.revealLeaf).toHaveBeenLastCalledWith(panel);
    expect(panel.location).toBe('left');
    const revealed = workspace.revealLeaf.mock.calls.length;
    handlers.get('layout-change')?.();
    expect(workspace.revealLeaf).toHaveBeenCalledTimes(revealed);
    panel.detach();
    await plugin.openSettingsPanel();
    expect(workspace.getRightLeaf).toHaveBeenCalledTimes(2);
    expect(workspace.getLeavesOfType(SETTINGS_VIEW_TYPE)).toHaveLength(1);
    plugin.onunload();
    expect(workspace.getLeavesOfType(SETTINGS_VIEW_TYPE)).toHaveLength(0);
  });

  it('removes a panel whose asynchronous creation finishes after plugin unload', async () => {
    const ready = deferred();
    const { plugin, workspace, leaves } = fixture([], ready.promise);
    await plugin.onload();
    const opening = plugin.openSettingsPanel();
    const pending = leaves[0];
    plugin.onunload(); ready.resolve(); await opening;
    expect(pending.detach).toHaveBeenCalledOnce();
    expect(workspace.getLeavesOfType(SETTINGS_VIEW_TYPE)).toHaveLength(0);
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
  });

  it('uses the most recently operated Markdown split while settings own focus, then removes note listeners on unload', async () => {
    const a = note('A.md'), b = note('B.md');
    const { plugin, handlers, state } = fixture([a, b]);
    await plugin.onload();
    await plugin.openSettingsPanel();
    expect(plugin.activeSource()).toBe('A.md');
    b.containerEl.dispatchEvent(new Event('pointerdown'));
    expect(plugin.activeSource()).toBe('B.md');
    const reset = vi.spyOn(plugin, 'confirmReset').mockImplementation(() => {});
    const command = vi.mocked(plugin.addCommand).mock.calls.map(([command]) => command).find(command => command.id === 'reset-note-layout');
    command?.callback?.(); expect(reset).toHaveBeenLastCalledWith('B.md');
    state.active = a; handlers.get('active-leaf-change')?.({ view: a });
    command?.callback?.(); expect(reset).toHaveBeenLastCalledWith('A.md');
    plugin.onunload();
    b.containerEl.dispatchEvent(new Event('pointerdown'));
    expect(plugin.activeSource()).toBeUndefined();
  });
});

it('keeps the new active note’s pointer gesture when native focus reports leaf activation after pointerdown', async () => {
  const a = note('A.md'), b = note('B.md');
  const { plugin, handlers, state } = fixture([a, b]); await plugin.onload();
  const cancel = vi.spyOn(MarginOverlay.prototype, 'cancelInteractions');
  // The new card's pointerdown has already selected B, while Obsidian still
  // reports its old active leaf until the ensuing focus activation callback.
  b.containerEl.dispatchEvent(new Event('pointerdown')); state.active = b;
  handlers.get('active-leaf-change')?.({ view: b });
  expect(cancel.mock.contexts.map(overlay => (overlay as MarginOverlay).view)).toEqual([a]);
  expect(plugin.activeSource()).toBe('B.md');
  cancel.mockClear();
  handlers.get('file-open')?.();
  expect(cancel.mock.contexts.map(overlay => (overlay as MarginOverlay).view)).toEqual([a, b]);
  plugin.onunload();
});

it('reconciles a matching CRLF cache document against its LF editor while ignoring an older unsaved snapshot', async () => {
  const a = note('A.md');
  let text = '# A\n[[Target|item]]\n';
  a.editor.getValue = () => text;
  const { plugin, metadataHandlers } = fixture([a]); await plugin.onload();
  const key = [...layoutIdentities(text, parseWikilinks(text)).values()][0];
  const position = { side: 'right' as const, xNormalized: 0.7, yOffset: 3 };
  plugin.layouts.set('A.md', key, position);
  const deletedLinkKey = 'b'.repeat(64);
  plugin.layouts.set('A.md', deletedLinkKey, position);
  const savedText = text.replaceAll('\n', '\r\n');
  metadataHandlers.get('changed')?.({ path: 'A.md', extension: 'md' }, savedText);
  expect(plugin.layouts.get('A.md', deletedLinkKey)).toBeUndefined();
  expect(plugin.layouts.get('A.md', key)).toEqual(position);
  text = 'New context\n' + text;
  const unsavedKey = [...layoutIdentities(text, parseWikilinks(text)).values()][0];
  plugin.layouts.set('A.md', unsavedKey, position);
  metadataHandlers.get('changed')?.({ path: 'A.md', extension: 'md' }, savedText);
  expect(plugin.layouts.get('A.md', unsavedKey)).toEqual(position);
  plugin.onunload();
});

it('serializes delayed writes so consecutive drops and pending debounce cannot overwrite the newest position', async () => {
  const { plugin } = fixture(); await plugin.onload();
  const firstWrite = deferred();
  const save = vi.spyOn(plugin, 'saveData').mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
  const key = 'a'.repeat(64);
  const position = (yOffset: number) => ({ side: 'right' as const, xNormalized: 0.7, yOffset });
  plugin.layouts.set('A.md', key, position(1)); const first = plugin.flush();
  plugin.layouts.set('A.md', key, position(2)); const second = plugin.flush();
  plugin.layouts.set('A.md', key, position(3));
  expect(plugin.layouts.get('A.md', key)).toEqual(position(3));
  await vi.advanceTimersByTimeAsync(250);
  expect(save).toHaveBeenCalledOnce();
  firstWrite.resolve(); await Promise.all([first, second, plugin.flush()]);
  const snapshots = save.mock.calls.map(([data]) => data as { layouts: { yOffset: number }[] });
  expect(snapshots.map(snapshot => snapshot.layouts[0].yOffset)).toEqual([1, 2, 3, 3]);
  plugin.onunload();
});
