import type { TFile, Vault } from 'obsidian';
import type { Box } from '../types';

const MAX_BYTES = 256 * 1024;
const MAX_CHARS = 700;
const CAPACITY = 24;
const TTL = 60_000;
interface CachedSummary { file: TFile; stamp: number; size: number; expires: number; text: string }
export class PreviewSummaries {
  private entries = new Map<string, CachedSummary>();
  constructor(private vault: Pick<Vault, 'cachedRead' | 'getFileByPath'>) {}
  async read(file: TFile | null, current: () => boolean): Promise<string> {
    if (!file) return '未找到目标文件。';
    if (!['md', 'markdown'].includes(file.extension.toLowerCase())) return '附件仅显示文件信息。';
    const { path, stat: { size, mtime } } = file;
    if (size > MAX_BYTES) return '文件超过 256 KiB，仅显示文件信息。';
    const entry = this.entries.get(path);
    if (entry?.file === file && entry.stamp === mtime && entry.size === size && entry.expires > Date.now()) {
      this.entries.delete(path); this.entries.set(path, entry);
      return entry.text;
    }
    try {
      const source = await this.vault.cachedRead(file);
      if (!current() || this.vault.getFileByPath(path) !== file || file.stat.mtime !== mtime || file.stat.size !== size) return '文件已变化，请重新预览。';
      const chars = Array.from(source.slice(0, MAX_CHARS * 2 + 2));
      const text = (chars.length > MAX_CHARS ? chars.slice(0, MAX_CHARS - 1).join('') + '…' : chars.join('')).trim() || '这篇笔记是空的。';
      this.entries.set(path, { file, size, stamp: mtime, expires: Date.now() + TTL, text });
      if (this.entries.size > CAPACITY) this.entries.delete(this.entries.keys().next().value!);
      return text;
    } catch { return '暂时无法读取此文件。'; }
  }
  invalidate(path?: string): void {
    if (!path) { this.entries.clear(); return; }
    for (const key of this.entries.keys()) if (key === path || key.startsWith(path + '/')) this.entries.delete(key);
  }
}

export interface PreviewTarget {
  file: TFile | null;
  label: string;
  space: Box;
  valid: () => boolean;
  open: (event: MouseEvent) => void;
}
// Find the nearest free vertical interval in the card's lane. Other cards
// and the editor remain clickable; the available interval limits the excerpt.
export function previewSpace(lane: Box, card: Box, occupied: readonly Box[]): Box {
  const width = Math.min(280, lane.right - lane.left);
  let left = Math.max(lane.left, Math.min(card.left, lane.right - width));
  if (card.left - 4 - width >= lane.left) left = card.left - 4 - width;
  else if (card.right + 4 + width <= lane.right) left = card.right + 4;
  const blocks = occupied.filter(b => b.right >= left && b.left <= left + width && b.bottom > lane.top && b.top < lane.bottom)
    .sort((a, b) => a.top - b.top);
  const gaps: Box[] = [];
  let top = lane.top;
  for (const box of blocks) {
    if (box.top - 4 > top) gaps.push({ left, right: left + width, top, bottom: box.top - 4 });
    top = Math.max(top, box.bottom + 4);
  }
  if (lane.bottom > top) gaps.push({ left, right: left + width, top, bottom: lane.bottom });
  const rank = (g: Box) => Math.max(card.top - g.bottom, g.top - card.bottom, 0);
  const ordered = gaps.sort((a, b) => rank(a) - rank(b));
  const gap = ordered.find(g => g.bottom - g.top >= 100) ?? ordered.find(g => g.bottom - g.top >= 26);
  if (!gap) return { left, right: left + width, top: card.bottom, bottom: card.bottom };
  const height = Math.min(210, gap.bottom - gap.top);
  top = Math.max(gap.top, Math.min(card.top, gap.bottom - height));
  return { left, right: left + width, top, bottom: top + height };
}

