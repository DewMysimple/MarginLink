import { FuzzySuggestModal, type App, type TFile } from 'obsidian';
export class FilePicker extends FuzzySuggestModal<TFile> {
  private onWindowBlur = () => this.close();
  constructor(app: App, private choose: (file: TFile) => void, private cancel: () => void) {
    super(app);
    this.setPlaceholder('选择已有文件 · 搜索名称或路径（Esc 取消）');
    this.setInstructions([{ command: '↑↓', purpose: '选择文件' }, { command: '↵', purpose: '创建原生双链' }, { command: 'esc', purpose: '取消' }]);
    this.modalEl.ownerDocument.defaultView?.addEventListener('blur', this.onWindowBlur);
  }
  getItems(): TFile[] { return this.app.vault.getFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.choose(file); }
  onClose(): void {
    super.onClose();
    this.modalEl.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
    this.cancel();
  }
}
