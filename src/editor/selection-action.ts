import { MarkdownView, Notice, type App, type TFile } from 'obsidian';
import { FilePicker } from '../ui/file-picker';
import { formatWikilink } from '../core/link-formatter';
import { exactTarget } from '../core/link-resolver';
import { validateSelection, validateSnapshot, type SelectionSnapshot } from './selection-validation';
import type { EditorBridge } from './editor-extension';
import type { Side } from '../types';
import { newNotePath, type NewNotePreferences } from '../core/new-note';

export class SelectionAction {
  private picker?: FilePicker;
  private generation = 0;
  constructor(private app: App, private changed: () => void, private preferences: () => NewNotePreferences) {}
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
    this.cancel();
    const generation = this.generation;
    const validate = () => {
      if (generation !== this.generation) throw new Error('原选区已失效，请重新选择文字。');
      const error = validateSnapshot(snapshot, {
        sourcePath: view.file?.path ?? '', text: view.editor.getValue(), revision: bridge.revision,
        active: bridge.alive && view.getMode() === 'source' && this.app.workspace.getActiveViewOfType(MarkdownView) === view
      });
      if (error) throw new Error(error);
      const selection = bridge.cm.state.selection;
      if (selection.main.from !== snapshot.from || selection.main.to !== snapshot.to || selection.ranges.length !== 1) {
        throw new Error('原选区已改变，请重新选择文字。');
      }
    };
    const write = (file: TFile, target: string) => {
      validate();
      if (this.app.vault.getFileByPath(file.path) !== file) throw new Error('目标文件已删除或改变，请重新选择。');
      const link = formatWikilink(target, snapshot.selected);
      const from = view.editor.offsetToPos(snapshot.from);
      const to = view.editor.offsetToPos(snapshot.to);
      const caret = { line: from.line, ch: from.ch + link.length };
      view.editor.transaction({ changes: [{ from, to, text: link }], selection: { from: caret } }, 'margin-link');
      // Closing must not restore the selection captured before the transaction.
      picker.shouldRestoreSelection = false;
      picker.close();
      if (side) bridge.prefer(snapshot.from, target, side);
      this.changed();
    };
    const picker = new FilePicker(this.app, snapshot.selected, this.preferences(), {
      existing: file => {
        write(file, exactTarget(this.app, file, snapshot.sourcePath));
        view.editor.focus();
      },
      create: async (folder, name, openInWindow) => {
        validate();
        const path = newNotePath(folder, name, snapshot.selected);
        if (folder !== '/' && !this.app.vault.getFolderByPath(folder)) throw new Error('目标文件夹已失效，请重新选择存放位置。');
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error('该位置已存在文件或文件夹，请改名或使用已有文件。');
        const file = await this.app.vault.create(path, '');
        try {
          if (file.path !== path) throw new Error('新笔记的位置已改变。');
          write(file, file.path);
        } catch (error) {
          throw new Error(`笔记已创建，原选区未能关联：${file.path}。
${error instanceof Error ? error.message : ''}`);
        }
        if (openInWindow) await this.openNewWindow(view, file);
        else view.editor.focus();
      },
      closed: () => {
        if (this.picker !== picker) return;
        this.picker = undefined;
        this.generation++;
      }
    });
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
    this.picker?.close();
    this.picker = undefined;
  }
}
