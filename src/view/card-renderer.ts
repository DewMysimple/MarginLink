import { setIcon } from 'obsidian';
import type { ResolvedLink, WikilinkOccurrence } from '../types';
export function fileIcon(extension?: string): string {
  if (!extension || extension === 'md') return 'file-text';
  if (['canvas', 'base'].includes(extension)) return 'layout-dashboard';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'file-type-2';
  if (['html', 'htm'].includes(extension)) return 'file-code';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(extension)) return 'music';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(extension)) return 'film';
  return 'file';
}
export function renderCard(button: HTMLButtonElement, occurrence: WikilinkOccurrence, resolved: ResolvedLink): void {
  const path = resolved.file?.path ?? occurrence.target;
  const title = `${occurrence.label}\n${path}${resolved.file ? resolved.subpath : ''}\n${resolved.file ? '已被原生 Vault 识别 · 点击打开；特殊格式需要类型插件' : '未解析 · 原生 Vault/链接解析器未找到目标'}`;
  button.type = 'button';
  button.className = 'margin-link-card';
  button.classList.toggle('margin-link-unresolved', !resolved.file);
  button.title = title;
  button.setAttribute('aria-label', title.replaceAll('\n', '，'));
  const icon = button.createSpan({ cls: 'margin-link-card-icon' });
  setIcon(icon, resolved.file ? fileIcon(resolved.file.extension) : 'file-question');
  const text = button.createSpan({ cls: 'margin-link-card-text' });
  text.createSpan({ cls: 'margin-link-card-label', text: occurrence.label });
  // A path is always available visually in full cards, and in the tooltip for icons.
  text.createSpan({ cls: 'margin-link-card-path', text: !resolved.file ? '未解析 · ' + path : path });
}
