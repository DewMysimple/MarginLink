import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, resolveSubpath, type App } from 'obsidian';
import { SelectionAction } from '../src/editor/selection-action';
import type { EditorBridge } from '../src/editor/editor-extension';
import type { WikilinkOccurrence } from '../src/types';
import { DEFAULT_PREFERENCES } from '../src/types';
import { parseDocument, parseWikilinks } from '../src/core/wikilink-parser';
import { LayoutStore } from '../src/core/layout-store';
import { layoutIdentities } from '../src/core/layout-identity';
import type { PickerOptions } from '../src/ui/file-picker';

const ui = vi.hoisted(() => ({ pickers: [] as FakePicker[], modals: [] as { buttons: { text: string; onclick?: () => void }[] }[], notices: [] as string[] }));
interface FakePicker {
  actions: { validate(): void; existing(file: unknown): Promise<void>; create(folder: string, name: string, window: boolean): Promise<void>; closed(): void };
  options?: PickerOptions; closed: boolean;
}
vi.mock('../src/ui/file-picker', () => ({ FilePicker: class {
  shouldRestoreSelection = true; closed = false;
  constructor(_app: unknown, _alias: string, _preferences: unknown, readonly actions: FakePicker['actions'], readonly options?: FakePicker['options']) { ui.pickers.push(this); }
  open() {}
  close() { this.closed = true; this.actions.closed(); }
} }));
vi.mock('obsidian', () => ({
  MarkdownView: class {},
  Notice: class { constructor(message: string) { ui.notices.push(message); } },
  Modal: class {
    buttons: { text: string; onclick?: () => void }[] = [];
    contentEl = { createEl: (_tag: string, options: { text: string }) => { const button = { text: options.text }; this.buttons.push(button); return button; }, empty() {} };
    onOpen() {} onClose() {} setTitle() {}
    open() { ui.modals.push(this); this.onOpen(); }
    close() { this.onClose(); }
  },
  parseLinktext: (target: string) => { const at = target.indexOf('#'); return { path: at < 0 ? target : target.slice(0, at), subpath: at < 0 ? '' : target.slice(at) }; },
  resolveSubpath: vi.fn()
}));

