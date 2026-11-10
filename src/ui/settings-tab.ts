import { PluginSettingTab, Setting, setIcon, type App } from 'obsidian';
import type MarginLinkPlugin from '../main';
import { DEFAULT_PREFERENCES, type Preferences } from '../types';
import { connectorPath } from '../view/connector-renderer';
import { applyAppearance } from '../view/appearance';
import { dimensions, type LayoutInput } from '../view/layout-engine';
import { ConfirmAction } from './quick-controls';

export function renderSettings(container: HTMLElement, plugin: MarginLinkPlugin): () => void {
  container.empty(); container.addClass('margin-link-settings');
  container.createEl('h2', { text: 'MarginLink · 空间布局与外观' });
  container.createEl('p', { text: '关联始终来自原生双链。拖动只保存可清除的界面位置；删除插件数据只会恢复默认外观与自动排布。' });
  const sync: (() => void)[] = [];
  const update = (key: keyof Preferences, value: unknown) => { Object.assign(plugin.preferences, { [key]: value }); void plugin.savePreferences(); };
  const dropdown = (key: keyof Preferences, name: string, options: Record<string, string>) => {
    const setting = new Setting(container).setName(name); setting.settingEl.dataset.marginKey = key;
    setting.addDropdown(d => { d.addOptions(options).setValue(String(plugin.preferences[key])).onChange(v => update(key, v)); sync.push(() => d.setValue(String(plugin.preferences[key]))); });
  };
  const toggle = (key: keyof Preferences, name: string) => {
    const setting = new Setting(container).setName(name); setting.settingEl.dataset.marginKey = key;
    setting.addToggle(t => { t.setValue(plugin.preferences[key] as boolean).onChange(v => update(key, v)); sync.push(() => t.setValue(plugin.preferences[key] as boolean)); });
  };
  const slider = (key: keyof Preferences, name: string, min: number, max: number, step: number) => {
    const setting = new Setting(container).setName(name); setting.settingEl.dataset.marginKey = key;
    setting.addSlider(s => { s.setLimits(min, max, step).setValue(plugin.preferences[key] as number).setDynamicTooltip().onChange(v => update(key, v)); sync.push(() => s.setValue(plugin.preferences[key] as number)); });
  };
  const preview = container.createDiv({ cls: 'margin-link-settings-preview', attr: { 'aria-label': '实时外观预览，不修改笔记' } });
  const refreshPreview = () => {
    preview.empty(); const p = plugin.preferences; applyAppearance(preview, p);
    preview.createSpan({ cls: 'margin-link-preview-anchor', text: '原生双链' });
    const input: LayoutInput = { width: 400, height: 150, body: { left: 0, right: 180, top: 0, bottom: 150 }, viewport: { left: 0, right: 400, top: 0, bottom: 150 }, anchors: [], density: p.density, layout: p.layout, preferences: p };
    const dim = dimensions(input, 'right')!;
    const placement = { key: 'preview', side: 'right' as const, x: 192, y: (150 - dim.height) / 2, ...dim, compact: dim.shape === 'icon' };
    const shell = preview.createDiv({ cls: 'margin-link-card-shell' }); shell.dataset.shape = dim.shape;
    Object.assign(shell.style, { width: `${dim.width}px`, height: `${dim.height}px`, transform: `translate(${placement.x}px, ${placement.y}px)` });
    const card = shell.createEl('button', { cls: 'margin-link-card', attr: { type: 'button', 'aria-label': '示例文件卡片，仅预览' } });
    card.classList.toggle('margin-link-compact', placement.compact);
    setIcon(card.createSpan({ cls: 'margin-link-card-icon' }), 'file-text');
    const label = card.createSpan({ cls: 'margin-link-card-text' }); label.createSpan({ cls: 'margin-link-card-label', text: '示例笔记' }); label.createSpan({ cls: 'margin-link-card-path', text: 'Notes/示例笔记.md' });
    const svg = preview.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('margin-link-connectors'); svg.setAttribute('viewBox', '0 0 400 150');
    const path = preview.ownerDocument.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('class', 'margin-link-connector margin-link-active'); path.setAttribute('d', connectorPath(115, 75, placement, p.lineStyle)); svg.appendChild(path); preview.prepend(svg);
  };
  const heading = (text: string) => container.createEl('h3', { text });
  heading('基础'); toggle('enabled', '启用边缘关联（打开笔记自动显示）');
  new Setting(container).setName('恢复默认外观设置').setDesc('不删除已保存的位置；清除位置请使用布局分组。').addButton(b => b.setButtonText('恢复默认').onClick(() => new ConfirmAction(plugin.app, plugin, '恢复默认外观', '只恢复显示偏好，布局记录和原生双链均保留。', () => { plugin.preferences = { ...DEFAULT_PREFERENCES }; void plugin.savePreferences(); }).open()));
  heading('连线'); dropdown('lines', '连线显示', { none: '隐藏连线，保留卡片', hover: '悬停或聚焦时显示', always: '始终显示' });
  dropdown('lineStyle', '线型', { curve: '平滑曲线', straight: '直线', elbow: '直角折线' });
  slider('lineWidth', '线条粗细（px）', 1, 5, 0.5); slider('lineOpacity', '常驻透明度（0.1–1）', 0.1, 1, 0.05);
  dropdown('lineColor', '连线颜色', { theme: '主题强调色', purple: '紫色', blue: '蓝色', green: '绿色', gray: '灰色' });
  heading('布局'); dropdown('placementMode', '卡片布局模式', { auto: '自动排列', free: '自由拖动', snap: '智能吸附' });
  dropdown('layout', '左右优先', { balanced: '自动平衡', left: '优先左侧', right: '优先右侧' });
  slider('edgePadding', '正文边缘留白（px）', 8, 32, 2); slider('snapGrid', '吸附栅格与对齐范围（px）', 4, 32, 2);
  const source = plugin.activeSource();
  new Setting(container).setName('一键整理 / 清除当前笔记布局').setDesc('恢复当前笔记的自动位置，不影响其他笔记。').addButton(b => b.setButtonText('整理当前笔记').setDisabled(!source).onClick(() => { if (source) plugin.confirmReset(source); }));
  new Setting(container).setName('清除所有布局').setDesc('保留外观偏好及全部双链。重命名或删除 Vault 文件时，首版也会安全失效全部自定义位置。').addButton(b => b.setButtonText('清除全部').onClick(() => plugin.confirmReset()));
  heading('卡片'); dropdown('cardShape', '卡片形状', { horizontal: '横向卡片', square: '正方形卡片', icon: '极简图标' });
  dropdown('cardSize', '卡片尺寸', { small: '小', medium: '中', large: '大' });
  dropdown('density', '窄边距策略（兼容旧设置）', { auto: '按可用空间自动调整', compact: '始终紧凑图标' });
  slider('cardRadius', '卡片圆角（px）', 0, 20, 1); toggle('cardBorder', '显示卡片边框');
  dropdown('cardShadow', '阴影强度', { none: '无阴影', subtle: '轻微', strong: '明显' }); toggle('showPath', '在横向卡片显示路径');
  heading('交互与辅助功能'); toggle('hoverFeedback', '悬停与焦点高亮反馈'); toggle('dragHints', '显示拖动提示与边界'); toggle('reduceMotion', '减少动画');
  container.createEl('p', { text: '自由/吸附模式：拖动卡片右上角握柄。握柄可用方向键移动、Shift+左右键换侧、Delete 恢复自动位置；右键卡片也可恢复。Esc/失焦/滚动取消拖动。系统减少动画偏好始终优先。' });
  refreshPreview();
  return plugin.subscribe(() => { sync.forEach(s => s()); refreshPreview(); });
}
export class MarginLinkSettings extends PluginSettingTab {
  private dispose?: () => void;
  constructor(app: App, private plugin: MarginLinkPlugin) { super(app, plugin); }
  display(): void { this.dispose?.(); this.dispose = renderSettings(this.containerEl, this.plugin); }
  hide(): void { this.dispose?.(); this.dispose = undefined; }
}
