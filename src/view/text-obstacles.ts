import type { Box } from '../types';

/** Shared per-view text measurements in content coordinates. Scrolls inside
 * the measured neighbourhood only project the same boxes; DOM changes remeasure. */
export class TextObstacles {
  private dirty = true;
  private boxes: Box[] = [];
  private top = Infinity;
  private bottom = -Infinity;
  revision = 0;
  invalidate(): void { this.dirty = true; }
  read(root: HTMLElement, host: DOMRect, viewport: Box, scrollTop: number): readonly Box[] {
    const top = viewport.top + scrollTop, bottom = viewport.bottom + scrollTop;
    if (!this.dirty && top >= this.top && bottom <= this.bottom) return this.boxes;
    const overscan = Math.max(160, viewport.bottom - viewport.top);
    this.top = top - overscan; this.bottom = bottom + overscan;
    const doc = root.ownerDocument, low = host.top + this.top - scrollTop, high = host.top + this.bottom - scrollTop;
    const boxes: Box[] = [], range = doc.createRange();
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.matches('.margin-link-overlay, .cm-gap, .cm-widgetBuffer, .cm-selectionLayer, .cm-cursorLayer')) return NodeFilter.FILTER_REJECT;
        const r = el.getBoundingClientRect();
        return r.right > r.left && r.bottom > r.top && (r.bottom < low || r.top > high)
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    });
    while (walker.nextNode()) {
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0.5 || rect.height <= 0 || rect.bottom < low || rect.top > high) continue;
        boxes.push({ left: rect.left - host.left, right: rect.right - host.left,
          top: rect.top - host.top + scrollTop, bottom: rect.bottom - host.top + scrollTop });
      }
    }
    this.boxes = boxes; this.dirty = false; this.revision++;
    return boxes;
  }
}
