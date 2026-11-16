import { Modal, Notice, prepareFuzzySearch, sortSearchResults, type App, type TFile } from 'obsidian';
import { defaultNoteFolder, newNotePath, type NewNotePreferences } from '../core/new-note';

interface PickerActions {
  existing(file: TFile): void;
  create(folder: string, name: string, openInWindow: boolean): Promise<void>;
  closed(): void;
}

export class FilePicker extends Modal {
  private panel!: HTMLElement;
  private existingTab!: HTMLButtonElement;
  private newTab!: HTMLButtonElement;
  private busy = false;
  private folder: string;
  private filename: string;
  private search = '';
  private onWindowBlur = () => { if (!this.busy) this.close(); };

  constructor(app: App, private alias: string, private prefs: NewNotePreferences, private actions: PickerActions) {
    super(app);
    this.folder = defaultNoteFolder(prefs);
    this.filename = alias.trim();
  }
  onOpen(): void {
    this.setTitle('关联文件');
    this.contentEl.addClass('margin-link-file-picker');
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
    const choose = (file: TFile) => {
      try { this.actions.existing(file); } catch (e) { new Notice(e instanceof Error ? e.message : '无法关联文件。'); }
    };
    const highlight = () => {
      for (const [index, child] of Array.from(results.children).entries()) child.classList.toggle('is-selected', index === current);
      results.children[current]?.scrollIntoView({ block: 'nearest' });
    };
    const update = () => {
      this.search = input.value;
      current = 0;
      const query = this.search.trim();
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
    input.onkeydown = event => {
      if (event.isComposing || !found.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        current = (current + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
        highlight();
      } else if (event.key === 'Enter') { event.preventDefault(); choose(found[current]); }
    };
    update(); input.focus();
  }
  private showNewNote(): void {
    const label = this.panel.createEl('label', { text: '文件名' });
    const name = label.createEl('input', { attr: { type: 'text' } });
    name.value = this.filename;
    const folder = this.panel.createEl('label', { text: '存放位置' }).createEl('select');
    const paths = new Set([...this.prefs.newNoteFolders.filter(Boolean), '/']);
    for (const path of paths) {
      const missing = path !== '/' && !this.app.vault.getFolderByPath(path);
      folder.createEl('option', { text: path === '/' ? '仓库根目录' : path + (missing ? '（位置已失效）' : ''), value: path });
    }
    folder.value = this.folder;
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
          useExisting.onclick = () => { try { this.actions.existing(existing); } catch (e) { status.setText(String(e)); } };
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
    this.modalEl.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
    this.actions.closed();
    this.contentEl.empty();
  }
}
