import { Modal, Setting, type App } from 'obsidian';
import type MarginLinkPlugin from '../main';
import { LINE_MODE_OPTIONS, PLACEMENT_MODE_OPTIONS, type LineMode, type PlacementMode } from '../types';

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
export class QuickControls extends ManagedModal {
  private dispose?: () => void;
  onOpen(): void {
    this.setTitle('MarginLink 快捷控制'); this.contentEl.addClass('margin-link-quick-controls');
    const refresh: (() => void)[] = [];
    new Setting(this.contentEl).setName('显示边缘卡片').addToggle(t => {
      t.setValue(this.plugin.preferences.enabled).onChange(v => { this.plugin.preferences.enabled = v; void this.plugin.savePreferences(); });
      refresh.push(() => t.setValue(this.plugin.preferences.enabled));
    });
    new Setting(this.contentEl).setName('连线显示').addDropdown(d => {
      d.addOptions(LINE_MODE_OPTIONS).setValue(this.plugin.preferences.lines).onChange(v => { this.plugin.preferences.lines = v as LineMode; void this.plugin.savePreferences(); });
      refresh.push(() => d.setValue(this.plugin.preferences.lines));
    });
    new Setting(this.contentEl).setName('布局模式').setDesc('完全手动保留所有卡片位置，不做左右平衡。').addDropdown(d => {
      d.addOptions(PLACEMENT_MODE_OPTIONS).setValue(this.plugin.preferences.placementMode).onChange(v => { void this.plugin.setPlacementMode(v as PlacementMode); });
      refresh.push(() => d.setValue(this.plugin.preferences.placementMode));
    });
    new Setting(this.contentEl).setName('卡片形状').addDropdown(d => {
      d.addOptions({ horizontal: '横向卡片', square: '正方形卡片', icon: '极简图标' }).setValue(this.plugin.preferences.cardShape).onChange(v => { Object.assign(this.plugin.preferences, { cardShape: v }); void this.plugin.savePreferences(); });
      refresh.push(() => d.setValue(this.plugin.preferences.cardShape));
    });
    const noteReset = new Setting(this.contentEl).setName('重置当前笔记卡片位置');
    noteReset.addButton(b => {
      b.setButtonText('重置当前位置').onClick(() => { const source = this.plugin.activeSource(); if (source) this.plugin.confirmReset(source); });
      const sync = () => {
        b.setDisabled(!this.plugin.activeSource());
        noteReset.setDesc(this.plugin.preferences.placementMode === 'manual' ? '重新设置初始位置，继续保持完全手动模式。' : '清除已保存的位置并重新排列。');
      }; refresh.push(sync); sync();
    });
    new Setting(this.contentEl).setName('完整设置').setDesc('在右侧 MarginLink 标签中调整全部选项；也可在设置 → MarginLink 打开。').addButton(b => b.setButtonText('打开完整设置').onClick(() => { this.close(); void this.plugin.openSettingsPanel(); }));
    this.dispose = this.plugin.subscribe(() => refresh.forEach(fn => fn()));
  }
  onClose(): void { this.dispose?.(); super.onClose(); }
}
