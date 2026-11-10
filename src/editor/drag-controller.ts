import { setIcon, type MarkdownView } from 'obsidian';
import type { SelectionSnapshot } from './selection-validation';
import { validateSelection } from './selection-validation';
import type { EditorBridge } from './editor-extension';
import type { SelectionAction } from './selection-action';
import type { Side } from '../types';
import type { Box } from '../view/layout-engine';

export class DragController {
  readonly handle: HTMLButtonElement;
  private zones: HTMLDivElement[];
  private ghost: HTMLDivElement;
  private cleanupDrag?: () => void;
  private snapshot?: SelectionSnapshot;
  private bridge?: EditorBridge;
  private geometry?: { host: DOMRect; viewport: Box; body: Box };
  constructor(private root: HTMLElement, private view: MarkdownView, private action: SelectionAction) {
    this.handle = root.createEl('button', { cls: 'margin-link-handle', attr: { type: 'button', 'aria-label': '拖到正文两侧以链接已有文件；也可按 Enter', title: '拖到左/右空白处以链接已有文件 · Enter 直接选择文件' } });
    setIcon(this.handle, 'link-2');
    this.handle.hidden = true;
    this.zones = ['left', 'right'].map(side => root.createDiv({ cls: `margin-link-drop-zone margin-link-drop-${side}`, text: '放下以选择文件' }));
    this.ghost = root.createDiv({ cls: 'margin-link-drag-ghost', text: '链接到已有文件' });
    this.handle.addEventListener('pointerdown', this.onDown);
    this.handle.addEventListener('keydown', this.onKey);
  }
  private onKey = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && this.bridge) {
      event.preventDefault();
      const snapshot = this.action.capture(this.view, this.bridge);
      if (snapshot) this.action.open(this.view, this.bridge, snapshot);
    }
  };
  update(bridge: EditorBridge | undefined, host: DOMRect, viewport: Box, body: Box): void {
    this.bridge = bridge;
    this.geometry = { host, viewport, body };
    if (this.cleanupDrag) return;
    this.handle.hidden = true;
    if (!bridge || this.view.getMode() !== 'source' || !(bridge.cm.hasFocus || this.handle === this.root.ownerDocument.activeElement)) return;
    const selection = bridge.cm.state.selection;
    const { from, to } = selection.main;
    if (from === to || validateSelection(bridge.cm.state.doc.toString(), from, to, selection.ranges.length, bridge.parsed)) return;
    const rect = bridge.rangeRects(from, to).at(-1);
    if (!rect || rect.top < host.top + viewport.top || rect.bottom > host.top + viewport.bottom - 30) return;
    const x = Math.max(4, Math.min(host.width - 32, rect.right - host.left + 6));
    const y = rect.bottom - host.top + 2;
    this.handle.style.transform = `translate(${x}px, ${y}px)`;
    this.handle.hidden = false;
  }
  private sideAt(x: number, y: number): Side | undefined {
    if (!this.geometry) return;
    const { host, body, viewport } = this.geometry;
    x -= host.left; y -= host.top;
    if (y < viewport.top || y > viewport.bottom) return;
    if (x >= viewport.left + 4 && x <= body.left - 12 && body.left - viewport.left >= 52) return 'left';
    if (x >= body.right + 12 && x <= viewport.right - 4 && viewport.right - body.right >= 52) return 'right';
  }
  private onDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.bridge || !this.geometry) return;
    event.preventDefault(); event.stopPropagation();
    const bridge = this.bridge;
    const snapshot = this.action.capture(this.view, bridge);
    if (!snapshot) return;
    this.snapshot = snapshot;
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const doc = this.root.ownerDocument;
    const win = doc.defaultView;
    const pointerId = event.pointerId;
    const reset = () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', reset, true);
      doc.removeEventListener('keydown', key, true);
      win?.removeEventListener('blur', reset);
      this.root.classList.remove('margin-link-dragging');
      this.zones.forEach(zone => zone.classList.remove('margin-link-drop-active', 'margin-link-drop-available'));
      this.snapshot = undefined;
      this.cleanupDrag = undefined;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (bridge.revision !== snapshot.revision || this.view.file?.path !== snapshot.sourcePath || this.view.getMode() !== 'source') { reset(); return; }
      dragging ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
      if (!dragging || !this.geometry) return;
      e.preventDefault();
      this.root.classList.add('margin-link-dragging');
      const { host, body, viewport } = this.geometry;
      const side = this.sideAt(e.clientX, e.clientY);
      this.ghost.style.transform = `translate(${Math.min(host.width - 150, Math.max(0, e.clientX - host.left + 10))}px, ${Math.min(host.height - 32, Math.max(0, e.clientY - host.top + 10))}px)`;
      this.zones.forEach((zone, i) => {
        const left = i === 0 ? viewport.left + 4 : body.right + 12;
        const right = i === 0 ? body.left - 12 : viewport.right - 4;
        zone.style.left = `${left}px`;
        zone.style.top = `${viewport.top}px`;
        zone.style.width = `${Math.max(0, right - left)}px`;
        zone.style.height = `${Math.max(0, viewport.bottom - viewport.top)}px`;
        zone.classList.toggle('margin-link-drop-available', right - left >= 36);
        zone.classList.toggle('margin-link-drop-active', side === (i === 0 ? 'left' : 'right'));
      });
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const side = this.sideAt(e.clientX, e.clientY);
      const valid = this.snapshot;
      reset();
      if (valid && dragging && side) this.action.open(this.view, bridge, valid, side);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); reset(); } };
    this.cleanupDrag = reset;
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', reset, true);
    doc.addEventListener('keydown', key, true);
    win?.addEventListener('blur', reset);
  };
  cancel(): void { this.cleanupDrag?.(); this.handle.hidden = true; }
  destroy(): void {
    this.cancel();
    this.handle.removeEventListener('pointerdown', this.onDown);
    this.handle.removeEventListener('keydown', this.onKey);
  }
}
