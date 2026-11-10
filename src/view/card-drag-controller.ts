import type { RelativePosition } from '../types';
import { lane, positionFromDrop, type LayoutAnchor, type LayoutInput, type Placement } from './layout-engine';

export interface CardDragContext { input: LayoutInput; anchor: LayoutAnchor; occupied: Placement[]; valid: () => boolean }
export class CardDragController {
  private cleanup?: () => void;
  private current?: { key: string; placement: Placement };
  private ghost: HTMLDivElement;
  private bands: HTMLDivElement[];
  constructor(private root: HTMLElement, private context: (key: string) => CardDragContext | undefined,
    private preview: (key: string, placement?: Placement) => void,
    private commit: (key: string, relative: RelativePosition) => void) {
    this.ghost = root.createDiv({ cls: 'margin-link-position-ghost', text: '放到正文两侧空白 · Esc 取消' });
    this.bands = ['left', 'right'].map(() => root.createDiv({ cls: 'margin-link-position-band' }));
  }
  get dragging(): boolean { return !!this.cleanup; }
  placement(key: string): Placement | undefined { return this.current?.key === key ? this.current.placement : undefined; }
  start(event: PointerEvent, key: string, grip: HTMLElement): void {
    const context = this.context(key);
    if (!context || event.button !== 0) return;
    this.cancel(); event.preventDefault(); event.stopPropagation();
    const doc = this.root.ownerDocument, win = doc.defaultView!;
    const start = { x: event.clientX, y: event.clientY }, pointerId = event.pointerId;
    const host = this.root.getBoundingClientRect();
    let moved = false;
    let drop: ReturnType<typeof positionFromDrop>;
    const reset = () => {
      doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('focusin', focus, true);
      doc.removeEventListener('scroll', cancel, true); win.removeEventListener('blur', cancel); win.removeEventListener('resize', cancel);
      grip.removeEventListener('lostpointercapture', cancel);
      try { if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId); } catch { /* View may already be detached. */ }
      this.cleanup = undefined; this.current = undefined;
      this.root.classList.remove('margin-link-card-dragging', 'margin-link-drop-valid', 'margin-link-snapped');
      this.preview(key);
    };
    const cancel = () => reset();
    const focus = (e: FocusEvent) => { if (!this.root.contains(e.target as Node)) reset(); };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!context.valid()) { reset(); return; }
      moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5;
      if (!moved) return;
      e.preventDefault();
      this.root.classList.add('margin-link-card-dragging');
      drop = positionFromDrop(context.input, context.anchor, e.clientX - host.left, e.clientY - host.top, context.occupied);
      this.root.classList.toggle('margin-link-drop-valid', !!drop);
      this.root.classList.toggle('margin-link-snapped', !!drop?.snapped);
      this.ghost.style.transform = `translate(${Math.max(0, Math.min(host.width - 160, e.clientX - host.left + 10))}px, ${Math.max(0, Math.min(host.height - 40, e.clientY - host.top + 12))}px)`;
      this.ghost.textContent = drop ? drop.snapped ? '已对齐并避让 · 放下保存' : '放下保存位置' : '无可用位置 · 松手恢复';
      if (drop) {
        this.current = { key, placement: drop.placement };
        this.preview(key, drop.placement);
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      // Validate the actual release point, even if no last pointermove was delivered.
      const finalDrop = moved && context.valid() ? positionFromDrop(context.input, context.anchor, e.clientX - host.left, e.clientY - host.top, context.occupied) : undefined;
      reset();
      if (finalDrop) this.commit(key, finalDrop.relative);
    };
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reset(); } };
    this.bands.forEach((element, i) => {
      const band = lane(context.input, i === 0 ? 'left' : 'right');
      Object.assign(element.style, { left: `${band.left}px`, top: `${band.top}px`, width: `${Math.max(0, band.right - band.left)}px`, height: `${Math.max(0, band.bottom - band.top)}px` });
    });
    this.cleanup = reset;
    try { grip.setPointerCapture(pointerId); } catch { /* Document listeners remain a fallback. */ }
    doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', keydown, true);
    doc.addEventListener('focusin', focus, true);
    doc.addEventListener('scroll', cancel, true); win.addEventListener('blur', cancel); win.addEventListener('resize', cancel);
    grip.addEventListener('lostpointercapture', cancel);
  }
  cancel(): void { this.cleanup?.(); }
  destroy(): void { this.cancel(); this.ghost.remove(); this.bands.forEach(b => b.remove()); }
}
