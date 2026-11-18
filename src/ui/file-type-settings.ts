import { Setting } from 'obsidian';
import type MarginLinkPlugin from '../main';
import { FILE_TYPES } from '../core/file-recognition';

export function renderFileTypeSettings(container: HTMLElement, plugin: MarginLinkPlugin): () => void {
  container.createEl('h3', { text: 'Obsidian 能识别的文件类型' });
  container.createEl('p', { text: '选择要在原生文件列表中识别的附件。Obsidian 的“显示所有文件类型”和其他已启用的插件也可能显示这些文件。' });
  const refresh: (() => void)[] = [];
  for (const { preference, name, extensions } of FILE_TYPES) {
    const setting = new Setting(container).setName(`${name}（${extensions.map(ext => '.' + ext).join('、')}）`);
    setting.settingEl.dataset.marginKey = preference;
    setting.addToggle(toggle => {
      toggle.onChange(enabled => {
        if (plugin.preferences[preference] === enabled) return;
        plugin.preferences[preference] = enabled;
        void plugin.savePreferences();
      });
      const sync = () => {
        const enabled = plugin.preferences[preference];
        toggle.setValue(enabled);
        const labels = { disabled: '未启用', registered: '已启用', occupied: '由现有处理程序负责', failed: '注册失败' };
        const statuses = extensions.map(extension => plugin.fileRecognition.status(extension));
        const pending = statuses.some(applied => (applied !== 'disabled') !== enabled);
        const applied = extensions.map((extension, index) => `.${extension} ${labels[statuses[index]]}`).join('，');
        setting.setDesc(pending ? `${applied}。请在第三方插件中关闭再启用 MarginLink，以应用更改。` : applied);
      };
      refresh.push(sync);
      sync();
    });
  }
  return () => refresh.forEach(sync => sync());
}
