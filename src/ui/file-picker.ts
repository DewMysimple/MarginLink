import { Modal, Notice, prepareFuzzySearch, sortSearchResults, type App, type TFile } from 'obsidian';
import { defaultNoteFolder, newNotePath, type NewNotePreferences } from '../core/new-note';
import { attachmentPath, desktopFileRuntime, LocalFileImporter, type LocalFileInspection, type ImportedFile } from '../core/local-file-import';

export interface PickerActions {
  /** Return only after the single source transaction has been confirmed. */
  existing(file: TFile): void | Promise<void>;
  create(folder: string, name: string, openInWindow: boolean): Promise<void>;
  validate?(): void;
  closed(): void;
}
export interface PickerOptions { currentTarget?: string }

export class FilePicker extends Modal {
  private panel!: HTMLElement;
  private existingTab!: HTMLButtonElement;
  private newTab!: HTMLButtonElement;
  private busy = false;
  private folder: string;
  private filename: string;
  private search = '';
  private queryGeneration = 0;
  private operation?: AbortController;
  private onWindowBlur = () => { if (!this.busy) this.close(); };

  constructor(app: App, private alias: string, private prefs: NewNotePreferences, private actions: PickerActions, private options: PickerOptions = {}) {
    super(app);
    this.folder = defaultNoteFolder(prefs);
    this.filename = alias.trim();
  }
  onOpen(): void {
    this.setTitle('关联文件');
    this.contentEl.addClass('margin-link-file-picker');
    if (this.options.currentTarget) this.contentEl.createEl('p', { text: `当前目标：${this.options.currentTarget}` });
    const tabs = this.contentEl.createDiv({ cls: 'margin-link-file-actions' });
    this.existingTab = tabs.createEl('button', { text: '已有文件', attr: { type: 'button' } });
    this.newTab = tabs.createEl('button', { text: '新建文件', attr: { type: 'button' } });
    this.panel = this.contentEl.createDiv();
    this.existingTab.onclick = () => this.show('existing');
    this.newTab.onclick = () => this.show('new');
    this.modalEl.ownerDocument.defaultView?.addEventListener('blur', this.onWindowBlur);
    this.show('existing');
  }
  private show(mode: 'existing' | 'new'): void {
    if (this.busy) return;
    this.queryGeneration++;
    this.panel.empty();
    this.existingTab.setAttribute('aria-pressed', String(mode === 'existing'));
    this.newTab.setAttribute('aria-pressed', String(mode === 'new'));
    if (mode === 'existing') this.showFiles();
    else this.showNewNote();
  }
  private showFiles(): void {
    const input = this.panel.createEl('input', { cls: 'prompt-input', attr: { type: 'search', placeholder: '搜索文件名或路径', 'aria-label': '搜索已有文件' } });
    input.value = this.search;
    const results = this.panel.createDiv({ cls: 'margin-link-file-results' });
    let current = 0;
    let found: TFile[] = [];
    const choose = (file: TFile) => { void this.choose(file); };
    const highlight = () => {
      for (const [index, child] of Array.from(results.children).entries()) child.classList.toggle('is-selected', index === current);
      results.children[current]?.scrollIntoView({ block: 'nearest' });
    };
    const update = () => {
      const generation = ++this.queryGeneration;
      input.onkeydown = keydown;
      this.search = input.value;
      current = 0;
      const query = this.search.trim();
      if (/^["']?(?:[a-z]:[\\/]|\\\\|\/)/i.test(query)) {
        found = [];
        results.empty(); results.createDiv({ text: '正在检查本地文件…', attr: { role: 'status' } });
        void this.showLocalFile(query, input, results, generation);
        return;
      }
      const files = this.app.vault.getFiles();
      if (query) {
        const search = prepareFuzzySearch(query);
        const matches = files.flatMap(file => {
          const match = search(file.path);
          return match ? [{ item: file, match }] : [];
        });
        sortSearchResults(matches);
        found = matches.slice(0, 100).map(entry => entry.item);
      } else found = files.slice(0, 100);
      results.empty();
      for (const file of found) {
        const row = results.createEl('button', { cls: 'suggestion-item', text: file.path, attr: { type: 'button' } });
        row.onclick = () => choose(file);
      }
      if (found.length) highlight();
      else results.createDiv({ text: '未找到文件' });
    };
    input.oninput = update;
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || !found.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        current = (current + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
        highlight();
      } else if (event.key === 'Enter') { event.preventDefault(); choose(found[current]); }
    };
    update(); input.focus();
  }
  private async choose(file: TFile): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.actions.existing(file); }
    catch (error) { new Notice(error instanceof Error ? error.message : '无法关联文件。'); }
    finally { this.busy = false; }
  }
  private folderSelect(parent: HTMLElement): HTMLSelectElement {
    const select = parent.createEl('label', { text: '存放位置' }).createEl('select');
    for (const path of new Set([...this.prefs.newNoteFolders.filter(Boolean), '/'])) {
      const missing = path !== '/' && !this.app.vault.getFolderByPath(path);
      select.createEl('option', { text: path === '/' ? '仓库根目录' : path + (missing ? '（位置已失效）' : ''), value: path });
    }
    select.value = this.folder;
    return select;
  }
  private async showLocalFile(query: string, input: HTMLInputElement, results: HTMLElement, generation: number): Promise<void> {
    const current = () => generation === this.queryGeneration && this.panel.contains(input);
    try {
      const adapter = this.app.vault.adapter;
      if (!('getBasePath' in adapter) || typeof adapter.getBasePath !== 'function') throw new Error('库外路径仅支持桌面文件系统仓库。');
      const root = adapter.getBasePath() as string;
      const importer = new LocalFileImporter(desktopFileRuntime());
      const source = await importer.inspect(query, root);
      if (!current()) return;
      results.empty();
      if (!source) return;
      if (source.vaultPath) {
        const file = this.app.vault.getFileByPath(source.vaultPath);
        if (!file) throw new Error('文件位于仓库内，但尚未被 Obsidian 识别，请确认它不是隐藏文件或已被忽略。');
        results.createDiv({ text: `仓库内文件：${file.path}` });
        const use = results.createEl('button', { text: '关联此文件', cls: 'mod-cta', attr: { type: 'button' } });
        use.onclick = () => { void this.choose(file); };
        input.onkeydown = event => {
          if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void this.choose(file); }
        };
      } else this.showImport(source, importer, root, input, results);
    } catch (error) {
      if (current()) { results.empty(); results.createDiv({ text: error instanceof Error ? error.message : '无法访问该文件。', attr: { role: 'status' } }); }
    }
  }
  private showImport(source: LocalFileInspection, importer: LocalFileImporter, root: string, input: HTMLInputElement, parent: HTMLElement): void {
    parent.createEl('p', { text: `来源路径：${source.source}` });
    const folder = this.folderSelect(parent);
    const name = parent.createEl('label', { text: '目标文件名（保留扩展名）' }).createEl('input', { attr: { type: 'text' } });
    name.value = source.name;
    const preview = parent.createEl('p', { cls: 'margin-link-new-path' });
    const status = parent.createEl('p', { attr: { role: 'status' } });
    const buttons = parent.createDiv({ cls: 'margin-link-file-actions' });
    const move = buttons.createEl('button', { text: '移动到仓库并关联', cls: 'mod-cta', attr: { type: 'button' } });
    const useExisting = buttons.createEl('button', { text: '使用已有文件（保留原件）', attr: { type: 'button' } });
    parent.createEl('small', { text: '确认后先复制并校验内容，成功写入双链后才删除来源。撤销双链会保留已导入文件。' });
    let target = '';
    const refresh = () => {
      this.folder = folder.value; target = ''; move.disabled = true; useExisting.hidden = true;
      preview.setText(''); status.setText('');
      try {
        target = attachmentPath(this.folder, name.value);
        preview.setText(`最终库内路径：${target}`);
        if (this.folder !== '/' && !this.app.vault.getFolderByPath(this.folder)) throw new Error('目标文件夹已失效，请重新选择存放位置。');
        const existing = this.app.vault.getFileByPath(target);
        if (existing) {
          status.setText('目标已有同名文件，请改名或使用已有文件；来源将保留。');
          useExisting.hidden = false;
          useExisting.onclick = () => { void this.choose(existing); };
        } else if (this.app.vault.getAbstractFileByPath(target)) status.setText('目标位置已被同名文件夹占用。');
        else move.disabled = this.busy;
      } catch (error) { status.setText(error instanceof Error ? error.message : '请检查文件名和目标目录。'); }
    };
    const submit = async () => {
      if (this.busy || move.disabled) return;
      this.busy = true;
      const operation = new AbortController(); this.operation = operation;
      const controls = [input, name, folder, move, useExisting, this.newTab, this.existingTab];
      for (const control of controls) control.disabled = true;
      status.setText('正在复制、校验并关联…');
      try {
        const result = await importer.move(source, target, {
          root, validate: this.actions.validate,
          resolve: async path => {
            // Let the host watcher index this one new path; never scan the disk.
            for (let attempts = 0; attempts < 100; attempts++) {
              if (operation.signal.aborted) throw new Error('操作已取消。');
              const file = this.app.vault.getFileByPath(path);
              if (file?.path === path) return file;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error('完整副本已写入，但 Obsidian 尚未识别它；请稍后从仓库中关联此文件。');
          },
          commit: file => this.actions.existing(file)
        }, operation.signal);
        if (result.sourceRemoved) new Notice(`已移动到仓库并关联：${result.targetPath}`);
        else this.showRemovalRetry(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : '移动失败，原文件已保留。';
        if (this.containerEl.isConnected) { refresh(); status.setText(message); }
        else new Notice(message);
      } finally {
        this.busy = false;
        if (this.operation === operation) this.operation = undefined;
        for (const control of controls) control.disabled = false;
        // Re-read collision state after a failed copy; never submit a second copy.
        if (this.containerEl.isConnected) {
          const message = status.textContent;
          refresh(); if (message) status.setText(message);
        }
      }
    };
    name.oninput = refresh; folder.onchange = refresh;
    move.onclick = () => { void submit(); };
    input.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
    refresh();
  }
  private showRemovalRetry(result: ImportedFile<TFile>): void {
    const fragment = this.modalEl.ownerDocument.createDocumentFragment();
    const message = fragment.createDiv({ text: `已关联，原文件仍保留在：${result.source}。${result.removalError ?? ''}` });
    const retry = fragment.createEl('button', { text: '重试删除原文件', attr: { type: 'button' } });
    new Notice(fragment, 0);
    retry.onclick = () => {
      if (retry.disabled) return;
      retry.disabled = true;
      void result.retryRemoval().then(() => { message.setText('已删除经过再次校验的原文件。'); retry.remove(); })
        .catch(error => { message.setText(`已关联，原文件仍保留在：${result.source}。${error instanceof Error ? error.message : '删除失败。'}`); retry.disabled = false; });
    };
  }
  private showNewNote(): void {
    const label = this.panel.createEl('label', { text: '文件名' });
    const name = label.createEl('input', { attr: { type: 'text' } });
    name.value = this.filename;
    const folder = this.folderSelect(this.panel);
    const pathLabel = this.panel.createEl('p', { cls: 'margin-link-new-path' });
    const status = this.panel.createEl('p', { attr: { role: 'status' } });
    const buttons = this.panel.createDiv({ cls: 'margin-link-file-actions' });
    const create = buttons.createEl('button', { text: '创建并链接', cls: 'mod-cta', attr: { type: 'button' } });
    const useExisting = buttons.createEl('button', { text: '使用已有文件', attr: { type: 'button' } });
    this.panel.createEl('small', { text: 'Ctrl + 点击可在新窗口打开' });
    const refresh = () => {
      this.filename = name.value; this.folder = folder.value;
      pathLabel.setText(''); status.setText('');
      useExisting.hidden = true; create.disabled = true;
      try {
        const path = newNotePath(this.folder, this.filename, this.alias);
        pathLabel.setText(path);
        if (this.folder !== '/' && !this.app.vault.getFolderByPath(this.folder)) throw new Error('目标文件夹已失效，请重新选择存放位置。');
        const existing = this.app.vault.getFileByPath(path);
        if (existing) {
          status.setText('该位置已有同名文件，可以改名或使用已有文件。');
          useExisting.hidden = false;
          useExisting.onclick = () => { void this.choose(existing); };
        } else if (this.app.vault.getAbstractFileByPath(path)) {
          status.setText('目标位置已被同名文件夹占用。');
        } else create.disabled = this.busy;
      } catch (error) { status.setText(error instanceof Error ? error.message : '请检查文件名与目录。'); }
    };
    const submit = async (openInWindow: boolean) => {
      if (this.busy || create.disabled) return;
      this.busy = true;
      for (const control of [create, name, folder, this.newTab, this.existingTab]) control.disabled = true;
      try { await this.actions.create(this.folder, this.filename, openInWindow); }
      catch (error) {
        if (this.containerEl.isConnected) {
          this.busy = false;
          for (const control of [name, folder, this.newTab, this.existingTab]) control.disabled = false;
          refresh();
          status.setText(error instanceof Error ? error.message : '创建失败，请重试。');
        } else new Notice(error instanceof Error ? error.message : '创建失败。');
      }
    };
    create.onclick = event => { void submit(event.ctrlKey); };
    name.onkeydown = event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void submit(false); }
    };
    name.oninput = refresh; folder.onchange = refresh;
    refresh(); name.focus(); name.select();
  }
  onClose(): void {
    this.queryGeneration++;
    this.operation?.abort();
    this.modalEl.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
    this.actions.closed();
    this.contentEl.empty();
  }
}
