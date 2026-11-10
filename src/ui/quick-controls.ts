import { Modal, Setting, type App } from 'obsidian';
import type MarginLinkPlugin from '../main';
import { renderSettings } from './settings-tab';

class ManagedModal extends Modal {
  constructor(app: App, protected plugin: MarginLinkPlugin) { super(app); plugin.dialogs.add(this); }
  onClose(): void { this.plugin.dialogs.delete(this); this.contentEl.empty(); }
}
export class ConfirmAction extends ManagedModal {
  constructor(app: App, plugin: MarginLinkPlugin, private title: string, private description: string, private action: () => void) { super(app, plugin); }
  onOpen(): void {
    this.contentEl.addClass('margin-link-confirm'); this.setTitle(this.title);
    this.contentEl.createEl('p', { text: this.description });
    new Setting(this.contentEl).addButton(b => b.setButtonText('取消').onClick(() => this.close()))
      .addButton(b => b.setButtonText('确认').setCta().onClick(() => { this.action(); this.close(); }));
  }
}
class FullControls extends ManagedModal {
  private dispose?: () => void;
  onOpen(): void { this.modalEl.addClass('margin-link-full-controls'); this.dispose = renderSettings(this.contentEl, this.plugin); }
  onClose(): void { this.dispose?.(); super.onClose(); }
}
export class QuickControls extends ManagedModal {
  private dispose?: () => void;
  onOpen(): void {
    this.setTitle('MarginLink 快捷控制'); this.contentEl.addClass('margin-link-quick-controls');
    const refresh: (() => void)[] = [];
    new Setting(this.contentEl).setName('显示边缘卡片').addToggle(t => {
      t.setValue(this.plugin.preferences.enabled).onChange(v => { this.plugin.preferences.enabled = v; void this.plugin.savePreferences(); });
      refresh.push(() => t.setValue(this.plugin.preferences.enabled));
    });
    new Setting(this.contentEl).setName('连线始终显示').addToggle(t => {
      t.setValue(this.plugin.preferences.lines === 'always').onChange(v => { this.plugin.preferences.lines = v ? 'always' : 'hover'; void this.plugin.savePreferences(); });
      refresh.push(() => t.setValue(this.plugin.preferences.lines === 'always'));
    });
    new Setting(this.contentEl).setName('布局模式').addDropdown(d => {
      d.addOptions({ auto: '自动排列', free: '自由拖动', snap: '智能吸附' }).setValue(this.plugin.preferences.placementMode).onChange(v => { Object.assign(this.plugin.preferences, { placementMode: v }); void this.plugin.savePreferences(); });
      refresh.push(() => d.setValue(this.plugin.preferences.placementMode));
    });
    new Setting(this.contentEl).setName('卡片形状').addDropdown(d => {
      d.addOptions({ horizontal: '横向卡片', square: '正方形', icon: '极简图标' }).setValue(this.plugin.preferences.cardShape).onChange(v => { Object.assign(this.plugin.preferences, { cardShape: v }); void this.plugin.savePreferences(); });
      refresh.push(() => d.setValue(this.plugin.preferences.cardShape));
    });
    const source = this.plugin.activeSource();
    new Setting(this.contentEl).setName('整理当前笔记').addButton(b => b.setButtonText('恢复自动位置').setDisabled(!source).onClick(() => { if (source) this.plugin.confirmReset(source); }));
    new Setting(this.contentEl).setName('完整设置').setDesc('与 Obsidian 原生 MarginLink 设置页共用全部选项；也可在设置 → MarginLink 打开。').addButton(b => b.setButtonText('打开完整设置').onClick(() => { this.close(); new FullControls(this.app, this.plugin).open(); }));
    this.dispose = this.plugin.subscribe(() => refresh.forEach(fn => fn()));
  }
  onClose(): void { this.dispose?.(); super.onClose(); }
}
