import { describe, it, expect } from 'vitest';
import { layoutCards, type LayoutInput } from '../src/view/layout-engine';
const base: LayoutInput = {
  width: 1200, height: 720, body: { left: 250, right: 950, top: 0, bottom: 720 },
  viewport: { left: 0, right: 1200, top: 0, bottom: 720 },
  anchors: Array.from({ length: 50 }, (_, i) => ({ key: String(i), x: 300 + i * 5, y: 300 + i * 2 })),
  density: 'auto', layout: 'balanced'
};
describe('bounded deterministic margin layout', () => {
  it('never overlaps cards, covers body, or overflows even under saturation', () => {
    const cards = layoutCards(base);
    expect(cards.length).toBeGreaterThan(0);
    for (const p of cards) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.y).toBeGreaterThanOrEqual(8);
      expect(p.x + p.width).toBeLessThanOrEqual(base.width); expect(p.y + p.height).toBeLessThanOrEqual(712);
      expect(p.side === 'left' ? p.x + p.width <= base.body.left : p.x >= base.body.right).toBe(true);
    }
    for (const side of ['left', 'right']) {
      const lane = cards.filter(p => p.side === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < lane.length; i++) expect(lane[i].y - lane[i - 1].y - lane[i - 1].height).toBeGreaterThanOrEqual(10);
    }
    expect(layoutCards(base)).toEqual(cards);
  });
  it('uses compact icons or hides safely in narrow margins', () => {
    const one = [{ key: 'one', x: 400, y: 300 }];
    const compact = layoutCards({ ...base, anchors: one, body: { ...base.body, left: 90, right: 1110 } });
    expect(compact[0].compact).toBe(true);
    expect(layoutCards({ ...base, anchors: one, body: { ...base.body, left: 24, right: 1176 } })).toEqual([]);
  });
  it('handles non-finite, negative and offscreen inputs', () => {
    expect(layoutCards({ ...base, width: NaN })).toEqual([]);
    expect(layoutCards({ ...base, height: -1 })).toEqual([]);
    expect(layoutCards({ ...base, anchors: [{ key: 'bad', x: NaN, y: 300 }, { key: 'hidden', x: 400, y: -100 }] })).toEqual([]);
  });
  it('honors an in-memory drop side without modifying deterministic defaults', () => {
    const cards = layoutCards({ ...base, anchors: [{ key: 'one', x: 300, y: 300, preferred: 'right' }] });
    expect(cards[0].side).toBe('right');
  });
});
