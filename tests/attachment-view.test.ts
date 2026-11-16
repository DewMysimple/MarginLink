import { describe, expect, it, vi } from 'vitest';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import { FileRecognition } from '../src/core/file-recognition';
import { DEFAULT_PREFERENCES } from '../src/types';
import { AttachmentView } from '../src/view/attachment-view';

vi.mock('obsidian', () => ({
  FileView: class {
    file: TFile | null = null;
    contentEl = { empty: vi.fn(), createEl: vi.fn() };
    async onRename() {}
  }
}));

describe('attachment information view', () => {
  it('renders names as text and only updates the current file after a rename', async () => {
    const registration = new FileRecognition();
    registration.register(DEFAULT_PREFERENCES, () => {});
    const view = new AttachmentView({} as WorkspaceLeaf, registration);
    const file = { name: '<Report>.HTML', extension: 'HTML' } as TFile;
    view.file = file;
    await view.onLoadFile(file);
    const create = vi.mocked(view.contentEl.createEl);
    expect(create).toHaveBeenCalledWith('h2', { text: '<Report>.HTML' });
    create.mockClear();
    await view.onRename({ name: 'unrelated.md', extension: 'md' } as TFile);
    expect(create).not.toHaveBeenCalled();
    await view.onRename(file);
    expect(create).toHaveBeenCalledWith('h2', { text: file.name });
  });
});