interface Session {
  owner: HTMLButtonElement;
  path?: string;
  panel?: HTMLDivElement;
  delay?: number;
  leave?: number;
}
let nextId = 0;
export class TargetPreview {
  private session?: Session;
  private win: Window;
  private summaries: PreviewSummaries;
  constructor(private root: HTMLElement, vault: Pick<Vault, 'cachedRead' | 'getFileByPath'>) {
    this.win = root.ownerDocument.defaultView!;
    this.summaries = new PreviewSummaries(vault);
  }
  request(owner: HTMLButtonElement, target: () => PreviewTarget | undefined, keyboard = false): void {
    if (!keyboard && this.session?.owner === owner) { this.win.clearTimeout(this.session.leave); return; }
    this.close();
    const session: Session = { owner };
    this.session = session;
    const show = () => {
      const info = target();
      if (!info || !owner.isConnected || !info.valid()) { this.close(); return; }
      session.path = info.file?.path;
      const { left, top, right, bottom } = info.space;
      if (bottom - top < 26) {
        owner.dataset.previewHint = info.label;
        return;
      }
      const compact = bottom - top < 100 || right - left < 112;
      const panel = this.root.createDiv({ cls: 'margin-link-target-preview', attr: { role: 'region', 'aria-label': '目标预览' } });
      session.panel = panel;
      Object.assign(panel.style, { left: left + 'px', top: top + 'px', width: (right - left) + 'px', maxHeight: (bottom - top) + 'px' });
      panel.id = 'margin-link-preview-' + ++nextId;
      owner.setAttribute('aria-controls', panel.id);
      panel.tabIndex = -1;
      panel.createEl('strong', { text: compact && !info.file ? info.label + ' · 未找到' : info.label });
      if (compact) panel.classList.add('margin-link-preview-compact');
      const text = compact ? undefined : panel.createEl('p', { text: '正在读取…', attr: { 'aria-live': 'polite' } });
      if (!compact && info.file) {
        const button = panel.createEl('button', { text: '打开文件', attr: { type: 'button' } });
        button.addEventListener('click', event => { if (info.valid()) info.open(event); this.close(); });
      }
      panel.addEventListener('pointerenter', () => this.win.clearTimeout(session.leave));
      panel.addEventListener('pointerleave', () => this.leave(owner));
      panel.addEventListener('focusout', event => {
        if (!panel.contains(event.relatedTarget as Node) && event.relatedTarget !== owner) this.close();
      });
      if (keyboard) panel.focus({ preventScroll: true });
      const current = () => this.session === session && owner.isConnected && info.valid();
      if (text) void this.summaries.read(info.file, current).then(value => { if (current()) text.textContent = value; });
    };
    this.root.ownerDocument.addEventListener('pointerdown', this.outside, true);
    this.root.ownerDocument.addEventListener('keydown', this.escape, true);
    this.win.addEventListener('blur', this.dismiss);
    this.win.addEventListener('resize', this.dismiss);
    if (keyboard) show(); else session.delay = this.win.setTimeout(show, 500);
  }
  private dismiss = (): void => this.close();
  private escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (this.session?.owner.matches(':hover') || this.session?.panel?.matches(':hover'))) this.close(true);
  };
  private outside = (event: PointerEvent): void => {
    const s = this.session;
    if (s && !s.owner.contains(event.target as Node) && !s.panel?.contains(event.target as Node)) this.close();
  };
  blurOwner(owner: HTMLElement, next: EventTarget | null): void {
    if (this.session?.owner === owner && !this.session.panel?.contains(next as Node)) this.close();
  }
  leave(owner: HTMLElement): void {
    const s = this.session;
    if (s?.owner !== owner) return;
    if (!s.panel) { this.close(); return; }
    if (s.panel.contains(this.root.ownerDocument.activeElement)) return;
    this.win.clearTimeout(s.leave);
    s.leave = this.win.setTimeout(() => this.close(), 220);
  }
  closeOwner(owner: HTMLElement): void { if (this.session?.owner === owner) this.close(); }
  invalidate(path?: string): void {
    this.summaries.invalidate(path);
    const s = this.session;
    if (s && (!path || s.path === path || s.path?.startsWith(path + '/'))) this.close();
  }
  close(restore = false): void {
    const s = this.session;
    if (!s) return;
    this.session = undefined;
    this.win.clearTimeout(s.delay); this.win.clearTimeout(s.leave);
    const returnFocus = restore && s.panel?.contains(this.root.ownerDocument.activeElement);
    this.root.ownerDocument.removeEventListener('pointerdown', this.outside, true);
    this.root.ownerDocument.removeEventListener('keydown', this.escape, true);
    this.win.removeEventListener('blur', this.dismiss);
    this.win.removeEventListener('resize', this.dismiss);
    s.panel?.remove(); s.owner.removeAttribute('aria-controls'); delete s.owner.dataset.previewHint;
    if (returnFocus && s.owner.isConnected) s.owner.focus({ preventScroll: true });
  }
}
