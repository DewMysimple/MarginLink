import { Setting, type DropdownComponent } from 'obsidian';
import type MarginLinkPlugin from '../main';

export function renderFolderSettings(container: HTMLElement, plugin: MarginLinkPlugin): () => void {
  const dropdowns: DropdownComponent[] = [];
  for (let i = 0; i < 3; i++) {
    new Setting(container).setName(`预设位置 ${i + 1}`).addDropdown(d => {
      dropdowns.push(d);
      d.onChange(value => {
        plugin.preferences.newNoteFolders = plugin.preferences.newNoteFolders.map((old, index) => index === i ? value : old);
        void plugin.savePreferences();
      });
    });
  }
  const defaultRow = new Setting(container).setName('默认存放位置');
  let defaultControl: DropdownComponent;
  defaultRow.addDropdown(d => {
    defaultControl = d;
    d.onChange(value => { plugin.preferences.newNoteDefault = Number(value); void plugin.savePreferences(); });
  });
  const refresh = () => {
    const saved = plugin.preferences.newNoteFolders;
    const paths = plugin.app.vault.getAllFolders(false).map(f => f.path).sort((a, b) => a.localeCompare(b));
    dropdowns.forEach((d, i) => {
      d.selectEl.empty();
      d.addOption('', '未配置').addOption('/', '仓库根目录');
      for (const path of paths) d.addOption(path, path);
      if (saved[i] && saved[i] !== '/' && !paths.includes(saved[i])) d.addOption(saved[i], saved[i] + '（位置已失效）');
      d.setValue(saved[i]);
    });
    defaultControl.selectEl.empty();
    saved.forEach((path, i) => defaultControl.addOption(String(i), `位置 ${i + 1} · ${path === '/' ? '仓库根目录' : path || '未配置'}`));
    defaultControl.setValue(String(plugin.preferences.newNoteDefault));
    defaultRow.setDesc('默认位置未配置时使用首个已配置位置；全部未配置时使用仓库根目录。');
  };
  refresh();
  return refresh;
}
