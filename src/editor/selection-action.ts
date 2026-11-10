import { MarkdownView, Notice, type App, type TFile } from 'obsidian';
import { FilePicker } from '../ui/file-picker';
import { formatWikilink } from '../core/link-formatter';
import { exactTarget } from '../core/link-resolver';
import { validateSelection, validateSnapshot, type SelectionSnapshot } from './selection-validation';
import type { EditorBridge } from './editor-extension';
import type { Side } from '../types';

export class SelectionAction {
  private picker?: FilePicker;
  private generation = 0;
  constructor(private app: App, private changed: () => void) {}
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
    let chosen = false;
    const picker = new FilePicker(this.app, file => {
      chosen = true;
      if (generation !== this.generation) return;
      this.write(view, bridge, snapshot, file, side);
    }, () => {
      // SuggestModal closes before onChooseItem; defer disposal until selection runs.
      queueMicrotask(() => { if (!chosen && this.picker === picker) this.picker = undefined; });
    });
    this.picker = picker;
    picker.open();
  }
  private write(view: MarkdownView, bridge: EditorBridge, snapshot: SelectionSnapshot, file: TFile, side?: Side): void {
    try {
      const error = validateSnapshot(snapshot, {
        sourcePath: view.file?.path ?? '', text: view.editor.getValue(), revision: bridge.revision,
        active: bridge.alive && view.getMode() === 'source' && this.app.workspace.getActiveViewOfType(MarkdownView) === view
      });
      if (error) throw new Error(error);
      const current = bridge.cm.state.selection.main;
      if (current.from !== snapshot.from || current.to !== snapshot.to || bridge.cm.state.selection.ranges.length !== 1) throw new Error('原选区已改变，请重新选择文字。');
      if (this.app.vault.getFileByPath(file.path) !== file) throw new Error('目标文件已删除或改变，请重新选择。');
      const target = exactTarget(this.app, file, snapshot.sourcePath);
      const link = formatWikilink(target, snapshot.selected);
      const from = view.editor.offsetToPos(snapshot.from);
      const to = view.editor.offsetToPos(snapshot.to);
      // A single public Editor transaction: normal Obsidian undo/redo and saving.
      const caret = { line: from.line, ch: from.ch + link.length };
      view.editor.transaction({ changes: [{ from, to, text: link }], selection: { from: caret } }, 'margin-link');
      view.editor.focus();
      if (side) bridge.prefer(snapshot.from, target, side);
      this.picker = undefined;
      this.changed();
    } catch (error) { new Notice(error instanceof Error ? error.message : '创建双链失败，未修改笔记。'); }
    finally { this.picker = undefined; }
  }
  cancel(): void {
    this.generation++;
    this.picker?.close();
    this.picker = undefined;
  }
}
