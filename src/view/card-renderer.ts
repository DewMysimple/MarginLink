import { setIcon } from 'obsidian';
import type { ResolvedLink, WikilinkOccurrence } from '../types';
let accessibleId = 0;
export function cardFileLabel(occurrence: WikilinkOccurrence, resolved: ResolvedLink): string {
  const name = resolved.file?.name ?? (occurrence.target.split('#')[0].split(/[\\/]/).pop() || '未解析目标');
  const extension = (resolved.file?.extension ?? (/\.([^.]+)$/.exec(name)?.[1] ?? '')).toLowerCase();
  const types: Record<string, string> = { md: 'Markdown 文件', markdown: 'Markdown 文件', html: 'HTML 文件', htm: 'HTML 文件', xmind: 'XMind 文件', canvas: 'Canvas 文件', base: 'Base 文件', pdf: 'PDF 文件',
    png: 'PNG 图片', jpg: 'JPEG 图片', jpeg: 'JPEG 图片', svg: 'SVG 图片', gif: 'GIF 图片', webp: 'WebP 图片', avif: 'AVIF 图片', bmp: 'BMP 图片',
    mp3: 'MP3 音频', wav: 'WAV 音频', ogg: 'OGG 音频', flac: 'FLAC 音频', m4a: 'M4A 音频', mp4: 'MP4 视频', webm: 'WebM 视频', mov: 'MOV 视频', mkv: 'MKV 视频', txt: '文本文件', json: 'JSON 文件', csv: 'CSV 文件' };
  return `${name} · ${types[extension] ?? (resolved.file && extension ? `${extension.toUpperCase()} 文件` : '类型未知')}`;
}
export function fileIcon(extension?: string): string {
  if (!extension || extension === 'md') return 'file-text';
  if (['canvas', 'base'].includes(extension)) return 'layout-dashboard';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(extension)) return 'image';
  if (extension?.toLowerCase() === 'xmind') return 'git-fork';
  if (extension === 'pdf') return 'file-type-2';
  if (['html', 'htm'].includes(extension)) return 'file-code';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(extension)) return 'music';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(extension)) return 'film';
  return 'file';
}
export function renderCard(button: HTMLButtonElement, occurrence: WikilinkOccurrence, resolved: ResolvedLink): void {
  const path = resolved.file?.path ?? occurrence.target;
  button.type = 'button';
  button.className = 'margin-link-card';
  button.classList.toggle('margin-link-unresolved', !resolved.file);
  // Obsidian also turns aria-label into a visible tooltip. Use a labelled text
  // node for the accessible name and one explicitly managed hover mechanism.
  button.removeAttribute('title'); button.removeAttribute('aria-label');
  const label = cardFileLabel(occurrence, resolved);
  button.dataset.tooltip = label;
  const accessible = button.createSpan({ cls: 'margin-link-card-accessible', text: label });
  accessible.id = `margin-link-card-label-${++accessibleId}`;
  button.setAttribute('aria-labelledby', accessible.id);
  const icon = button.createSpan({ cls: 'margin-link-card-icon' });
  const extension = resolved.file?.extension.toLowerCase();
  if (extension === 'html' || extension === 'htm') {
    icon.classList.add('margin-link-html-icon');
    icon.textContent = 'HTML';
  } else {
    setIcon(icon, resolved.file ? fileIcon(extension) : 'file-question');
  }
  icon.setAttribute('aria-hidden', 'true');
  const text = button.createSpan({ cls: 'margin-link-card-text' });
  text.createSpan({ cls: 'margin-link-card-label', text: occurrence.label });
  // Preserve the existing surface alias and optional path independently of hover.
  text.createSpan({ cls: 'margin-link-card-path', text: !resolved.file ? '未解析 · ' + path : path });
}
