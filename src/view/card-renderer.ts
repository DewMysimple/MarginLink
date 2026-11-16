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
  extension = extension?.toLowerCase();
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
    const svg = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('focusable', 'false');
    // A local, theme-coloured browser swirl. The two overlapping lobes retain
    // their depth in grayscale; the small wordmark stays outside the artwork.
    for (const [d, opacity] of [
      ['M3.1 14.8C.9 10.3 3 5.1 7.4 3.1a10 10 0 0 1 11.4 2.2c2.4 2.4 3.1 5.7 2 8.4-1.1-3.7-4.7-6.1-8.5-6.1-5 0-8.1 3.1-9.2 7.2Z', '.55'],
      ['M21.7 14.7c-.8 3.5-4.2 6.1-8.1 6.1-4.5 0-8.1-2.9-8.1-6.5 0-2.9 2.7-5.2 5.9-5.2 2.3 0 4.2 1.4 4.2 3.2 0 1.2-.8 2.2-2 2.6 1 .5 2.2.7 3.4.6 1.8-.1 3.4-.4 4.7-.8Z', '1']
    ]) {
      const path = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d); path.setAttribute('fill', 'currentColor'); path.setAttribute('opacity', opacity);
      svg.appendChild(path);
    }
    icon.appendChild(svg);
    icon.createSpan({ cls: 'margin-link-html-label', text: 'HTML' });
  } else {
    setIcon(icon, resolved.file ? fileIcon(extension) : 'file-question');
  }
  icon.setAttribute('aria-hidden', 'true');
  const text = button.createSpan({ cls: 'margin-link-card-text' });
  text.createSpan({ cls: 'margin-link-card-label', text: occurrence.label });
  // Preserve the existing surface alias and optional path independently of hover.
  text.createSpan({ cls: 'margin-link-card-path', text: !resolved.file ? '未解析 · ' + path : path });
}
