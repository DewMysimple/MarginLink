import { FileView, type TFile, type WorkspaceLeaf } from 'obsidian';
import { ATTACHMENT_VIEW_TYPE, FILE_TYPES, type FileRecognition } from '../core/file-recognition';

// Obsidian can restore FileViews at startup. Only show file metadata here;
// opening a browser or XMind stays an explicit native File Explorer action.
export class AttachmentView extends FileView {
  constructor(leaf: WorkspaceLeaf, private recognition: FileRecognition) { super(leaf); }
  getViewType(): string { return ATTACHMENT_VIEW_TYPE; }
  getIcon(): string { return this.file?.extension.toLowerCase() === 'xmind' ? 'git-fork' : 'file-code'; }
  canAcceptExtension(extension: string): boolean { return this.recognition.status(extension) === 'registered'; }

  private renderFile(file: TFile): void {
    const group = FILE_TYPES.find(group => group.extensions.some(ext => ext === file.extension.toLowerCase()));
    this.contentEl.empty();
    if (!this.canAcceptExtension(file.extension)) {
      this.contentEl.createEl('p', { text: 'MarginLink 当前未接管此类型。请从文件列表重新打开该文件。' });
      return;
    }
    this.contentEl.createEl('h2', { text: file.name });
    this.contentEl.createEl('p', { text: group?.name ?? file.extension });
    this.contentEl.createEl('p', { text: '要查看文件内容，请在文件列表中右键点击该文件，选择“在默认应用中打开”。' });
  }
  async onLoadFile(file: TFile): Promise<void> { this.renderFile(file); }
  async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    if (this.file === file) this.renderFile(file);
  }
  async onUnloadFile(): Promise<void> { this.contentEl.empty(); }
}
