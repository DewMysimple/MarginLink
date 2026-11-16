import { MarkdownView, Modal, Notice, parseLinktext, resolveSubpath, type App, type TFile } from 'obsidian';
import { FilePicker } from '../ui/file-picker';
import { formatWikilink } from '../core/link-formatter';
import { exactTarget } from '../core/link-resolver';
import { validateSelection, validateSnapshot, type SelectionSnapshot } from './selection-validation';
import type { EditorBridge } from './editor-extension';
import type { Side, WikilinkOccurrence } from '../types';
import { newNotePath, type NewNotePreferences } from '../core/new-note';
import type { LayoutStore } from '../core/layout-store';
import { checkedOccurrence, relinkLayoutAliases, relinkText } from '../core/relink';

interface ActionContext {
  bridges(): Iterable<EditorBridge>;
  readingSource(view: MarkdownView, occurrence: WikilinkOccurrence): string | undefined;
  layouts(): LayoutStore;
}
interface LinkOperation {
  sourcePath: string; text: string; from: number; to: number; label: string;
  selection?: SelectionSnapshot; occurrence?: WikilinkOccurrence;
}
const normalized = (text: string) => text.replace(/\r\n?/g, '\n');

class SubpathChoice extends Modal {
  private settled = false;
  constructor(app: App, private subpath: string, private done: (preserve: boolean | undefined) => void) { super(app); }
  onOpen(): void {
    this.setTitle('确认原链接的子路径');
    this.contentEl.createEl('p', { text: `无法确认新目标中存在 ${this.subpath}。请选择保留或移除；取消会保留原链接。` });
    for (const [label, value] of [['保留子路径', true], ['移除子路径', false], ['取消', undefined]] as const) {
      const button = this.contentEl.createEl('button', { text: label, attr: { type: 'button' } });
      button.onclick = () => { this.settled = true; this.done(value); this.close(); };
    }
  }
  onClose(): void { if (!this.settled) this.done(undefined); this.contentEl.empty(); }
}

