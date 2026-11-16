import { PluginSettingTab, Setting, setIcon, type App } from 'obsidian';
import type MarginLinkPlugin from '../main';
import { DEFAULT_PREFERENCES, LINE_MODE_OPTIONS, PLACEMENT_MODE_OPTIONS, type PlacementMode, type Preferences } from '../types';
import { connectorRoute } from '../view/connector-renderer';
import { applyAppearance } from '../view/appearance';
import { dimensions, type LayoutInput } from '../view/layout-engine';
import { renderFileTypeSettings } from './file-type-settings';
import { ConfirmAction } from './quick-controls';
import { renderFolderSettings } from './new-note-folders';

export function renderSettings(container: HTMLElement, plugin: MarginLinkPlugin): () => void {
  container.empty(); container.addClass('margin-link-settings');
  container.createEl('h2', { text: 'MarginLink' });
  container.createEl('p', { text: '关联保存在笔记的原生双链中。卡片位置、文件类型和新建目录保存在插件设置中。' });
  const sync: (() => void)[] = [renderFileTypeSettings(container, plugin)];
  const update = (key: keyof Preferences, value: unknown) => {
    if (key === 'placementMode') { void plugin.setPlacementMode(value as PlacementMode); return; }
    Object.assign(plugin.preferences, { [key]: value }); void plugin.savePreferences();
  };
  const dropdown = (key: keyof Preferences, name: string, options: Record<string, string>, disabled?: () => boolean) => {
    const setting = new Setting(container).setName(name); setting.settingEl.dataset.marginKey = key;
    setting.addDropdown(d => {
      d.addOptions(options).onChange(v => update(key, v));
      const refresh = () => d.setValue(String(plugin.preferences[key])).setDisabled(disabled?.() ?? false);
      sync.push(refresh); refresh();
    });
    return setting;
  };
  const toggle = (key: keyof Preferences, name: string) => {
    const setting = new Setting(container).setName(name); setting.settingEl.dataset.marginKey = key;
    setting.addToggle(t => { t.setValue(plugin.preferences[key] as boolean).onChange(v => update(key, v)); sync.push(() => t.setValue(plugin.preferences[key] as boolean)); });
  };
  const slider = (key: keyof Preferences, name: string, min: number, max: number, step: number, disabled?: () => boolean) => {
    const setting = new Setting(container).setName(name); setting.settingEl.dataset.marginKey = key;
    setting.addSlider(s => {
      s.setLimits(min, max, step).setDynamicTooltip().onChange(v => update(key, v));
      const refresh = () => s.setValue(plugin.preferences[key] as number).setDisabled(disabled?.() ?? false);
      sync.push(refresh); refresh();
    });
    return setting;
  };
  const preview = container.createDiv({ cls: 'margin-link-settings-preview', attr: { 'aria-label': '实时外观预览，不修改笔记' } });
  const refreshPreview = () => {
    preview.empty(); const p = plugin.preferences; applyAppearance(preview, p);
    const anchor = preview.createSpan({ cls: 'margin-link-preview-anchor', text: '原生双链' });
    const input: LayoutInput = { width: 400, height: 150, body: { left: 0, right: 180, top: 0, bottom: 150 }, viewport: { left: 0, right: 400, top: 0, bottom: 150 }, anchors: [], density: p.density, layout: p.layout, preferences: p };
    const dim = dimensions(input, 'right')!;
    const placement = { key: 'preview', side: 'right' as const, x: 192, y: (150 - dim.height) / 2, ...dim, compact: dim.shape === 'icon' };
    const shell = preview.createDiv({ cls: 'margin-link-card-shell' }); shell.dataset.shape = dim.shape;
    Object.assign(shell.style, { width: `${dim.width}px`, height: `${dim.height}px`, transform: `translate(${placement.x}px, ${placement.y}px)` });
    const card = shell.createEl('button', { cls: 'margin-link-card', attr: { type: 'button', 'aria-label': '示例文件卡片，仅预览' } });
    card.classList.toggle('margin-link-compact', placement.compact);
    setIcon(card.createSpan({ cls: 'margin-link-card-icon' }), 'file-text');
    const label = card.createSpan({ cls: 'margin-link-card-text' }); label.createSpan({ cls: 'margin-link-card-label', text: '示例笔记' }); label.createSpan({ cls: 'margin-link-card-path', text: 'Notes/示例笔记.md' });
    if (p.lines === 'numbers') {
      for (const [left, top] of [[16, 38], [placement.x + 4, placement.y + 4]]) {
        const number = preview.createSpan({ cls: 'margin-link-continuation', text: '1' });
        Object.assign(number.style, { left: `${left}px`, top: `${top}px`, width: '16px', height: '16px' });
      }
      return;
    }
    if (p.lines === 'none') return;
    const svg = preview.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('margin-link-connectors'); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    const bounds = { left: anchor.offsetLeft, right: anchor.offsetLeft + anchor.offsetWidth, top: anchor.offsetTop, bottom: anchor.offsetTop + anchor.offsetHeight };
    const path = preview.ownerDocument.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('class', 'margin-link-connector margin-link-active'); path.setAttribute('d', connectorRoute([bounds], placement, p.lineStyle, undefined, { obstacles: [bounds], body: input.body, lineWidth: p.lineWidth })?.path ?? '');
    svg.appendChild(path); preview.prepend(svg);
  };
  const heading = (text: string) => container.createEl('h3', { text });
  heading('基础'); toggle('enabled', '启用边缘关联（打开笔记自动显示）');
  new Setting(container).setName('恢复默认外观设置').setDesc('只恢复外观，保留布局模式、卡片位置、文件识别和新建目录设置。')
    .addButton(b => b.setButtonText('恢复默认').onClick(() => new ConfirmAction(plugin.app, plugin, '恢复默认外观', '恢复默认外观，保留当前布局模式、卡片位置与文件设置。', () => {
      const { placementMode, layout, snapGrid, recognizeHtml, recognizeXmind, newNoteFolders, newNoteDefault } = plugin.preferences;
      plugin.preferences = { ...DEFAULT_PREFERENCES, placementMode, layout, snapGrid, recognizeHtml, recognizeXmind, newNoteFolders, newNoteDefault };
      void plugin.savePreferences();
    }).open()));
  heading('连线'); dropdown('lines', '连线显示', LINE_MODE_OPTIONS);
  dropdown('lineStyle', '线型', { curve: '平滑曲线', straight: '直线', elbow: '直角折线' });
  slider('lineWidth', '线条粗细（px）', 1, 5, 0.5); slider('lineOpacity', '常驻透明度（0.1–1）', 0.1, 1, 0.05);
  dropdown('lineColor', '连线颜色', { theme: '主题强调色', purple: '紫色', blue: '蓝色', green: '绿色', gray: '灰色' });
  heading('布局'); dropdown('placementMode', '卡片布局模式', PLACEMENT_MODE_OPTIONS)
    .setDesc('完全手动不自动平衡或避让；自由拖动和智能吸附只在首次显示时自动初排，随后保留位置。');
  dropdown('layout', '自动排布左右优先', { balanced: '自动平衡', left: '优先左侧', right: '优先右侧' }, () => plugin.preferences.placementMode === 'manual')
    .setDesc('仅影响自动排列和首次自动初排。完全手动时不使用此选项，原选择会保留。');
  slider('edgePadding', '正文边缘留白（px）', 8, 32, 2);
  slider('snapGrid', '吸附栅格间距（px）', 4, 32, 2, () => plugin.preferences.placementMode !== 'snap')
    .setDesc('仅在智能吸附模式使用。');
  const noteReset = new Setting(container).setName('重置当前笔记卡片位置');
  noteReset.addButton(b => {
    b.setButtonText('重置当前位置').onClick(() => { const source = plugin.activeSource(); if (source) plugin.confirmReset(source); });
    const refresh = () => {
      const source = plugin.activeSource(); b.setDisabled(!source);
      const effect = plugin.preferences.placementMode === 'manual' ? '重新设置初始位置，继续保持完全手动模式。' : '清除已保存的位置并重新排列。';
      noteReset.setDesc(source ? `当前笔记：${source}。${effect}不影响其他笔记。` : '请先操作要重置的 Markdown 笔记。');
    };
    sync.push(refresh); refresh();
  });
  new Setting(container).setName('清除所有卡片位置').setDesc('清除全部已保存位置，保留布局模式、外观偏好和全部双链。').addButton(b => b.setButtonText('清除全部位置').onClick(() => plugin.confirmReset()));
  heading('卡片'); dropdown('cardShape', '卡片形状', { horizontal: '横向卡片', square: '正方形卡片', icon: '极简图标' });
  dropdown('cardSize', '卡片尺寸', { small: '小', medium: '中', large: '大' });
  dropdown('density', '窄边距策略（兼容旧设置）', { auto: '按可用空间自动调整', compact: '始终紧凑图标' });
  slider('cardRadius', '卡片圆角（px）', 0, 20, 1); toggle('cardBorder', '显示卡片边框');
  dropdown('cardShadow', '阴影强度', { none: '无阴影', subtle: '轻微', strong: '明显' }); toggle('showPath', '在横向卡片显示路径');
  heading('新建笔记存放位置');
  sync.push(renderFolderSettings(container, plugin));
  heading('交互与辅助功能'); toggle('hoverFeedback', '悬停与焦点高亮反馈'); toggle('dragHints', '显示拖动边界'); toggle('reduceMotion', '减少动画');
  container.createEl('p', { text: '单击卡片打开文件；完全手动、自由拖动或智能吸附模式下，按住卡片任意位置移动即可拖动。聚焦卡片后可用方向键移动、Shift+左右键换侧、Delete 重置此卡片位置；右键卡片也可重置。Esc/失焦/滚动取消拖动。系统减少动画偏好始终优先。' });
  refreshPreview();
  return plugin.subscribe(() => { sync.forEach(s => s()); refreshPreview(); });
}
export class MarginLinkSettings extends PluginSettingTab {
  private dispose?: () => void;
  constructor(app: App, private plugin: MarginLinkPlugin) { super(app, plugin); }
  display(): void { this.dispose?.(); this.dispose = renderSettings(this.containerEl, this.plugin); }
  hide(): void { this.dispose?.(); this.dispose = undefined; }
}
