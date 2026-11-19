import { Menu, type MarkdownView } from 'obsidian';
import type { WikilinkOccurrence } from '../types';
import { groupOccurrences, type ActiveGrouping, type GroupIndex } from './card-groups';
import { resolveLink } from '../core/link-resolver';

// The view header stays available even when the last group is folded.
// Obsidian's native menu handles focus, keyboard selection and Escape.
export class GroupControls {
  private action: HTMLElement;
  private menu?: Menu;
  private folded = new Set<string>();
  private index?: GroupIndex;
  private links?: readonly WikilinkOccurrence[];
  private mode?: ActiveGrouping;
  constructor(private view: MarkdownView, private redraw: () => void) {
    this.action = view.addAction('list-filter', '折叠或展开卡片分组', () => this.open());
    this.action.classList.add('margin-link-group-action');
  }
  snapshot(): string[] { return [...this.folded]; }
  update(mode: ActiveGrouping, links: readonly WikilinkOccurrence[], source: string, initialFolded?: readonly string[]): void {
    if (this.links === links && this.mode === mode && this.index) return;
    if (this.mode !== mode) this.folded = new Set(initialFolded);
    this.links = links; this.mode = mode;
    this.index = groupOccurrences(mode, links, target => resolveLink(this.view.app, target, source).file);
    const present = new Set(this.index.groups.map(group => group.id));
    for (const id of this.folded) if (!present.has(id)) this.folded.delete(id);
  }
  label(key: string): string | undefined { return this.index?.byOccurrence.get(key)?.label; }
  visible(key: string): boolean {
    const group = this.index?.byOccurrence.get(key);
    return !group || !this.folded.has(group.id);
  }
  open(): void {
    if (!this.index?.groups.length) return;
    this.menu?.hide();
    const menu = this.menu = new Menu();
    for (const group of this.index.groups) {
      const folded = this.folded.has(group.id);
      menu.addItem(item => item.setTitle(group.label + ' · ' + group.count).setChecked(!folded).onClick(() => {
        if (folded) this.folded.delete(group.id); else this.folded.add(group.id);
        this.redraw();
      }));
    }
    menu.onHide(() => { if (this.menu === menu) this.menu = undefined; });
    const anchor = this.action.getBoundingClientRect();
    const fallback = this.view.contentEl.getBoundingClientRect();
    menu.showAtPosition({ x: anchor.width ? anchor.left : fallback.right - 24, y: anchor.height ? anchor.bottom : fallback.top + 8 });
  }
  invalidate(): void { this.links = undefined; this.menu?.hide(); }
  destroy(): void { this.menu?.hide(); this.action.remove(); }
}
