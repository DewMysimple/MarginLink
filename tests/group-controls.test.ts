import { expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import { GroupControls } from '../src/view/group-controls';

const items = vi.hoisted(() => new Map<string, { checked: boolean; click: () => void }>());
vi.mock('obsidian', () => ({ parseLinktext: (path: string) => ({ path, subpath: '' }), Menu: class {
  addItem(setup: (item: object) => void) {
    const item = {
      title: '', checked: false,
      setTitle(title: string) { this.title = title; return this; },
      setChecked(checked: boolean) { this.checked = checked; return this; },
      onClick(click: () => void) { items.set(this.title, { checked: this.checked, click }); return this; }
    };
    setup(item);
  }
  onHide(callback: () => void) { this.hide = callback; }
  hide() {}
  showAtPosition() {}
} }));
it('retains leaf-local folds across metadata refresh, clears them on rule change and disposes its header action', () => {
  const action = { classList: { add: vi.fn() }, remove: vi.fn(), getBoundingClientRect: () => ({ left: 0, bottom: 22, width: 22, height: 22 }) };
  const getFirstLinkpathDest = vi.fn(() => ({ path: 'folder/note.md', extension: 'md' }));
  const view = { addAction: () => action, contentEl: action, app: { metadataCache: { getFirstLinkpathDest } } } as unknown as MarkdownView;
  const redraw = vi.fn(), groups = new GroupControls(view, redraw);
  const links = [{ target: 'note', start: 0, end: 8, raw: '[[note]]', label: 'note' }];
  groups.update('folder', links, 'a.md'); groups.update('folder', links, 'a.md');
  expect(getFirstLinkpathDest).toHaveBeenCalledTimes(1);
  groups.open(); expect(items.get('folder/ · 1')?.checked).toBe(true);
  items.get('folder/ · 1')!.click(); expect(redraw).toHaveBeenCalledTimes(1);
  groups.invalidate(); groups.update('folder', links, 'a.md'); expect(groups.visible('0')).toBe(false);
  const back = new GroupControls(view, redraw);
  back.update('folder', links, 'a.md', groups.snapshot()); expect(back.visible('0')).toBe(false);
  groups.update('type', links, 'a.md'); expect(groups.visible('0')).toBe(true);
  expect(groups.label('0')).toBe('Markdown'); groups.destroy(); expect(action.remove).toHaveBeenCalledOnce();
});
