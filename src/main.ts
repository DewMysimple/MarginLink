import { MarkdownView, Modal, Notice, Plugin } from 'obsidian';
import { readPreferences, DEFAULT_PREFERENCES, type Preferences } from './types';
import { editorExtension, type EditorBridge } from './editor/editor-extension';
import { ReadingAnchors } from './reading/reading-anchors';
import { SelectionAction } from './editor/selection-action';
import { MarginOverlay } from './view/margin-overlay';
import { MarginLinkSettings } from './ui/settings-tab';
import { LayoutStore, readStoredData } from './core/layout-store';
import { QuickControls, ConfirmAction } from './ui/quick-controls';

export default class MarginLinkPlugin extends Plugin {
  preferences: Preferences = { ...DEFAULT_PREFERENCES };
  bridges = new Set<EditorBridge>();
  reading!: ReadingAnchors;
  selection!: SelectionAction;
  private overlays = new Map<MarkdownView, MarginOverlay>();
  private unloaded = false;
  layouts!: LayoutStore;
  private saveTimer?: number;
  private saving: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  readonly dialogs = new Set<Modal>();
  async onload(): Promise<void> {
    const data = readStoredData(await this.loadData());
    this.preferences = data.preferences;
    this.layouts = new LayoutStore(data.layouts, () => { this.refresh(); this.queueSave(); });
    this.reading = new ReadingAnchors(this.app, () => this.refresh(), (source, keys) => this.layouts.reconcile(source, keys));
    this.selection = new SelectionAction(this.app, () => this.refresh());
    this.registerEditorExtension(editorExtension(this));
    this.registerMarkdownPostProcessor((el, ctx) => this.reading.process(el, ctx));
    this.addSettingTab(new MarginLinkSettings(this.app, this));
    this.addCommand({ id: 'toggle', name: '切换边缘关联显示 / Toggle margin links', callback: async () => { this.preferences.enabled = !this.preferences.enabled; await this.savePreferences(); } });
    this.addCommand({ id: 'refresh', name: '刷新边缘关联 / Refresh margin links', callback: () => { this.sync(); this.refresh(); } });
    this.addCommand({ id: 'quick-controls', name: '打开快捷控制 / Open quick controls', callback: () => new QuickControls(this.app, this).open() });
    this.addCommand({ id: 'reset-note-layout', name: '清除当前笔记布局 / Reset note layout', callback: () => { const source = this.activeSource(); if (source) this.confirmReset(source); else new Notice('请先打开要整理的 Markdown 笔记。'); } });
    this.addCommand({ id: 'reset-all-layouts', name: '清除所有布局 / Reset all layouts', callback: () => this.confirmReset() });
    this.addCommand({ id: 'link-selection', name: '将选中文字链接到文件 / Link selected text to file', editorCallback: (_editor, ctx) => {
      if (!(ctx instanceof MarkdownView)) { new Notice('请在主 Markdown 编辑视图中使用此命令。'); return; }
      this.sync();
      const bridge = this.overlays.get(ctx)?.bridge();
      if (!bridge) { new Notice('编辑器暂未就绪，请稍后再试。'); return; }
      const snapshot = this.selection.capture(ctx, bridge);
      if (snapshot) this.selection.open(ctx, bridge, snapshot);
    } });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.sync()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => { this.cancelInteractions(); this.sync(); }));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.cancelInteractions(); this.sync(); }));
    this.registerEvent(this.app.workspace.on('css-change', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refresh()));
    // No reverse relationship index: conservatively invalidate UI coordinates on
    // rename/delete, including folder operations, instead of guessing a migration.
    this.registerEvent(this.app.vault.on('rename', () => { this.layouts.clear(); this.cancelInteractions(); this.refresh(); }));
    this.registerEvent(this.app.vault.on('delete', () => { this.layouts.clear(); this.cancelInteractions(); this.refresh(); }));
    this.registerEvent(this.app.vault.on('create', () => this.refresh()));
    this.registerEvent(this.app.vault.on('modify', () => this.refresh()));
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.sync();
      // Existing reading views also need the newly registered postprocessor.
      for (const view of this.overlays.keys()) if (view.getMode() === 'preview') view.previewMode.rerender(true);
    });
  }
  private sync(): void {
    if (this.unloaded) return;
    const live = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView) {
        const view = leaf.view; live.add(view);
        if (!this.overlays.has(view)) this.overlays.set(view, new MarginOverlay(view, this));
      }
    });
    for (const [view, overlay] of this.overlays) if (!live.has(view)) { overlay.destroy(); this.overlays.delete(view); }
    this.refresh();
  }
  refresh(): void { if (!this.unloaded) for (const overlay of this.overlays.values()) overlay.schedule(); }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  activeSource(): string | undefined { return this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path; }
  confirmReset(source?: string): void {
    new ConfirmAction(this.app, this, source ? '清除当前笔记布局' : '清除所有笔记布局', '只删除自定义卡片位置，原生双链与笔记内容完全保留。', () => this.layouts.clear(source)).open();
  }
  private cancelInteractions(): void { this.selection?.cancel(); for (const o of this.overlays.values()) o.cancelInteractions(); }
  private queueSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.flush().catch(() => new Notice('MarginLink 布局保存失败，请检查笔记库写入权限。')); }, 250);
  }
  async flush(): Promise<void> {
    window.clearTimeout(this.saveTimer); this.saveTimer = undefined;
    const snapshot = { schemaVersion: 2, preferences: readPreferences(this.preferences), layouts: this.layouts.snapshot() };
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData(snapshot));
    return this.saving;
  }
  async savePreferences(): Promise<void> {
    this.preferences = readPreferences(this.preferences); this.cancelInteractions(); this.refresh();
    for (const cb of this.listeners) cb();
    try { await this.flush(); } catch { new Notice('MarginLink 设置保存失败，请检查笔记库写入权限。'); }
  }
  async onExternalSettingsChange(): Promise<void> {
    window.clearTimeout(this.saveTimer); await this.saving.catch(() => undefined);
    const data = readStoredData(await this.loadData()); this.cancelInteractions();
    this.preferences = data.preferences; this.layouts = new LayoutStore(data.layouts, () => { this.refresh(); this.queueSave(); });
    this.refresh(); for (const cb of this.listeners) cb();
  }
  onunload(): void {
    this.unloaded = true; this.selection?.cancel();
    if (this.saveTimer !== undefined) void this.flush().catch(() => new Notice('MarginLink 关闭时保存布局失败。'));
    for (const dialog of [...this.dialogs]) dialog.close(); this.dialogs.clear(); this.listeners.clear();
    for (const overlay of this.overlays.values()) overlay.destroy();
    this.overlays.clear(); this.reading?.clear(); this.bridges.clear();
  }
}
