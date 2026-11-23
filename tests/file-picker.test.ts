import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { FilePicker, type PickerActions } from '../src/ui/file-picker';
import { readPreferences } from '../src/types';
import type { ImportHost, LocalFileInspection } from '../src/core/local-file-import';

const focusDocument: { activeElement?: Element; defaultView: { addEventListener(): void; removeEventListener(): void }; createDocumentFragment(): Element } = {
  defaultView: { addEventListener() {}, removeEventListener() {} }, createDocumentFragment: () => new Element()
};
class Element {
  children: Element[] = [];
  parent?: Element;
  value = '';
  textContent = '';
  disabled = false;
  hidden = false;
  isConnected = true;
  tagName = '';
  cls = '';
  onclick?: (event?: object) => void;
  oninput?: () => void;
  onchange?: () => void;
  onkeydown?: (event: object) => void;
  classList = { toggle() {} };
  ownerDocument = focusDocument;
  createEl(tag: string, options: { text?: string; value?: string; cls?: string; attr?: Record<string, string> } = {}): Element {
    const child = new Element(); child.tagName = tag; child.textContent = options.text ?? ''; child.cls = options.cls ?? '';
    child.value = options.value ?? ''; child.parent = this; this.children.push(child); return child;
  }
  createDiv(options = {}): Element { return this.createEl('div', options); }
  addClass() {}
  setAttribute() {}
  setText(value: string) { this.textContent = value; }
  empty() { for (const child of this.children) child.parent = undefined; this.children = []; }
  contains(child: Element): boolean { return child === this || this.children.some(item => item.contains(child)); }
  scrollIntoView() {}
  focus = vi.fn((_options?: FocusOptions) => { focusDocument.activeElement = this; });
  select = vi.fn();
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())]; }
  text(): string { return this.all().map(child => child.textContent).join('\n'); }
}
const state = vi.hoisted(() => ({ inspect: vi.fn(), conflict: vi.fn(), move: vi.fn(), notices: [] as unknown[] }));
vi.mock('obsidian', () => ({
  Modal: class {
    contentEl = new Element(); modalEl = new Element(); containerEl = new Element();
    private mockOpen = false;
    constructor(public app: App) {}
    setTitle() {}
    open() {
      if (this.mockOpen) return;
      this.mockOpen = true; this.containerEl.isConnected = true;
      (this as unknown as FilePicker).onOpen();
      // The real host chooses its initial focus after onOpen, overriding a
      // synchronous focus inside FilePicker.onOpen with the first tab button.
      this.contentEl.all().find(element => ['button', 'input', 'select'].includes(element.tagName))?.focus({ preventScroll: true });
    }
    close() { this.mockOpen = false; this.containerEl.isConnected = false; (this as unknown as FilePicker).onClose(); }
  },
  Notice: class { constructor(message: unknown) { state.notices.push(message); } },
  prepareFuzzySearch: (query: string) => (candidate: string) => candidate.toLowerCase().includes(query.toLowerCase()) ? { score: 0 } : null,
  sortSearchResults() {}
}));
vi.mock('../src/core/local-file-import', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/local-file-import')>(),
  desktopFileRuntime: () => ({}),
  LocalFileImporter: class { inspect = state.inspect; conflict = state.conflict; move = state.move; }
}));
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const nativePath = 'C:\\Downloads\\中文 streams.html';
const inspection = (source = nativePath): LocalFileInspection => ({ source, canonical: source, name: '中文 streams.html', size: 5 } as LocalFileInspection);
function fixture(files: string[] = []) {
  const indexed = new Map(files.map(path => [path, { path } as TFile]));
  const actions: PickerActions = { existing: vi.fn(), create: vi.fn(async () => {}), closed: vi.fn(), validate: vi.fn() };
  const app = { vault: { adapter: { getBasePath: () => 'C:\\Vault' }, getFiles: () => [...indexed.values()], getFileByPath: (p: string) => indexed.get(p) ?? null,
    getFolderByPath: (p: string) => p === '资料' ? { path: p } : null, getAbstractFileByPath: (p: string) => indexed.get(p) ?? null } } as unknown as App;
  const picker = new FilePicker(app, 'streams', readPreferences({ newNoteFolders: ['资料'] }), actions, { currentTarget: 'old.html' });
  picker.open();
  const content = picker.contentEl as unknown as Element;
  const input = content.all().find(e => e.tagName === 'input')!;
  const button = (text: string) => content.all().find(e => e.tagName === 'button' && e.textContent === text)!;
  const query = (text: string) => { input.value = text; input.oninput!(); };
  return { picker, actions, content, input, button, query, indexed };
}
beforeEach(() => {
  state.inspect.mockReset(); state.conflict.mockReset(); state.move.mockReset();
  state.notices.length = 0; focusDocument.activeElement = undefined;
});

