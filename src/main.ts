import { MarkdownView, Modal, Notice, Plugin } from 'obsidian';
import { readPreferences, DEFAULT_PREFERENCES, type Preferences } from './types';
import { editorExtension, type EditorBridge } from './editor/editor-extension';
import { ReadingAnchors } from './reading/reading-anchors';
import { SelectionAction } from './editor/selection-action';
import { MarginOverlay } from './view/margin-overlay';
import { MarginLinkSettings } from './ui/settings-tab';
import { LayoutStore, readStoredData } from './core/layout-store';
import { QuickControls, ConfirmAction } from './ui/quick-controls';
import { MarginLinkSettingsView, SETTINGS_VIEW_TYPE } from './ui/settings-view';

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
  private noteListeners = new Map<MarkdownView, () => void>();
  private recentMarkdown?: MarkdownView;
  private recentSource?: string;
  private openingSettings?: Promise<void>;
  readonly dialogs = new Set<Modal>();
  async onload(): Promise<void> {
    const data = readStoredData(await this.loadData());
    this.preferences = data.preferences;
    this.layouts = new LayoutStore(data.layouts, () => { this.refresh(); this.queueSave(); });
    this.reading = new ReadingAnchors(this.app, () => this.refresh());
    this.selection = new SelectionAction(this.app, () => this.refresh());
    this.registerEditorExtension(editorExtension(this));
    this.registerMarkdownPostProcessor((el, ctx) => this.reading.process(el, ctx));
    this.addSettingTab(new MarginLinkSettings(this.app, this));
    this.registerView(SETTINGS_VIEW_TYPE, leaf => new MarginLinkSettingsView(leaf, this));
    this.addRibbonIcon('link', '打开 MarginLink 设置', () => { void this.openSettingsPanel(); });
    this.addCommand({ id: 'toggle', name: '切换边缘关联显示 / Toggle margin links', callback: async () => { this.preferences.enabled = !this.preferences.enabled; await this.savePreferences(); } });
    this.addCommand({ id: 'refresh', name: '刷新边缘关联 / Refresh margin links', callback: () => { this.sync(); this.refresh(); } });
    this.addCommand({ id: 'quick-controls', name: '打开快捷控制 / Open quick controls', callback: () => new QuickControls(this.app, this).open() });
    this.addCommand({ id: 'open-settings', name: '打开完整设置 / Open settings', callback: () => { void this.openSettingsPanel(); } });
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
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      const active = leaf?.view instanceof MarkdownView ? leaf.view : undefined;
      if (active) this.rememberMarkdown(active);
      // Native focus can report this event after pointerdown already started a
      // drag in the newly active note. Only cancel interactions in other leaves.
      this.cancelInteractions(active); this.sync();
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.cancelInteractions(); this.sync(); }));
    this.registerEvent(this.app.workspace.on('css-change', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('changed', (file, text) => {
      // Cache callbacks carry one complete, named source document. Ignore a stale
      // disk snapshot while an open editor already contains newer changes.
      const normalize = (value: string) => value.replace(/\r\n?/g, '\n');
      if (file.extension === 'md' && ![...this.overlays.keys()].some(view => view.file?.path === file.path && view.getMode() === 'source' && normalize(view.editor.getValue()) !== normalize(text))) this.layouts.reconcileDocument(file.path, text);
      this.refresh();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { this.layouts.renameSource(oldPath, file.path); this.cancelInteractions(); this.refresh(); }));
    this.registerEvent(this.app.vault.on('delete', file => { this.layouts.deleteSource(file.path); this.cancelInteractions(); this.refresh(); }));
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
        if (!this.overlays.has(view)) {
          this.overlays.set(view, new MarginOverlay(view, this));
          const remember = () => this.rememberMarkdown(view);
          const capture = { capture: true };
          view.containerEl.addEventListener('pointerdown', remember, capture);
          view.containerEl.addEventListener('focusin', remember, capture);
          this.noteListeners.set(view, () => {
            view.containerEl.removeEventListener('pointerdown', remember, capture);
            view.containerEl.removeEventListener('focusin', remember, capture);
          });
        }
      }
    });
    for (const [view, overlay] of this.overlays) if (!live.has(view)) { overlay.destroy(); this.overlays.delete(view); this.noteListeners.get(view)?.(); this.noteListeners.delete(view); }
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.rememberMarkdown(active);
    else if (!this.recentMarkdown || !live.has(this.recentMarkdown)) {
      const recent = this.app.workspace.getMostRecentLeaf()?.view;
      this.rememberMarkdown(recent instanceof MarkdownView ? recent : undefined);
    }
    this.refresh();
  }
  refresh(): void { if (!this.unloaded) for (const overlay of this.overlays.values()) overlay.schedule(); }
  subscribe(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  private rememberMarkdown(view?: MarkdownView): void {
    const source = view?.file?.path;
    if (this.recentMarkdown === view && this.recentSource === source) return;
    this.recentMarkdown = view; this.recentSource = source;
    for (const cb of this.listeners) cb();
  }
  activeSource(): string | undefined { return this.recentMarkdown?.file?.path; }
  openSettingsPanel(): Promise<void> {
    if (this.unloaded) return Promise.resolve();
    if (this.openingSettings) return this.openingSettings;
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.rememberMarkdown(active);
    const opening = async () => {
      const workspace = this.app.workspace;
      let leaf = workspace.getLeavesOfType(SETTINGS_VIEW_TYPE)[0];
      if (!leaf) {
        const sideLeaf = workspace.getRightLeaf(false);
        if (!sideLeaf) return;
        leaf = sideLeaf;
        await leaf.setViewState({ type: SETTINGS_VIEW_TYPE, active: true });
      }
      if (this.unloaded) { if (leaf.view.getViewType() === SETTINGS_VIEW_TYPE) leaf.detach(); return; }
      await workspace.revealLeaf(leaf);
      if (this.unloaded) { if (leaf.view.getViewType() === SETTINGS_VIEW_TYPE) leaf.detach(); return; }
      workspace.setActiveLeaf(leaf, { focus: true });
    };
    this.openingSettings = opening().catch(() => { new Notice('MarginLink 设置面板打开失败，请重试。'); }).finally(() => { this.openingSettings = undefined; });
    return this.openingSettings;
  }
  confirmReset(source?: string): void {
    new ConfirmAction(this.app, this, source ? '清除当前笔记布局' : '清除所有笔记布局', '只删除自定义卡片位置，原生双链与笔记内容完全保留。', () => this.layouts.clear(source)).open();
  }
  private cancelInteractions(except?: MarkdownView): void { this.selection?.cancel(); for (const [view, overlay] of this.overlays) if (view !== except) overlay.cancelInteractions(); }
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
    this.app.workspace.detachLeavesOfType(SETTINGS_VIEW_TYPE);
    for (const dialog of [...this.dialogs]) dialog.close(); this.dialogs.clear(); this.listeners.clear();
    for (const dispose of this.noteListeners.values()) dispose(); this.noteListeners.clear();
    this.recentMarkdown = undefined; this.recentSource = undefined;
    for (const overlay of this.overlays.values()) overlay.destroy();
    this.overlays.clear(); this.reading?.clear(); this.bridges.clear();
  }
}
