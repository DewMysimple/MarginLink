import { describe, expect, it, vi } from 'vitest';
import type { App, MarkdownView, TFile } from 'obsidian';
import { defaultNoteFolder, newNotePath } from '../src/core/new-note';
import { formatWikilink } from '../src/core/link-formatter';
import { readPreferences } from '../src/types';
import { SelectionAction } from '../src/editor/selection-action';
import type { EditorBridge } from '../src/editor/editor-extension';

type Actions = {
  create(folder: string, name: string, openInWindow: boolean): Promise<void>;
  closed(): void;
};
const picker = vi.hoisted(() => ({ actions: undefined as Actions | undefined }));
vi.mock('obsidian', () => ({ MarkdownView: class {}, Modal: class {}, Notice: class {} }));
vi.mock('../src/ui/file-picker', () => ({
  FilePicker: class {
    constructor(_app: unknown, _alias: string, _settings: unknown, readonly actions: Actions) { picker.actions = actions; }
    open() {}
    close() { this.actions.closed(); }
  }
}));

const folder = '详细分析/Vocabulary';
const alias = 'model-assisted';
describe('new note and exact Wikilink path', () => {
  it('uses the configured default, first configured or vault root', () => {
    const folders = [folder, '', 'Work'];
    expect(defaultNoteFolder(readPreferences({ newNoteFolders: folders, newNoteDefault: 2 }))).toBe('Work');
    expect(defaultNoteFolder(readPreferences({ newNoteFolders: folders, newNoteDefault: 1 }))).toBe(folder);
    expect(defaultNoteFolder(readPreferences(null))).toBe('/');
    expect(readPreferences({ newNoteFolders: ['A', 77, 'B', 'extra'], newNoteDefault: 81 }).newNoteFolders).toEqual(['A', '', 'B']);
  });
  it.each(['model-assisted-notes', 'model-assisted-notes.md'])('preserves the alias independently of filename %s', input => {
    expect(formatWikilink(newNotePath(folder, input, alias), alias)).toBe('[[详细分析/Vocabulary/model-assisted-notes.md|model-assisted]]');
    expect(newNotePath('/', input, alias)).toBe('model-assisted-notes.md');
  });
  it.each(['', '.md', '../x', 'x/y', 'a:b', 'a#b', 'a|b', '[a]', 'a?', 'a.', 'AUX.doc'])('rejects invalid filenames %j', name => {
    expect(() => newNotePath(folder, name, alias)).toThrow();
  });
});

function fixture() {
  const path = folder + '/' + alias + '.md';
  const file = { path } as TFile;
  const files = new Map<string, TFile>();
  const openFile = vi.fn(async () => {});
  const focusWindow = vi.fn();
  const leaf = { openFile, view: { containerEl: { ownerDocument: { defaultView: { focus: focusWindow } } } } };
  let text = alias;
  const editor = {
    getValue: () => text,
    offsetToPos: (ch: number) => ({ line: 0, ch }),
    focus: vi.fn(), transaction: vi.fn((tx: { changes: { from: { ch: number }; to: { ch: number }; text: string }[] }) => {
      for (const change of tx.changes) text = text.slice(0, change.from.ch) + change.text + text.slice(change.to.ch);
    })
  };
  const source = { editor, getMode: () => 'source', file: { path: 'Original.md' } } as unknown as MarkdownView;
  const workspace = { getActiveViewOfType: () => source, getLeaf: vi.fn(() => leaf), setActiveLeaf: vi.fn(), iterateAllLeaves: vi.fn() };
  const vault = {
    getFolderByPath: (p: string) => p === folder ? { path: folder } : null,
    getFileByPath: (p: string) => files.get(p) ?? null,
    getAbstractFileByPath: (p: string) => files.get(p) ?? null,
    create: vi.fn(async () => { files.set(path, file); return file; })
  };
  const action = new SelectionAction({ workspace, vault } as unknown as App, vi.fn(), () => readPreferences({ newNoteFolders: [folder] }));
  const bridge = { alive: true, revision: 1, cm: { state: { selection: { main: { from: 0, to: alias.length }, ranges: [{}] } } } } as unknown as EditorBridge;
  action.open(source, bridge, { sourcePath: 'Original.md', text: alias, selected: alias, from: 0, to: alias.length, revision: 1 });
  const submit = (ctrl = false) => picker.actions!.create(folder, alias, ctrl);
  return { action, editor, workspace, files, file, vault, submit, openFile, focusWindow };
}

describe('selection creation and navigation', () => {
  it('writes exactly once with the original alias and returns the caret to the source without accessing the metadata cache', async () => {
    const f = fixture();
    await f.submit();
    const link = '[[详细分析/Vocabulary/model-assisted.md|model-assisted]]';
    expect(f.editor.transaction).toHaveBeenCalledExactlyOnceWith({
      changes: [{ from: { line: 0, ch: 0 }, to: { line: 0, ch: alias.length }, text: link }],
      selection: { from: { line: 0, ch: link.length } }
    }, 'margin-link');
    expect(f.editor.focus).toHaveBeenCalledOnce();
    expect(f.workspace.getLeaf).not.toHaveBeenCalled();
  });
  it('only opens the exact created TFile in an independent window after committing the link', async () => {
    const f = fixture();
    await f.submit(true);
    expect(f.workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('window');
    expect(f.editor.transaction.mock.invocationCallOrder[0]).toBeLessThan(f.workspace.getLeaf.mock.invocationCallOrder[0]);
    expect(f.openFile).toHaveBeenCalledWith(f.file, { active: true, state: { mode: 'source' } });
    expect(f.focusWindow).toHaveBeenCalledOnce();
    expect(f.editor.focus).not.toHaveBeenCalled();
  });
  it('never overwrites an existing path', async () => {
    const f = fixture();
    f.files.set(f.file.path, f.file);
    await expect(f.submit()).rejects.toThrow('已存在');
    expect(f.vault.create).not.toHaveBeenCalled();
    expect(f.editor.transaction).not.toHaveBeenCalled();
  });
  it('preserves the already-created file and reports its path if the user switched away while creating', async () => {
    const f = fixture();
    f.vault.create.mockImplementation(async () => { f.files.set(f.file.path, f.file); f.action.cancel(); return f.file; });
    await expect(f.submit(true)).rejects.toThrow(f.file.path);
    expect(f.files.get(f.file.path)).toBe(f.file);
    expect(f.editor.transaction).not.toHaveBeenCalled();
    expect(f.workspace.getLeaf).not.toHaveBeenCalled();
  });
  it('does not write or navigate on Vault failure', async () => {
    const f = fixture();
    f.vault.create.mockRejectedValue(new Error('模拟写入失败'));
    await expect(f.submit(true)).rejects.toThrow('模拟写入失败');
    expect(f.editor.transaction).not.toHaveBeenCalled();
    expect(f.workspace.getLeaf).not.toHaveBeenCalled();
  });
});
