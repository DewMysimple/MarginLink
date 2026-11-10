import type { Preferences, Side } from '../types';
export interface Box { left: number; right: number; top: number; bottom: number }
export interface LayoutInput {
  width: number; height: number; body: Box; viewport: Box;
  anchors: { key: string; x: number; y: number; preferred?: Side }[];
  density: Preferences['density']; layout: Preferences['layout'];
}
export interface Placement { key: string; side: Side; x: number; y: number; width: number; height: number; compact: boolean }
export function layoutCards(input: LayoutInput): Placement[] {
  const { width, height, body, viewport } = input;
  if (![width, height, ...Object.values(body), ...Object.values(viewport)].every(Number.isFinite) || width <= 0 || height < 36) return [];
  const top = Math.max(8, viewport.top + 8);
  const bottom = Math.min(height - 8, viewport.bottom - 8);
  const gap = 10;
  const available = {
    left: Math.max(0, body.left - Math.max(0, viewport.left) - 24),
    right: Math.max(0, Math.min(width, viewport.right) - body.right - 24)
  };
  const counts = { left: 0, right: 0 };
  const output: Placement[] = [];
  const ordered = [...input.anchors].filter(a => Number.isFinite(a.x) && Number.isFinite(a.y) && a.y >= top && a.y <= bottom)
    .sort((a, b) => a.y - b.y || a.key.localeCompare(b.key));
  for (const a of ordered) {
    const sides = (['left', 'right'] as Side[]).filter(s => available[s] >= 36);
    if (!sides.length) continue;
    const scores = (side: Side) => {
      const distance = side === 'left' ? Math.abs(a.x - body.left) : Math.abs(body.right - a.x);
      return distance + counts[side] * Math.max(100, (body.right - body.left) * 0.45) - (a.preferred === side ? width * 2 : 0) - (input.layout === side ? width : 0);
    };
    const side = sides.sort((a, b) => scores(a) - scores(b))[0];
    const compact = input.density === 'compact' || available[side] < 128;
    const cardWidth = compact ? 34 : Math.min(196, available[side]);
    const cardHeight = compact ? 32 : 48;
    // Bounded capacity: hide excess rather than overflowing or stacking cards.
    if ((counts[side] + 1) * (cardHeight + gap) - gap > bottom - top) continue;
    counts[side]++;
    const x = side === 'left' ? body.left - 16 - cardWidth : body.right + 16;
    if (x < 0 || x + cardWidth > width) continue;
    output.push({ key: a.key, side, x, y: a.y - cardHeight / 2, width: cardWidth, height: cardHeight, compact });
  }
  for (const side of ['left', 'right'] as Side[]) {
    const cards = output.filter(p => p.side === side);
    let cursor = top;
    for (const p of cards) { p.y = Math.max(cursor, p.y); cursor = p.y + p.height + gap; }
    cursor = bottom;
    for (let i = cards.length - 1; i >= 0; i--) {
      const p = cards[i]; p.y = Math.min(p.y, cursor - p.height); cursor = p.y - gap;
    }
  }
  return output;
}
