import type { HeadingCache } from 'obsidian';
import type { Box, WikilinkOccurrence } from '../types';
import { buildReferenceListItems, type ReferenceGroup } from './reference-groups';

export class ReferenceList {
  private panel?: HTMLDivElement;
  owner?: HTMLButtonElement;
  constructor(private root: HTMLElement) {}
  private escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
  };
  private outside = (event: PointerEvent): void => {
    if (!this.panel?.contains(event.target as Node) && !this.owner?.contains(event.target as Node)) this.close();
  };
  close(restore = false): void {
    if (restore && this.panel?.contains(this.panel.ownerDocument.activeElement)) this.owner?.focus({ preventScroll: true });
    this.panel?.ownerDocument.removeEventListener('keydown', this.escape, true);
    this.panel?.ownerDocument.removeEventListener('pointerdown', this.outside, true);
    this.panel?.remove(); this.panel = undefined;
    this.owner?.setAttribute('aria-expanded', 'false'); this.owner = undefined;
  }
  position(host?: DOMRect, viewport?: Box): void {
    const panel = this.panel, owner = this.owner;
    if (!panel || !owner || !host || !viewport) return;
    const rect = owner.getBoundingClientRect();
    if (rect.bottom <= host.top + viewport.top || rect.top >= host.top + viewport.bottom) {
      this.close(); return;
    }
    panel.style.maxWidth = Math.max(0, viewport.right - viewport.left) + 'px';
    panel.style.maxHeight = Math.max(0, viewport.bottom - viewport.top) + 'px';
    panel.style.left = Math.max(viewport.left, Math.min(rect.left - host.left, viewport.right - panel.offsetWidth)) + 'px';
    panel.style.top = Math.max(viewport.top, Math.min(rect.bottom - host.top, viewport.bottom - panel.offsetHeight)) + 'px';
  }
  open(owner: HTMLButtonElement, group: ReferenceGroup, source: string, headings: HeadingCache[] | undefined,
    valid: () => boolean, locate: (o: WikilinkOccurrence, line: number) => void,
    relink: (o: WikilinkOccurrence) => void, unlink: (o: WikilinkOccurrence) => void): void {
    const panel = this.panel = this.root.createDiv({ cls: 'margin-link-reference-list', attr: { role: 'group', 'aria-label': '源笔记引用列表' } });
    this.owner = owner; owner.setAttribute('aria-expanded', 'true');
    panel.addEventListener('mousedown', event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); });
    for (const { occurrence, label, line, subpath } of buildReferenceListItems(group, source)) {
      const row = panel.createDiv();
      row.createEl('strong', { text: label });
      const heading = headings?.filter(h => h.position.start.line < line && source.slice(h.position.start.offset, h.position.end.offset).includes(h.heading)).at(-1);
      row.createDiv({ text: (heading ? heading.heading + ' · ' : '') + '原文第 ' + line + ' 行' + (subpath ? ' · 目标 ' + subpath : '') });
      row.createEl('button', { text: '定位原文' }).onclick = () => {
        if (valid()) { this.close(true); locate(occurrence, line); }
      };
      row.createEl('button', { text: '重新链接此处引用' }).onclick = () => {
        if (valid()) { this.close(); relink(occurrence); }
      };
      row.createEl('button', { text: '取消此处链接' }).onclick = () => {
        if (valid()) { this.close(); unlink(occurrence); }
      };
    }
    panel.ownerDocument.addEventListener('keydown', this.escape, true);
    panel.ownerDocument.addEventListener('pointerdown', this.outside, true);
    if (owner === owner.ownerDocument.activeElement) panel.querySelector('button')?.focus({ preventScroll: true });
  }
}
