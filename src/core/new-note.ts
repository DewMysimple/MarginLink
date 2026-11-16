import type { Preferences } from '../types';
import { formatWikilink } from './link-formatter';

export type NewNotePreferences = Pick<Preferences, 'newNoteFolders' | 'newNoteDefault'>;

export function defaultNoteFolder(prefs: NewNotePreferences): string {
  return prefs.newNoteFolders[prefs.newNoteDefault] || prefs.newNoteFolders.find(Boolean) || '/';
}

export function newNotePath(folder: string, input: string, alias: string): string {
  const stem = input.trim().replace(/\.md$/i, '');
  if (!stem || /[\\/:*?"<>|]/.test(stem) || /[. ]$/.test(stem) || /^\./.test(stem)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) {
    throw new Error('请输入有效文件名，文件夹请从存放位置选择。');
  }
  if (folder !== '/' && (!folder || folder.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('请选择当前仓库中的文件夹。');
  }
  const path = (folder === '/' ? '' : folder + '/') + stem + '.md';
  formatWikilink(path, alias);
  return path;
}
