import type { Box } from '../types';

const intersects = (a: Box, b: Box, pad = 2) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
export const containsBox = (outer: Box, inner: Box) => inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
/** Find two small labels in actual whitespace, without covering glyphs/cards.
 * Labels are view-only continuation aids, never written into a note or data.json. */
export function continuationPair(source: Box, target: Box, viewport: Box, body: Box, obstacles: readonly Box[], occupied: readonly Box[] = [], labelWidth = 20): [Box, Box] | undefined {
  if (!containsBox(viewport, source) || !containsBox(viewport, target)) return;
  const pair = relationNumberPair(source, target, viewport, body, obstacles, occupied, labelWidth);
  return pair.every(box => containsBox(viewport, box) && ![...obstacles, source, target, ...occupied].some(o => intersects(box, o)))
    && !intersects(pair[0], pair[1]) ? pair : undefined;
}

/** Plan view-only badges in document coordinates. Native clipping handles the
 * two ends independently. When ordinary whitespace is full, reserve a source
 * gutter beside the same line and badge the target's own corner; never silently
 * drop a normal relationship because a decorative slot search failed. */
export function relationNumberPair(source: Box, target: Box, region: Box, body: Box,
  obstacles: readonly Box[], occupied: readonly Box[] = [], labelWidth = 16, sharedTarget = false): [Box, Box] {
  const width = Math.min(labelWidth, Math.max(1, region.right - region.left));
  const cy = (source.top + source.bottom) / 2, sourceRight = (source.left + source.right) / 2 > (body.left + body.right) / 2;
  const bands = sourceRight ? ['right', 'left'] : ['left', 'right'];
  const sourceSlot = (): Box => {
    for (const side of bands) for (const dy of [0, -16, 16]) {
      if (cy - 8 + dy < region.top || cy + 8 + dy > region.bottom) continue;
      for (let offset = 0; offset < region.right - region.left; offset += width + 2) {
        const left = side === 'right' ? body.right + 1 + offset : body.left - 1 - width - offset;
        const box = { left, right: left + width, top: cy - 8 + dy, bottom: cy + 8 + dy };
        if (!containsBox(region, box)) continue;
        if (!intersects(box, target, 0) && !obstacles.some(o => intersects(box, o, 0)) && !occupied.some(o => intersects(box, o, 0))) return box;
      }
    }
    // Even an intentionally overlapping card cannot erase its source badge.
    // This fallback stays outside the text column on its own visual line.
    const left = sourceRight ? Math.min(region.right - width, body.right + 1) : Math.max(region.left, body.left - width - 1);
    return { left, right: left + width, top: cy - 8, bottom: cy + 8 };
  };
  const a = sourceSlot();
  const cyTarget = (target.top + target.bottom) / 2;
  const candidates = [
    { left: target.right + 4, right: target.right + 4 + width, top: cyTarget - 8, bottom: cyTarget + 8 },
    { left: target.left - 4 - width, right: target.left - 4, top: cyTarget - 8, bottom: cyTarget + 8 }
  ];
  const free = (box: Box, pad: number) => containsBox(region, box) && (box.right <= body.left || box.left >= body.right)
    && !intersects(box, source, pad) && !intersects(box, a, pad) && !obstacles.some(o => intersects(box, o, pad)) && !occupied.some(o => intersects(box, o, pad));
  const b = candidates.find(box => free(box, 2));
  if (b) return [a, b];
  if (sharedTarget) {
    // Stack paired numbers beside a shared card before using its face.
    for (let row = 1; row <= occupied.length + 1; row++) {
      for (const dy of [-18 * row, 18 * row]) for (const candidate of candidates) {
        const box = { ...candidate, top: candidate.top + dy, bottom: candidate.bottom + dy };
        if (free(box, 0)) return [a, box];
      }
    }
  }
  // Intentional overlapping cards still get distinct badge slots whenever their
  // own faces have room, without moving either card or covering body text.
  for (let top = target.top + 2; top + 16 <= target.bottom - 2; top += 18) {
    for (let left = target.right - width - 2; left >= target.left + 2; left -= width + 2) {
      const box = { left, right: left + width, top, bottom: top + 16 };
      if (!intersects(box, a, 0) && !occupied.some(o => intersects(box, o, 0))) return [a, box];
    }
  }
  const left = Math.max(target.left, target.right - width - 2), top = target.top + 2;
  return [a, { left, right: left + width, top, bottom: top + 16 }];
}