function fixture(initial = 'first [[old/a.html|streams]] then [[old/a.html|streams]] [[neighbor|旁卡]] end', reading = false) {
  const origin = note(initial, reading ? 'preview' : 'source'), notes = [origin];
  const file = { path: 'new/b.html', extension: 'html' }, source = { path: 'Source.md', extension: 'md' };
  const files = new Map<string, unknown>([[file.path, file], [source.path, source]]);
  const changed = vi.fn(), layouts = new LayoutStore([], () => {});
  const app = { workspace: { iterateAllLeaves: (callback: (leaf: unknown) => void) => notes.forEach(note => callback({ view: note.view })), getActiveViewOfType: () => origin.view },
    vault: { getFileByPath: (path: string) => files.get(path), read: vi.fn(async () => initial), getFolderByPath: () => ({}), getAbstractFileByPath: () => undefined,
      create: vi.fn(async (path: string) => { const created = { path, extension: 'md' }; files.set(path, created); return created; }) },
    metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path), getFileCache: vi.fn(() => null), fileToLinktext: (file: { path: string }) => file.path } };
  const action = new SelectionAction(app as unknown as App, changed, () => DEFAULT_PREFERENCES, {
    bridges: () => notes.map(note => note.bridge as unknown as EditorBridge), readingSource: () => initial, layouts: () => layouts
  });
  const open = (index = 1) => action.relink(origin.view, parseWikilinks(initial)[index], reading ? undefined : origin.bridge as unknown as EditorBridge);
  const selectText = (selected: string, from = initial.indexOf(selected)) => {
    const bridge = origin.bridge as unknown as EditorBridge;
    origin.bridge.cm.state.selection.main = { from, to: from + selected.length };
    const snapshot = action.capture(origin.view, bridge)!;
    action.open(origin.view, bridge, snapshot, 'right');
    return ui.pickers.at(-1)!;
  };
  return { action, origin, notes, file, source, app, changed, layouts, open, selectText };
}
function note(initial: string, initialMode: 'source' | 'preview') {
  let text = initial, mode = initialMode;
  const selection = { main: { from: 0, to: 0 }, ranges: [{}] };
  const bridge = { alive: true, revision: 1, text, parsed: parseDocument(text), cm: { dom: {}, state: { selection, doc: { toString: () => text } } }, prefer: vi.fn() };
  const offsetToPos = (offset: number) => { const lines = text.slice(0, offset).split('\n'); return { line: lines.length - 1, ch: lines.at(-1)!.length }; };
  const posToOffset = (position: { line: number; ch: number }) => text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.ch;
  const editor = { getValue: () => text, offsetToPos, focus: vi.fn(), listSelections: () => [{}],
    getScrollInfo: () => ({ top: scroller.scrollTop, left: 19 }), scrollTo: vi.fn((_left: number, top: number) => { scroller.scrollTop = top; }),
    transaction: vi.fn((tx: { changes: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }[] }) => {
      const edits = tx.changes.map(change => ({ from: posToOffset(change.from), to: posToOffset(change.to), text: change.text }));
      for (const edit of edits.reverse()) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
      bridge.text = text; bridge.parsed = parseDocument(text); bridge.revision++;
    }) };
  const scroller = { scrollTop: 123 };
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    file: { path: 'Source.md' }, editor, contentEl: { contains: (dom: unknown) => dom === bridge.cm.dom },
    previewMode: { containerEl: { scrollTop: 0, querySelector: () => scroller }, getScroll: vi.fn(() => scroller.scrollTop / 10) },
    setEphemeralState: vi.fn(),
    getMode: () => mode, getState: () => ({ mode, scroll: 42 }), setState: vi.fn(async (state: { mode: 'source' | 'preview' }) => { mode = state.mode; })
  });
  return { view, bridge, editor, scroller, mutate: (next: string) => { text = next; bridge.text = next; bridge.revision++; } };
}
beforeEach(() => { ui.pickers.length = 0; ui.modals.length = 0; ui.notices.length = 0; vi.mocked(resolveSubpath).mockReset(); });
describe('linking reviewed matches in the current note', () => {
  it('writes only reviewed matches in one original-coordinate transaction and maps the original cursor and placement', async () => {
    const text = '# Portable content\n\nportable, portable, portable. `portable`';
    const s = fixture(text), picker = s.selectText('portable', text.indexOf('portable, portable') + 'portable, '.length);
    const search = picker.options!.search!;
    const found = search.find({ caseSensitive: false, wholeWord: true });
    expect(found.map(match => match.text)).toEqual(['Portable', 'portable', 'portable', 'portable']);
    expect(s.origin.editor.getValue()).toBe(text);
    search.apply(found.slice(0, 3));
    expect(s.origin.editor.transaction).not.toHaveBeenCalled();
    await picker.actions.existing(s.file);
    const link = '[[new/b.html|portable]]';
    const expected = `# [[new/b.html|Portable]] content\n\n${link}, ${link}, portable. \`portable\``;
    expect(s.origin.editor.getValue()).toBe(expected);
    expect(s.origin.editor.transaction).toHaveBeenCalledExactlyOnceWith({
      changes: [
        { from: { line: 0, ch: 2 }, to: { line: 0, ch: 10 }, text: '[[new/b.html|Portable]]' },
        { from: { line: 2, ch: 0 }, to: { line: 2, ch: 8 }, text: link },
        { from: { line: 2, ch: 10 }, to: { line: 2, ch: 18 }, text: link }
      ], selection: { from: { line: 2, ch: 2 * link.length + 2 } }
    }, 'margin-link');
    expect(s.origin.bridge.prefer).toHaveBeenCalledExactlyOnceWith(expected.lastIndexOf(link), s.file.path, 'right');
  });

  it('rejects the reviewed scope after a document revision even when the text has returned to its original value', async () => {
    const text = 'Portable and portable.', s = fixture(text), picker = s.selectText('portable');
    const search = picker.options!.search!;
    search.apply(search.find({ caseSensitive: false, wholeWord: true }));
    s.origin.mutate(text + ' edited');
    s.origin.mutate(text);
    await expect(picker.actions.existing(s.file)).rejects.toThrow('笔记内容发生变化');
    expect(s.origin.editor.transaction).not.toHaveBeenCalled();
    expect(s.origin.editor.getValue()).toBe(text);
  });
});
describe('unlink from a card', () => {
  it('unwraps one duplicate while preserving the remaining manual layout records', async () => {
    const s = fixture(), before = s.origin.editor.getValue(), links = parseWikilinks(before), oldKeys = layoutIdentities(before, links);
    const first = { side: 'left' as const, xNormalized: .3, yOffset: 2 };
    const last = { side: 'right' as const, xNormalized: .6, yOffset: -4 };
    s.layouts.set('Source.md', oldKeys.get(links[0].start)!, first);
    s.layouts.set('Source.md', oldKeys.get(links[2].start)!, last);
    await s.action.unlink(s.origin.view, links[1], s.origin.bridge as unknown as EditorBridge);
    const after = s.origin.editor.getValue(), remaining = parseWikilinks(after), newKeys = layoutIdentities(after, remaining);
    expect(after).toBe('first [[old/a.html|streams]] then streams [[neighbor|旁卡]] end');
    expect(s.layouts.get('Source.md', newKeys.get(remaining[0].start))).toEqual(first);
    expect(s.layouts.get('Source.md', newKeys.get(remaining[1].start))).toEqual(last);
    expect(ui.pickers).toHaveLength(0); expect(s.changed).toHaveBeenCalledOnce();
    expect(s.origin.editor.transaction).toHaveBeenCalledOnce();
  });
  it.each([['[[missing/f#^block]]', 'missing/f#^block'], ['[[missing/f|]]', 'missing/f'], ['[[f| 中文 🐈 ]]', ' 中文 🐈 ']])(
    'restores the text of %s through a CRLF reading view', async (link, replacement) => {
      const original = '正文\r\n\r\n' + link, s = fixture(original, true);
      s.origin.mutate(original.replaceAll('\r\n', '\n'));
      await s.action.unlink(s.origin.view, parseWikilinks(original)[0]);
      expect(s.origin.editor.getValue()).toBe('正文\n\n' + replacement);
      expect(s.origin.view.getMode()).toBe('preview');
      expect(s.origin.view.setEphemeralState).toHaveBeenCalledWith({ scroll: 12.3 });
    });
  it('refuses to unlink from a stale reading split', async () => {
    const original = '[[f|文字]]', s = fixture(original, true), other = note('modified ' + original, 'source');
    s.notes.push(other);
    await s.action.unlink(s.origin.view, parseWikilinks(original)[0]);
    expect(other.editor.transaction).not.toHaveBeenCalled(); expect(s.origin.view.setState).not.toHaveBeenCalled();
    expect(ui.notices[0]).toContain('其他分栏');
  });
});
describe('the shared checked source transaction', () => {
  it('does not reveal the old offscreen cursor when the host transaction forcibly scrolls to it', async () => {
    const s = fixture(); s.origin.scroller.scrollTop = 4503;
    const transact = s.origin.editor.transaction.getMockImplementation()!;
    s.origin.editor.transaction.mockImplementation(tx => { transact(tx); s.origin.scroller.scrollTop = 448; });
    s.open(); await ui.pickers[0].actions.existing(s.file);
    expect(s.origin.editor.transaction).toHaveBeenCalledOnce();
    expect(s.origin.editor.scrollTo).toHaveBeenCalledExactlyOnceWith(19, 4503);
    expect(s.origin.scroller.scrollTop).toBe(4503);
  });
  it('relinks only the requested occurrence in one undo transaction and displays its current target', async () => {
    const s = fixture(); s.open(); const picker = ui.pickers[0];
    expect(picker.options?.currentTarget).toBe('old/a.html'); await picker.actions.existing(s.file);
    expect(s.origin.editor.getValue()).toBe('first [[old/a.html|streams]] then [[new/b.html|streams]] [[neighbor|旁卡]] end');
    expect(s.origin.editor.transaction).toHaveBeenCalledTimes(1); expect(s.changed).toHaveBeenCalledTimes(1); expect(picker.closed).toBe(true);
  });
  it('permits a missing old target and preserves the no-alias form', async () => {
    const s = fixture('before [[missing]] after'); s.open(0); await ui.pickers[0].actions.existing(s.file);
    expect(s.origin.editor.getValue()).toBe('before [[new/b.html]] after');
  });
  it('rejects a changed revision even if the source text was restored before confirmation', async () => {
    const s = fixture(); s.open(); s.origin.bridge.revision++;
    await expect(ui.pickers[0].actions.existing(s.file)).rejects.toThrow('发生变化'); expect(s.origin.editor.transaction).not.toHaveBeenCalled();
  });
  it('keeps a verified heading without asking and preserves the exact alias', async () => {
    vi.mocked(resolveSubpath).mockReturnValue({} as ReturnType<typeof resolveSubpath>);
    const s = fixture('before [[old#Heading|原名]] after'); s.app.metadataCache.getFileCache.mockReturnValue({} as never); s.open(0);
    await ui.pickers[0].actions.existing(s.file); expect(s.origin.editor.getValue()).toBe('before [[new/b.html#Heading|原名]] after'); expect(ui.modals).toHaveLength(0);
  });
  it.each([['保留子路径', '#^block'], ['移除子路径', '']])('requires an explicit %s choice for an unverified subpath', async (choice, suffix) => {
    const s = fixture('before [[old#^block|原名]] after'); s.open(0); const pending = ui.pickers[0].actions.existing(s.file);
    expect(s.origin.editor.transaction).not.toHaveBeenCalled(); ui.modals[0].buttons.find(button => button.text === choice)!.onclick!(); await pending;
    expect(s.origin.editor.getValue()).toBe(`before [[new/b.html${suffix}|原名]] after`);
  });
  it('cancels a pending subpath confirmation and leaves both files and source unchanged', async () => {
    const s = fixture('before [[old#Heading]] after'); s.open(0); const pending = ui.pickers[0].actions.existing(s.file);
    s.action.cancel(); await expect(pending).rejects.toThrow('取消'); expect(s.origin.editor.transaction).not.toHaveBeenCalled();
  });
  it('revalidates the source after a subpath choice before applying any transaction', async () => {
    const s = fixture('before [[old#Heading]] after'); s.open(0); const pending = ui.pickers[0].actions.existing(s.file);
    s.origin.mutate('changed'); ui.modals[0].buttons.find(button => button.text === '移除子路径')!.onclick!();
    await expect(pending).rejects.toThrow('发生变化'); expect(s.origin.editor.transaction).not.toHaveBeenCalled();
  });
  it('uses the same transaction for a new selection, including actual byte confirmation', async () => {
    const s = fixture('streams'); s.origin.bridge.cm.state.selection.main.to = 7;
    const snapshot = s.action.capture(s.origin.view, s.origin.bridge as unknown as EditorBridge)!;
    s.action.open(s.origin.view, s.origin.bridge as unknown as EditorBridge, snapshot); await ui.pickers[0].actions.existing(s.file);
    expect(s.origin.editor.getValue()).toBe('[[new/b.html|streams]]'); expect(s.origin.editor.transaction).toHaveBeenCalledTimes(1);
  });
  it('reports an unconfirmed transaction to the import caller instead of claiming success', async () => {
    const s = fixture(); s.open(); s.origin.editor.transaction.mockImplementation(() => {});
    await expect(ui.pickers[0].actions.existing(s.file)).rejects.toThrow('未能确认'); expect(ui.pickers[0].closed).toBe(false);
  });
});
describe('reading mode and split editors', () => {
  it('ignores an obsolete hidden source bridge when starting from a mapped reading card', async () => {
    const s = fixture('before [[old|item]] after', true); s.origin.bridge.alive = false;
    s.action.relink(s.origin.view, parseWikilinks(s.origin.editor.getValue())[0], s.origin.bridge as unknown as EditorBridge);
    await ui.pickers[0].actions.existing(s.file);
    expect(s.origin.editor.getValue()).toBe('before [[new/b.html|item]] after'); expect(s.origin.view.getMode()).toBe('preview');
  });
  it('borrows source mode for one transaction, then restores reading state and scroll', async () => {
    const s = fixture('before [[old|item]] after', true); s.open(0); await ui.pickers[0].actions.existing(s.file);
    expect(s.origin.editor.getValue()).toBe('before [[new/b.html|item]] after'); expect(s.origin.view.getMode()).toBe('preview');
    expect(s.origin.view.setState).toHaveBeenCalledTimes(2); expect(s.origin.scroller.scrollTop).toBe(123);
    expect(s.origin.view.setEphemeralState).toHaveBeenCalledExactlyOnceWith({ scroll: 12.3 });
  });
  it('samples the latest reading location after asynchronous source validation, not before the user scrolls', async () => {
    const s = fixture('before [[old|item]] after', true);
    let resolve!: (text: string) => void;
    s.app.vault.read.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
    s.open(0); const pending = ui.pickers[0].actions.existing(s.file);
    s.origin.scroller.scrollTop = 600;
    resolve('before [[old|item]] after'); await pending;
    expect(s.origin.view.setEphemeralState).toHaveBeenCalledExactlyOnceWith({ scroll: 60 });
  });
  it('commits through an already open matching source split without switching the reader', async () => {
    const initial = 'before [[old|item]] after', s = fixture(initial, true), split = note(initial, 'source'); s.notes.push(split); s.open(0);
    await ui.pickers[0].actions.existing(s.file); expect(split.editor.getValue()).toBe('before [[new/b.html|item]] after');
    expect(s.origin.editor.transaction).not.toHaveBeenCalled(); expect(s.origin.view.setState).not.toHaveBeenCalled();
    expect(s.origin.view.setEphemeralState).toHaveBeenCalledExactlyOnceWith({ scroll: 12.3 });
  });
  it('preserves the actual writer split viewport as well as the reading origin', async () => {
    const initial = 'before [[old|item]] after', s = fixture(initial, true), split = note(initial, 'source');
    split.scroller.scrollTop = 901;
    const transact = split.editor.transaction.getMockImplementation()!;
    split.editor.transaction.mockImplementation(tx => { transact(tx); split.scroller.scrollTop = 0; });
    s.notes.push(split); s.open(0); await ui.pickers[0].actions.existing(s.file);
    expect(split.editor.scrollTo).toHaveBeenCalledExactlyOnceWith(19, 901);
    expect(split.scroller.scrollTop).toBe(901); expect(s.origin.view.setState).not.toHaveBeenCalled();
  });
  it('refuses a stale reader when another split has unsaved content', () => {
    const s = fixture('before [[old|item]] after', true); s.notes.push(note('unsaved [[old|item]]', 'source')); s.open(0);
    expect(ui.pickers).toHaveLength(0); expect(ui.notices.some(message => message.includes('其他分栏'))).toBe(true);
  });
  it('retains source and destination when the source file changed before borrowing an editor', async () => {
    const s = fixture('before [[old|item]] after', true); s.open(0); s.app.vault.read.mockResolvedValue('new disk data');
    await expect(ui.pickers[0].actions.existing(s.file)).rejects.toThrow('源文件已改变'); expect(s.origin.view.setState).not.toHaveBeenCalled();
  });
  it('rejects a card whose occurrence no longer matches its displayed source', () => {
    const s = fixture('before [[old|item]] after'); const stale = { ...parseWikilinks(s.origin.editor.getValue())[0], start: 0 } as WikilinkOccurrence;
    s.action.relink(s.origin.view, stale, s.origin.bridge as unknown as EditorBridge); expect(ui.pickers).toHaveLength(0); expect(ui.notices).toHaveLength(1);
  });
});
