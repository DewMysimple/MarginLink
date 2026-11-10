import { PluginSettingTab, Setting, type App } from 'obsidian';
import type MarginLinkPlugin from '../main';
export class MarginLinkSettings extends PluginSettingTab {
  constructor(app: App, private plugin: MarginLinkPlugin) { super(app, plugin); }
  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl('h2', { text: 'MarginLink' });
    this.containerEl.createEl('p', { text: '关联只保存在原生双链中。此处仅保存界面偏好，卡片坐标不会持久化。' });
    const p = this.plugin.preferences;
    new Setting(this.containerEl).setName('启用边缘关联').addToggle(t => t.setValue(p.enabled).onChange(async v => { p.enabled = v; await this.plugin.savePreferences(); }));
    new Setting(this.containerEl).setName('连线显示').addDropdown(d => d.addOptions({ hover: '悬停或聚焦时显示', always: '始终显示' }).setValue(p.lines).onChange(async v => { p.lines = v === 'always' ? 'always' : 'hover'; await this.plugin.savePreferences(); }));
    new Setting(this.containerEl).setName('卡片密度').addDropdown(d => d.addOptions({ auto: '按可用空间自动调整', compact: '紧凑图标' }).setValue(p.density).onChange(async v => { p.density = v === 'compact' ? 'compact' : 'auto'; await this.plugin.savePreferences(); }));
    new Setting(this.containerEl).setName('左右布局').addDropdown(d => d.addOptions({ balanced: '自动平衡', left: '优先左侧', right: '优先右侧' }).setValue(p.layout).onChange(async v => { p.layout = v === 'left' || v === 'right' ? v : 'balanced'; await this.plugin.savePreferences(); }));
  }
}
