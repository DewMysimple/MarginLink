import { MarkdownView, Notice, Plugin } from 'obsidian';
import { readPreferences, DEFAULT_PREFERENCES, type Preferences } from './types';
import { editorExtension, type EditorBridge } from './editor/editor-extension';
import { ReadingAnchors } from './reading/reading-anchors';
import { SelectionAction } from './editor/selection-action';
import { MarginOverlay } from './view/margin-overlay';
import { MarginLinkSettings } from './ui/settings-tab';

export default class MarginLinkPlugin extends Plugin {
  preferences: Preferences = { ...DEFAULT_PREFERENCES };
  bridges = new Set<EditorBridge>();
  reading!: ReadingAnchors;
  selection!: SelectionAction;
  private overlays = new Map<MarkdownView, MarginOverlay>();
  private unloaded = false;
  async onload(): Promise<void> {
    this.preferences = readPreferences(await this.loadData());
    this.reading = new ReadingAnchors(this.app, () => this.refresh());
    this.selection = new SelectionAction(this.app, () => this.refresh());
    this.registerEditorExtension(editorExtension(this));
    this.registerMarkdownPostProcessor((el, ctx) => this.reading.process(el, ctx));
    this.addSettingTab(new MarginLinkSettings(this.app, this));
    this.addCommand({ id: 'toggle', name: '切换边缘关联显示 / Toggle margin links', callback: async () => { this.preferences.enabled = !this.preferences.enabled; await this.savePreferences(); } });
    this.addCommand({ id: 'refresh', name: '刷新边缘关联 / Refresh margin links', callback: () => { this.sync(); this.refresh(); } });
    this.addCommand({ id: 'link-selection', name: '将选中文字链接到文件 / Link selected text to file', editorCallback: (_editor, ctx) => {
      if (!(ctx instanceof MarkdownView)) { new Notice('请在主 Markdown 编辑视图中使用此命令。'); return; }
      this.sync();
      const bridge = this.overlays.get(ctx)?.bridge();
      if (!bridge) { new Notice('编辑器暂未就绪，请稍后再试。'); return; }
      const snapshot = this.selection.capture(ctx, bridge);
      if (snapshot) this.selection.open(ctx, bridge, snapshot);
    } });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.sync()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => { this.selection.cancel(); this.sync(); }));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.selection.cancel(); this.sync(); }));
    this.registerEvent(this.app.workspace.on('css-change', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.refresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.refresh()));
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
  async savePreferences(): Promise<void> { await this.saveData(readPreferences(this.preferences)); this.refresh(); }
  onunload(): void {
    this.unloaded = true; this.selection?.cancel();
    for (const overlay of this.overlays.values()) overlay.destroy();
    this.overlays.clear(); this.reading?.clear(); this.bridges.clear();
  }
}
