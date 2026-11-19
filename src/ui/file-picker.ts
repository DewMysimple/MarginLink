import { Modal, Notice, prepareFuzzySearch, sortSearchResults, type App, type TFile } from 'obsidian';
import { defaultNoteFolder, newNotePath, type NewNotePreferences } from '../core/new-note';
import { attachmentPath, desktopFileRuntime, LocalFileImporter, PublishedImportError, type LocalFileInspection, type ImportedFile, type ReplacementTarget, type PublishedStat } from '../core/local-file-import';

export interface PickerActions {
  /** Return only after the single source transaction has been confirmed. */
  existing(file: TFile): void | Promise<void>;
  validateReplacement(path: string): void | Promise<void>;
  replaced(file: TFile): void | Promise<void>;
  create(folder: string, name: string, openInWindow: boolean): Promise<void>;
  validate?(): void;
  closed(): void;
}
export interface PickerOptions { currentTarget?: string }

class ReplaceConfirmation extends Modal {
  private approved = false;
  private cancelButton?: HTMLButtonElement;
  open(): void { super.open(); this.cancelButton?.focus({ preventScroll: true }); }
  constructor(app: App, private target: string, private sourceName: string, private done: (approved: boolean) => void) { super(app); }
  onOpen(): void {
    this.setTitle('检测到同名文件');
    this.contentEl.addClass('margin-link-confirm');
    this.contentEl.createEl('p', { text: '现有文件：' + this.target });
    this.contentEl.createEl('p', { text: '新文件：' + this.sourceName });
    this.contentEl.createEl('p', { text: '新内容将替换现有文件。路径和原有 Wikilink 保持不变。此操作不会创建备份，MarginLink 无法恢复旧内容。' });
    const cancel = this.contentEl.createEl('button', { text: '取消', attr: { type: 'button' } });
    const replace = this.contentEl.createEl('button', { text: '替换文件', cls: 'mod-warning', attr: { type: 'button' } });
    this.cancelButton = cancel;
    cancel.onclick = () => this.close();
    replace.onclick = () => { replace.disabled = true; this.approved = true; this.close(); };
  }
  onClose(): void { this.done(this.approved); this.contentEl.empty(); }
}

export class FilePicker extends Modal {
  private panel!: HTMLElement;
  private existingTab!: HTMLButtonElement;
  private newTab!: HTMLButtonElement;
  private busy = false;
  private folder: string;
  private filename: string;
  private search = '';
  private opened = false;
  private focusTarget?: HTMLInputElement;
  private queryGeneration = 0;
  private operation?: AbortController;
  private probe?: AbortController;
  private confirmation?: ReplaceConfirmation;
  private onWindowClose = () => this.close();
  private onWindowBlur = () => { if (!this.busy) this.close(); };

