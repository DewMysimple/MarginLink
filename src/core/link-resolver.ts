import { parseLinktext, type App, type TFile } from 'obsidian';
import type { ResolvedLink } from '../types';
export function resolveLink(app: App, target: string, sourcePath: string): ResolvedLink {
  const { path, subpath } = parseLinktext(target);
  const file = path ? app.metadataCache.getFirstLinkpathDest(path, sourcePath)
    : app.vault.getFileByPath(sourcePath);
  return { file, subpath, target };
}
export function exactTarget(app: App, file: TFile, sourcePath: string): string {
  // Vault-root paths, including .md, remain unambiguous even when basenames repeat.
  const candidates = [file.path, '/' + file.path, app.metadataCache.fileToLinktext(file, sourcePath, false)];
  for (const path of candidates) if (app.metadataCache.getFirstLinkpathDest(path, sourcePath)?.path === file.path) return path;
  throw new Error('原生链接解析器无法唯一定位所选文件，未修改笔记。');
}
