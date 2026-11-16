import type { RelativePosition } from '../types';
import { clamp, lane, positionFromDrop, type LayoutAnchor, type LayoutInput, type Placement } from './layout-engine';

export interface CardDragContext { input: LayoutInput; anchor: LayoutAnchor; occupied: Placement[]; valid: () => boolean }
export class CardDragController {
  private cleanup?: () => void;
  private current?: { key: string; placement: Placement };
  private suppressedClick?: string;
  private bands: HTMLDivElement[];
  constructor(private root: HTMLElement, private context: (key: string) => CardDragContext | undefined,
    private preview: (key: string, placement?: Placement) => void,
    private commit: (key: string, relative: RelativePosition) => void) {
    this.bands = ['left', 'right'].map(() => root.createDiv({ cls: 'margin-link-position-band' }));
  }
  get dragging(): boolean { return !!this.cleanup; }
  placement(key: string): Placement | undefined { return this.current?.key === key ? this.current.placement : undefined; }
  consumeClick(event: MouseEvent, key: string): boolean {
    if (event.detail === 0 || this.suppressedClick !== key) return false;
    this.suppressedClick = undefined;
    event.preventDefault(); event.stopPropagation();
    return true;
  }
  start(event: PointerEvent, key: string, card: HTMLElement): void {
    // A fresh pointer gesture must always be able to open the card, even when
    // a cancelled drag did not produce a browser click to consume.
    this.suppressedClick = undefined;
    const context = this.context(key);
    if (!context || event.button !== 0) return;
    this.cancel(); this.suppressedClick = undefined;
    // Read the outer button even when the event target is text or an SVG child.
    const rect = card.getBoundingClientRect();
    if (![rect.left, rect.top, rect.width, rect.height, event.clientX, event.clientY].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return;
    const grabPoint = { u: clamp((event.clientX - rect.left) / rect.width, 0, 1), v: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
    event.preventDefault(); event.stopPropagation();
    // Native button focus can scroll the note on its first pointerdown, which
    // would cancel the gesture before the threshold. Keep focus on the card.
    card.focus({ preventScroll: true });
    const doc = this.root.ownerDocument, win = doc.defaultView!;
    const start = { x: event.clientX, y: event.clientY }, pointerId = event.pointerId;
    let moved = false;
    const locate = (e: PointerEvent) => {
      const latest = this.context(key), host = this.root.getBoundingClientRect();
      if (!context.valid() || !latest?.valid() || ![host.left, host.top, host.width, host.height].every(Number.isFinite) || host.width <= 0 || host.height <= 0 ||
          ![latest.input.width, latest.input.height, ...Object.values(latest.input.body), ...Object.values(latest.input.viewport)].every(Number.isFinite) || latest.input.width <= 0 || latest.input.height <= 0) {
        cancel(); return;
      }
      return positionFromDrop(latest.input, latest.anchor, e.clientX - host.left, e.clientY - host.top, latest.occupied, grabPoint);
    };
    const reset = (suppressClick = moved) => {
      if (this.cleanup !== cancel) return;
      doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', pointerCancel, true); doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('focusin', focus, true);
      doc.removeEventListener('scroll', cancel, true); win.removeEventListener('blur', cancel); win.removeEventListener('resize', cancel);
      card.removeEventListener('lostpointercapture', cancel);
      try { if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId); } catch { /* View may already be detached. */ }
      this.suppressedClick = suppressClick ? key : undefined;
      this.cleanup = undefined; this.current = undefined;
      this.root.classList.remove('margin-link-card-dragging', 'margin-link-drop-valid', 'margin-link-snapped');
      this.preview(key);
    };
    const cancel = () => reset(true);
    const pointerCancel = (e: PointerEvent) => { if (e.pointerId === pointerId) cancel(); };
    const focus = (e: FocusEvent) => { if (!card.contains(e.target as Node)) cancel(); };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!context.valid()) { cancel(); return; }
      moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5;
      if (!moved) return;
      e.preventDefault();
      this.root.classList.add('margin-link-card-dragging');
      const drop = locate(e);
      if (this.cleanup !== cancel) return;
      this.root.classList.toggle('margin-link-drop-valid', !!drop);
      this.root.classList.toggle('margin-link-snapped', !!drop?.snapped);
      if (drop) {
        this.current = { key, placement: drop.placement };
        this.preview(key, drop.placement);
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      // Validate the actual release point, even if no last pointermove was delivered.
      moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5;
      const finalDrop = moved ? locate(e) : undefined;
      reset();
      if (finalDrop) this.commit(key, finalDrop.relative);
    };
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    this.bands.forEach((element, i) => {
      const band = lane(context.input, i === 0 ? 'left' : 'right');
      Object.assign(element.style, { left: `${band.left}px`, top: `${band.top}px`, width: `${Math.max(0, band.right - band.left)}px`, height: `${Math.max(0, band.bottom - band.top)}px` });
    });
    this.cleanup = cancel;
    try { card.setPointerCapture(pointerId); } catch { /* Document listeners remain a fallback. */ }
    doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', pointerCancel, true); doc.addEventListener('keydown', keydown, true);
    doc.addEventListener('focusin', focus, true);
    doc.addEventListener('scroll', cancel, true); win.addEventListener('blur', cancel); win.addEventListener('resize', cancel);
    card.addEventListener('lostpointercapture', cancel);
  }
  cancel(): void { this.cleanup?.(); }
  destroy(): void { this.cancel(); this.bands.forEach(b => b.remove()); }
}