  constructor(app: App, private alias: string, private prefs: NewNotePreferences, private actions: PickerActions, private options: PickerOptions = {}) {
    super(app);
    this.folder = defaultNoteFolder(prefs);
    this.filename = alias.trim();
  }
  open(): void {
    const wasOpen = this.opened;
    super.open();
    // Modal.open performs its own initial focus after onOpen. Apply our
    // explicit input target after that synchronous host step, without a timer
    // that could steal focus from a later user action or a closed dialog.
    if (!wasOpen) this.focusInput();
  }
  onOpen(): void {
    this.opened = true;
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
    this.modalEl.ownerDocument.defaultView?.addEventListener('pagehide', this.onWindowClose);
    this.show('existing');
  }
  private show(mode: 'existing' | 'new'): void {
    if (this.busy) return;
    this.queryGeneration++; this.probe?.abort();
    this.focusTarget = undefined;
    this.panel.empty();
    this.existingTab.setAttribute('aria-pressed', String(mode === 'existing'));
    this.newTab.setAttribute('aria-pressed', String(mode === 'new'));
    if (mode === 'existing') this.showFiles();
    else this.showNewNote();
  }
  private focusInput(select = false): void {
    const input = this.focusTarget;
    if (!this.opened || !input?.isConnected || !this.panel.contains(input)) return;
    input.focus({ preventScroll: true });
    if (select) input.select();
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
      this.probe?.abort();
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
    update(); this.focusTarget = input; this.focusInput();
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
    parent.createEl('small', { text: '确认后先复制并校验内容，关联成功后才删除来源。撤销双链会保留已导入文件。' });
    const controls = [input, name, folder, move, this.newTab, this.existingTab];
    let revision = 0;
    const current = (id: number) => this.opened && this.panel.contains(move) && id === revision;
    let target = '', collision: ReplacementTarget | undefined;
    const refresh = async (prompt: boolean) => {
      const id = ++revision;
      this.probe?.abort();
      const probe = new AbortController(); this.probe = probe;
      this.folder = folder.value; target = ''; collision = undefined; move.disabled = true;
      preview.setText(''); status.setText('');
      try {
        const requested = attachmentPath(this.folder, name.value);
        preview.setText(`最终库内路径：${requested}`);
        if (this.folder !== '/' && !this.app.vault.getFolderByPath(this.folder)) throw new Error('目标文件夹已失效，请重新选择存放位置。');
        const found = await importer.inspectTarget(source, root, requested, probe.signal);
        if (found && current(id)) await this.actions.validateReplacement(found.targetPath);
        if (!current(id)) return;
        collision = found; target = found?.targetPath ?? requested;
        preview.setText(`最终库内路径：${target}`);
        move.setText(found ? '确认替换…' : '移动到仓库并关联');
        move.disabled = this.busy;
        if (prompt && found) await submit();
      } catch (error) { if (current(id)) status.setText(error instanceof Error ? error.message : '请检查文件名和目标目录。'); }
    };
    const submit = async () => {
      if (this.busy || move.disabled || !target) return;
      this.busy = true;
      const operation = new AbortController(); this.operation = operation;
      const approved = collision;
      for (const control of controls) control.disabled = true;
      let message = '', stopWatching: (() => void) | undefined;
      try {
        let vaultStamp: PublishedStat | undefined, metadataStamp: PublishedStat | undefined;
        const markdown = target.toLowerCase().endsWith('.md');
        if (approved) {
          const ok = await new Promise<boolean>(done => {
            this.confirmation = new ReplaceConfirmation(this.app, target, source.name, done);
            this.confirmation.open();
          });
          this.confirmation = undefined;
          if (!ok || operation.signal.aborted) return;
          const vault = this.app.vault;
          const observed = () => {
            const file = vault.getFileByPath(target);
            if (file) vaultStamp = { size: file.stat.size, mtime: file.stat.mtime };
          };
          const modify = vault.on('modify', file => { if (file.path === target) observed(); });
          const create = vault.on('create', file => { if (file.path === target) observed(); });
          const cache = this.app.metadataCache;
          const changed = markdown ? cache.on('changed', file => {
            if (file.path === target) metadataStamp = { size: file.stat.size, mtime: file.stat.mtime };
          }) : undefined;
          stopWatching = () => { vault.offref(modify); vault.offref(create); if (changed) cache.offref(changed); };
        }
        status.setText('正在复制、校验并关联…');
        const result = await importer.move(source, target, {
          root, validate: approved ? () => this.actions.validateReplacement(target) : this.actions.validate,
          resolve: async (path, published) => {
            const matches = (stat?: PublishedStat) => !published || (!!stat && stat.size === published.size && Math.abs(stat.mtime - published.mtime) < 1.01);
            for (let attempts = 0; attempts < 100; attempts++) {
              if (operation.signal.aborted) throw new Error('操作已取消。');
              const file = this.app.vault.getFileByPath(path);
              if (file?.path === path && matches(file.stat) && matches(vaultStamp) && (!markdown || matches(metadataStamp))) return file;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error('Obsidian 尚未确认此路径的最新文件信息，请稍后检查库内文件。');
          },
          commit: file => approved ? this.actions.replaced(file) : this.actions.existing(file)
        }, operation.signal, approved);
        if (result.sourceRemoved) new Notice((approved ? '已替换文件，已清理库外来源：' : '已移动到仓库并关联：') + result.targetPath);
        else this.showRemovalRetry(result, !!approved);
      } catch (error) {
        message = error instanceof Error ? error.message : '移动失败，原文件已保留。';
        if (error instanceof PublishedImportError) {
          if (this.opened) this.close();
          new Notice(message, 15000);
        } else if (!this.opened) new Notice(message);
      } finally {
        stopWatching?.();
        this.busy = false;
        if (this.operation === operation) this.operation = undefined;
        if (this.opened) {
          for (const control of controls) control.disabled = false;
          await refresh(false);
          if (message) status.setText(message);
        }
      }
    };
    name.oninput = () => { void refresh(false); };
    folder.onchange = () => { void refresh(true); };
    move.onclick = () => { void submit(); };
    input.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
    void refresh(true);
  }
  private showRemovalRetry(result: ImportedFile<TFile>, replaced: boolean): void {
    const fragment = this.modalEl.ownerDocument.createDocumentFragment();
    const phase = replaced ? '目标内容已替换，关联已确认' : '已关联';
    const message = fragment.createDiv({ text: `${phase}，原文件仍保留在：${result.source}。${result.removalError ?? ''}` });
    const retry = fragment.createEl('button', { text: '重试删除原文件', attr: { type: 'button' } });
    new Notice(fragment, 0);
    retry.onclick = () => {
      if (retry.disabled) return;
      retry.disabled = true;
      void result.retryRemoval().then(() => { message.setText('已删除经过再次校验的原文件。'); retry.remove(); })
        .catch(error => { message.setText(`${phase}，原文件仍保留在：${result.source}。${error instanceof Error ? error.message : '删除失败。'}`); retry.disabled = false; });
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
    refresh(); this.focusTarget = name; this.focusInput(true);
  }
  onClose(): void {
    this.opened = false; this.focusTarget = undefined;
    this.queryGeneration++;
    this.probe?.abort();
    this.operation?.abort();
    this.confirmation?.close(); this.confirmation = undefined;
    this.modalEl.ownerDocument.defaultView?.removeEventListener('pagehide', this.onWindowClose);
    this.modalEl.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
    this.actions.closed();
    this.contentEl.empty();
  }
}