describe('picker input focus after the host opens the dialog', () => {
  it('overrides the host tab focus so direct typing immediately searches files without scrolling', () => {
    const f = fixture(['A/streams.md', 'B/other.md']);
    expect(focusDocument.activeElement).toBe(f.input);
    expect(f.input.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    const focused = focusDocument.activeElement!;
    focused.value = 'streams'; focused.oninput!();
    expect(f.content.text()).toContain('A/streams.md'); expect(f.content.text()).not.toContain('B/other.md');
  });

  it('focuses the filename on the new tab and the preserved search when returning to existing files', () => {
    const f = fixture(['A/streams.md']); f.query('streams');
    f.button('新建文件').onclick!();
    const filename = f.content.all().find(element => element.tagName === 'input')!;
    expect(focusDocument.activeElement).toBe(filename);
    expect(filename.value).toBe('streams'); expect(filename.select).toHaveBeenCalledOnce();
    expect(filename.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    f.button('已有文件').onclick!();
    const search = f.content.all().find(element => element.tagName === 'input')!;
    expect(focusDocument.activeElement).toBe(search); expect(search.value).toBe('streams');
    expect(search.focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('does not reclaim focus on duplicate open or when a late path result arrives', async () => {
    let resolve!: (value: LocalFileInspection) => void;
    state.inspect.mockImplementation(() => new Promise(done => { resolve = done; }));
    const f = fixture(); f.query(nativePath);
    const tab = f.button('新建文件'); tab.focus();
    f.picker.open(); expect(focusDocument.activeElement).toBe(tab);
    resolve(inspection()); await settle();
    expect(focusDocument.activeElement).toBe(tab);
  });

  it('does not refocus a closed dialog from late path inspection', async () => {
    let resolve!: (value: LocalFileInspection) => void;
    state.inspect.mockImplementation(() => new Promise(done => { resolve = done; }));
    const f = fixture(); f.query(nativePath); f.picker.close();
    const outside = new Element(); outside.focus(); resolve(inspection()); await settle();
    expect(focusDocument.activeElement).toBe(outside); expect(f.content.text()).toBe('');
  });
});

describe('one file picker for name search and local import', () => {
  it('keeps normal keywords on vault search and displays current relink target', async () => {
    const f = fixture(['A/streams.md', 'B/other.md']);
    f.query('streams');
    expect(f.content.text()).toContain('当前目标：old.html');
    expect(f.content.text()).toContain('A/streams.md');
    expect(f.content.text()).not.toContain('B/other.md');
    expect(state.inspect).not.toHaveBeenCalled();
    f.button('A/streams.md').onclick!(); await settle();
    expect(f.actions.existing).toHaveBeenCalledExactlyOnceWith(f.indexed.get('A/streams.md'));
  });
  it('ignores late path results after a later paste or ordinary keyword', async () => {
    let resolveFirst!: (value: LocalFileInspection) => void;
    state.inspect.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(inspection('C:\\Downloads\\second.html'));
    const f = fixture(['keyword.md']);
    f.query(nativePath); f.query('C:\\Downloads\\second.html'); await settle();
    expect(f.content.text()).toContain('second.html');
    resolveFirst(inspection(nativePath)); await settle();
    expect(f.content.text()).not.toContain('来源路径：' + nativePath);
    f.query('keyword'); await settle();
    expect(f.content.text()).toContain('keyword.md');
    expect(f.content.text()).not.toContain('来源路径');
  });
  it('ignores path results after changing tabs or closing', async () => {
    let resolve!: (value: LocalFileInspection) => void;
    state.inspect.mockImplementation(() => new Promise(r => { resolve = r; }));
    const f = fixture(); f.query(nativePath); f.button('新建文件').onclick!();
    resolve(inspection()); await settle();
    expect(f.content.text()).not.toContain('来源路径');
    f.button('已有文件').onclick!(); f.query(nativePath); f.picker.onClose();
    resolve(inspection()); await settle();
    expect(f.content.text()).toBe('');
    expect(state.move).not.toHaveBeenCalled();
  });
  it('shows source, shared default folder and exact extension, and never mutates before explicit confirmation', async () => {
    state.inspect.mockResolvedValue(inspection());
    const f = fixture(); f.query('"' + nativePath + '"'); await settle();
    expect(f.content.text()).toContain('来源路径：' + nativePath);
    expect(f.content.text()).toContain('最终库内路径：资料/中文 streams.html');
    expect(f.button('移动到仓库并关联').disabled).toBe(false);
    expect(state.move).not.toHaveBeenCalled();
    expect(f.actions.existing).not.toHaveBeenCalled();
  });
  it('associates an exact in-vault absolute path without import or fuzzy matching', async () => {
    state.inspect.mockResolvedValue({ ...inspection(), vaultPath: '资料/exact.html' });
    const f = fixture(['资料/exact.html', 'other/exact.html']); f.query(nativePath); await settle();
    f.button('关联此文件').onclick!(); await settle();
    expect(f.actions.existing).toHaveBeenCalledExactlyOnceWith(f.indexed.get('资料/exact.html'));
    expect(state.move).not.toHaveBeenCalled();
  });
  it('offers an explicit existing-file branch for collisions and preserves the external source', async () => {
    state.inspect.mockResolvedValue(inspection());
    const path = '资料/中文 streams.html';
    state.conflict.mockResolvedValue({ replacement: { path }, safePath: '资料/中文 streams (1).html' });
    const f = fixture([path]); f.query(nativePath); await settle();
    expect(f.button('移动到仓库并关联').hidden).toBe(true);
    const existing = f.button('使用已有文件（保留原件）');
    expect(existing.hidden).toBe(false); existing.onclick!(); await settle();
    expect(state.move).not.toHaveBeenCalled();
    expect(f.actions.existing).toHaveBeenCalledExactlyOnceWith(f.indexed.get(path));
  });
  it('requires a second deliberate click before replacing the exact previewed file', async () => {
    state.inspect.mockResolvedValue(inspection());
    const path = '资料/中文 streams.html';
    const replacement = { path, identity: {} };
    state.conflict.mockResolvedValue({ replacement, safePath: '资料/中文 streams (1).html' });
    state.move.mockResolvedValue({ sourceRemoved: true, targetPath: path });
    const f = fixture([path]); f.query(nativePath); await settle();
    f.button('覆盖替换并关联').onclick!();
    expect(f.content.text()).toContain('已有链接也会打开替换后的文件');
    f.button('确认覆盖').onclick!({ detail: 2 });
    expect(state.move).not.toHaveBeenCalled();
    f.button('确认覆盖').onclick!({ detail: 1 }); await settle();
    expect(state.move).toHaveBeenCalledExactlyOnceWith(inspection(), path, expect.any(Object), expect.any(AbortSignal), replacement);
  });
  it('previews a new number if exclusive creation loses a race and asks before trying again', async () => {
    state.inspect.mockResolvedValue(inspection());
    const first = '资料/中文 streams (1).html';
    const second = '资料/中文 streams (2).html';
    state.conflict.mockResolvedValueOnce({ safePath: first }).mockResolvedValue({ safePath: second });
    state.move.mockRejectedValue(new Error('路径已被占用'));
    const f = fixture(); f.query(nativePath); await settle();
    expect(f.content.text()).toContain(first);
    expect(f.button('覆盖替换并关联').hidden).toBe(true);
    f.button('安全重命名并关联').onclick!(); await settle();
    expect(state.move).toHaveBeenCalledExactlyOnceWith(inspection(), first, expect.any(Object), expect.any(AbortSignal), undefined);
    expect(f.content.text()).toContain(second);
    expect(f.content.text()).toContain('路径已被占用');
  });
  it('deduplicates rapid confirms and awaits source commit before completing import', async () => {
    state.inspect.mockResolvedValue(inspection());
    let complete!: () => void;
    state.move.mockImplementation(async (_source: LocalFileInspection, target: string, host: ImportHost<TFile>) => {
      await new Promise<void>(resolve => { complete = resolve; });
      await host.commit({ path: target } as TFile);
      return { sourceRemoved: true, targetPath: target };
    });
    const f = fixture(); f.query(nativePath); await settle();
    const move = f.button('移动到仓库并关联'); move.onclick!(); move.onclick!();
    expect(state.move).toHaveBeenCalledOnce();
    expect(f.actions.existing).not.toHaveBeenCalled();
    complete(); await settle();
    expect(f.actions.existing).toHaveBeenCalledExactlyOnceWith({ path: '资料/中文 streams.html' });
  });
  it('aborts a pending import on picker close and reports the importer phase result', async () => {
    state.inspect.mockResolvedValue(inspection());
    let signal!: AbortSignal;
    state.move.mockImplementation((_source: unknown, _target: string, _host: unknown, pendingSignal: AbortSignal) => {
      signal = pendingSignal;
      return new Promise((_resolve, reject) => pendingSignal.addEventListener('abort', () => reject(new Error('原文件保留'))));
    });
    const f = fixture(); f.query(nativePath); await settle();
    f.button('移动到仓库并关联').onclick!(); f.picker.close(); await settle();
    expect(signal.aborted).toBe(true);
    expect(f.actions.existing).not.toHaveBeenCalled();
    expect(state.notices).toContain('原文件保留');
  });
});
