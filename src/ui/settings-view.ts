import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type MarginLinkPlugin from '../main';
import { renderSettings } from './settings-tab';

export const SETTINGS_VIEW_TYPE = 'margin-link-settings';

export class MarginLinkSettingsView extends ItemView {
  private dispose?: () => void;
  constructor(leaf: WorkspaceLeaf, private plugin: MarginLinkPlugin) { super(leaf); }
  getViewType(): string { return SETTINGS_VIEW_TYPE; }
  getDisplayText(): string { return 'MarginLink'; }
  getIcon(): string { return 'link'; }
  async onOpen(): Promise<void> {
    this.dispose?.();
    this.contentEl.addClass('margin-link-settings-view');
    this.dispose = renderSettings(this.contentEl, this.plugin);
  }
  async onClose(): Promise<void> {
    this.dispose?.(); this.dispose = undefined;
    this.contentEl.empty();
  }
}