export class SelectionAction {
  private picker?: FilePicker;
  private subpathChoice?: SubpathChoice;
  private generation = 0;
  constructor(private app: App, private changed: () => void, private preferences: () => NewNotePreferences, private context?: ActionContext) {}
  capture(view: MarkdownView, bridge: EditorBridge): SelectionSnapshot | null {
    const ranges = view.editor.listSelections();
    const text = bridge.cm.state.doc.toString();
    const selection = bridge.cm.state.selection;
    const { from, to } = selection.main;
    const error = validateSelection(text, from, to, Math.max(ranges.length, selection.ranges.length), bridge.parsed);
    if (!view.file || error || view.getMode() !== 'source') { new Notice(error ?? '请在 Markdown 编辑器中选择文字。'); return null; }
    return { sourcePath: view.file.path, from, to, text, selected: text.slice(from, to), revision: bridge.revision };
  }
  open(view: MarkdownView, bridge: EditorBridge, snapshot: SelectionSnapshot, side?: Side): void {
    this.openOperation(view, { ...snapshot, label: snapshot.selected, selection: snapshot }, bridge, side);
  }
  relink(view: MarkdownView, occurrence: WikilinkOccurrence, bridge?: EditorBridge): void {
    try {
      const source = view.getMode() === 'source' ? bridge?.text : this.context?.readingSource(view, occurrence);
      if (!view.file || source === undefined) throw new Error('无法确认该卡片的源文本，请刷新笔记后重试。');
      checkedOccurrence(source, occurrence);
      const text = normalized(source), from = normalized(source.slice(0, occurrence.start)).length;
      const current = { ...occurrence, start: from, end: from + occurrence.raw.length };
      checkedOccurrence(text, current);
      this.openOperation(view, { sourcePath: view.file.path, text, from, to: current.end, label: current.label, occurrence: current }, view.getMode() === 'source' ? bridge : undefined);
    } catch (error) { new Notice(error instanceof Error ? error.message : '无法重新链接该文件。'); }
  }
  private editors(sourcePath: string): { view: MarkdownView; bridge?: EditorBridge }[] {
    const editors: { view: MarkdownView; bridge?: EditorBridge }[] = [];
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === sourcePath && view.getMode() === 'source') {
        const bridge = [...this.context?.bridges() ?? []].find(candidate => candidate.alive && view.contentEl.contains(candidate.cm.dom));
        editors.push({ view, bridge });
      }
    });
    return editors;
  }
  private openOperation(view: MarkdownView, operation: LinkOperation, bridge?: EditorBridge, side?: Side): void {
    this.cancel();
    const generation = this.generation;
    const mode = view.getMode();
    const revisions = new Map(this.editors(operation.sourcePath).flatMap(editor => editor.bridge ? [[editor.bridge, editor.bridge.revision] as const] : []));
    if (bridge) revisions.set(bridge, bridge.revision);
    let borrowed = false;
    const validate = () => {
      if (generation !== this.generation || view.file?.path !== operation.sourcePath || (!borrowed && view.getMode() !== mode)) throw new Error('源笔记或本次操作已改变，请重新选择。');
      for (const [editor, revision] of revisions) if (!editor.alive || editor.revision !== revision) throw new Error('选择文件期间笔记内容发生变化，请重新选择。');
      for (const editor of this.editors(operation.sourcePath)) if (normalized(editor.view.editor.getValue()) !== operation.text) throw new Error('同一笔记在其他分栏中已改变，请刷新后重新选择。');
      if (!operation.selection || !bridge) return;
      const error = validateSnapshot(operation.selection, {
        sourcePath: view.file?.path ?? '', text: view.editor.getValue(), revision: bridge.revision,
        active: bridge.alive && view.getMode() === 'source' && this.app.workspace.getActiveViewOfType(MarkdownView) === view
      });
      if (error) throw new Error(error);
      const selection = bridge.cm.state.selection;
      if (selection.main.from !== operation.from || selection.main.to !== operation.to || selection.ranges.length !== 1) {
        throw new Error('原选区已改变，请重新选择文字。');
      }
    };
    const write = async (file: TFile, target: string) => {
      validate();
      if (this.app.vault.getFileByPath(file.path) !== file) throw new Error('目标文件已删除或改变，请重新选择。');
      let subpath = operation.occurrence ? parseLinktext(operation.occurrence.target).subpath : '';
      if (subpath) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache || !resolveSubpath(cache, subpath)) {
          const preserve = await new Promise<boolean | undefined>(done => { this.subpathChoice = new SubpathChoice(this.app, subpath, done); this.subpathChoice.open(); });
          this.subpathChoice = undefined;
          if (preserve === undefined) throw new Error('已取消重新链接，原文与文件均保留。');
          if (!preserve) subpath = '';
        }
      }
      validate();
      const state = mode === 'preview' ? view.getState() : undefined;
      const scroller = mode === 'preview' ? view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-view') ?? view.previewMode.containerEl : undefined;
      const scrollTop = scroller?.scrollTop;
      let editorView = mode === 'source' ? view : this.editors(operation.sourcePath)[0]?.view;
      try {
        if (!editorView) {
          const sourceFile = view.file;
          if (!sourceFile || normalized(await this.app.vault.read(sourceFile)) !== operation.text) throw new Error('阅读视图的源文件已改变，请刷新后重试。');
          validate(); borrowed = true;
          await view.setState({ ...state, mode: 'source' }, { history: false });
          editorView = view;
        }
        validate();
        if (editorView.file?.path !== operation.sourcePath || normalized(editorView.editor.getValue()) !== operation.text) throw new Error('源编辑器的内容已改变，未修改链接。');
        if (this.app.vault.getFileByPath(file.path) !== file) throw new Error('目标文件已删除或改变，请重新选择。');
        if (operation.occurrence) checkedOccurrence(operation.text, operation.occurrence);
        const link = operation.occurrence ? relinkText(operation.occurrence, target, subpath) : formatWikilink(target, operation.label);
        const expected = operation.text.slice(0, operation.from) + link + operation.text.slice(operation.to);
        const aliases = operation.occurrence ? relinkLayoutAliases(operation.text, expected, operation.from, operation.to, link) : undefined;
        const from = editorView.editor.offsetToPos(operation.from), to = editorView.editor.offsetToPos(operation.to);
        editorView.editor.transaction({ changes: [{ from, to, text: link }],
          ...(operation.selection ? { selection: { from: { line: from.line, ch: from.ch + link.length } } } : {}) }, 'margin-link');
        if (normalized(editorView.editor.getValue()) !== expected) throw new Error('未能确认原文事务成功；外部原件会保留，请检查笔记。');
        if (aliases) this.context?.layouts().preserveRelink(operation.sourcePath, aliases);
        if (side) bridge?.prefer(operation.from, target, side);
      } finally {
        if (borrowed && state && view.file?.path === operation.sourcePath) {
          try {
            await view.setState(state, { history: false });
            const restoredScroller = view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-view') ?? view.previewMode.containerEl;
            if (scrollTop !== undefined) restoredScroller.scrollTop = scrollTop;
          }
          catch { new Notice('链接操作已结束，未能恢复阅读视图，请手动切回阅读模式。'); }
          borrowed = false;
        }
      }
      // Closing must not restore the selection captured before the transaction.
      picker.shouldRestoreSelection = false;
      picker.close();
      this.changed();
    };
    try { validate(); } catch (error) { new Notice(error instanceof Error ? error.message : '源链接已失效。'); return; }
    const picker = new FilePicker(this.app, operation.label, this.preferences(), {
      validate,
      existing: async file => {
        await write(file, exactTarget(this.app, file, operation.sourcePath));
        if (mode === 'source') view.editor.focus();
      },
      create: async (folder, name, openInWindow) => {
        validate();
        const path = newNotePath(folder, name, operation.label);
        if (folder !== '/' && !this.app.vault.getFolderByPath(folder)) throw new Error('目标文件夹已失效，请重新选择存放位置。');
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error('该位置已存在文件或文件夹，请改名或使用已有文件。');
        const file = await this.app.vault.create(path, '');
        try {
          if (file.path !== path) throw new Error('新笔记的位置已改变。');
          await write(file, file.path);
        } catch (error) {
          throw new Error(`笔记已创建，原选区未能关联：${file.path}。
${error instanceof Error ? error.message : ''}`);
        }
        if (openInWindow) await this.openNewWindow(view, file);
        else if (mode === 'source') view.editor.focus();
      },
      closed: () => {
        if (this.picker !== picker) return;
        this.picker = undefined;
        this.generation++;
        this.subpathChoice?.close(); this.subpathChoice = undefined;
      }
    }, operation.occurrence ? { currentTarget: operation.occurrence.target } : undefined);
    this.picker = picker;
    picker.open();
  }
  private async openNewWindow(source: MarkdownView, file: TFile): Promise<void> {
    let leaf;
    try {
      leaf = this.app.workspace.getLeaf('window');
      await leaf.openFile(file, { active: true, state: { mode: 'source' } });
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      leaf.view.containerEl.ownerDocument.defaultView?.focus();
      if (leaf.view instanceof MarkdownView) leaf.view.editor.focus();
    } catch {
      if (leaf?.view.getViewType() === 'empty') leaf.detach();
      const message = source.containerEl.ownerDocument.createDocumentFragment();
      message.createDiv({ text: `已创建并关联 ${file.path}，但未能在新窗口打开。` });
      const retry = message.createEl('button', { text: '重新打开', attr: { type: 'button' } });
      const notice = new Notice(message, 10000);
      retry.onclick = () => { notice.hide(); void this.openNewWindow(source, file); };
    }
  }
  cancel(): void {
    this.generation++;
    this.subpathChoice?.close(); this.subpathChoice = undefined;
    this.picker?.close();
    this.picker = undefined;
  }
}
