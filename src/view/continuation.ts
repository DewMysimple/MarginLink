import type { Box } from '../types';

const intersects = (a: Box, b: Box, pad = 2) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
export const containsBox = (outer: Box, inner: Box) => inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
/** Find two small labels in actual whitespace, without covering glyphs/cards.
 * Labels are view-only continuation aids, never written into a note or data.json. */
export function continuationPair(source: Box, target: Box, viewport: Box, body: Box, obstacles: readonly Box[], occupied: readonly Box[] = [], labelWidth = 20): [Box, Box] | undefined {
  if (!containsBox(viewport, source) || !containsBox(viewport, target)) return;
  const used = [...obstacles, source, target, ...occupied];
  const find = (endpoint: Box): Box | undefined => {
    const cx = (endpoint.left + endpoint.right) / 2, cy = (endpoint.top + endpoint.bottom) / 2;
    const points = [[cx - labelWidth / 2, endpoint.top - 22], [cx - labelWidth / 2, endpoint.bottom + 6],
      [endpoint.left - labelWidth - 6, cy - 8], [endpoint.right + 6, cy - 8]];
    for (let dy = 0; dy <= viewport.bottom - viewport.top; dy += 20) {
      for (const y of dy ? [cy - 8 - dy, cy - 8 + dy] : [cy - 8]) {
        points.push([body.left - labelWidth - 6, y], [body.right + 6, y]);
      }
    }
    for (const [x, y] of points) {
      const box = { left: x, right: x + labelWidth, top: y, bottom: y + 16 };
      if (containsBox(viewport, box) && !used.some(o => intersects(box, o))) return box;
    }
  };
  const a = find(source); if (!a) return;
  used.push(a);
  const b = find(target); return b ? [a, b] : undefined;
}
