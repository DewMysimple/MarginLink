import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, type CardShape } from '../src/types';
import { layoutCards, positionFromDrop, overlapsCard, lane, type LayoutInput } from '../src/view/layout-engine';
import { connectorPath } from '../src/view/connector-renderer';
const input: LayoutInput = { width: 1400, height: 800, body: { left: 360, right: 1040, top: 0, bottom: 800 },
  viewport: { left: 0, right: 1400, top: 40, bottom: 760 }, density: 'auto', layout: 'balanced',
  preferences: { ...DEFAULT_PREFERENCES, placementMode: 'free' }, lineHeight: 24, anchors: [{ key: 'a', x: 700, y: 300 }] };
describe('relative spatial layout', () => {
  it('round trips a 2D drop across sides and follows anchor scrolling', () => {
    const moved = positionFromDrop(input, input.anchors[0], 1200, 500, [])!;
    expect(moved.relative.side).toBe('right');
    const saved = { ...input, anchors: [{ ...input.anchors[0], manual: moved.relative }] };
    const p = layoutCards(saved)[0]; expect(p.x).toBeCloseTo(moved.placement.x); expect(p.y).toBeCloseTo(moved.placement.y);
    const scrolled = layoutCards({ ...saved, anchors: [{ ...saved.anchors[0], y: 200 }] })[0]; expect(scrolled.y).toBeCloseTo(p.y - 100);
    const wider = { ...saved, width: 1700, viewport: { ...input.viewport, right: 1700 } };
    const wide = layoutCards(wider)[0]; expect(wide.x).toBeGreaterThan(p.x); expect(wide.y).toBe(p.y);
  });
  it('never commits body/outside release points; hides and restores unavailable side', () => {
    expect(positionFromDrop(input, input.anchors[0], 700, 400, [])).toBeUndefined();
    expect(positionFromDrop(input, input.anchors[0], 1500, 400, [])).toBeUndefined();
    const saved = { ...input, anchors: [{ ...input.anchors[0], manual: { side: 'right' as const, xNormalized: 0.5, yOffset: 2 } }] };
    expect(layoutCards({ ...saved, body: { ...input.body, right: 1380 } })).toEqual([]);
    expect(layoutCards(saved)).toHaveLength(1);
    expect(layoutCards({ ...saved, anchors: [{ ...saved.anchors[0], y: -200 }] })).toEqual([]);
  });
  it('ignores saved positions in auto mode and respects manually positioned cards first', () => {
    const manual = { side: 'right' as const, xNormalized: 0.3, yOffset: 5 };
    const data = { ...input, anchors: [{ ...input.anchors[0], manual }] };
    expect(layoutCards({ ...data, preferences: DEFAULT_PREFERENCES })).toEqual(layoutCards({ ...input, preferences: DEFAULT_PREFERENCES }));
    const placed = layoutCards({ ...data, anchors: [...data.anchors, { key: 'b', x: 700, y: 420 }, { key: 'c', x: 710, y: 425, manual }] });
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlapsCard(placed[i], placed[j])).toBe(false);
    expect(placed[0].manual).toBe(true);
  });
  it.each<CardShape>(['horizontal', 'square', 'icon'])('keeps size, collision and compact fallback consistent for %s', cardShape => {
    for (const cardSize of ['small', 'medium', 'large'] as const) {
      const p = { ...input, preferences: { ...input.preferences!, cardShape, cardSize } };
      const c = layoutCards(p)[0]; expect(c.shape).toBe(cardShape);
      if (cardShape !== 'horizontal') expect(c.width).toBe(c.height);
      const narrow = layoutCards({ ...p, body: { ...input.body, left: 80, right: 1320 } })[0]; expect(narrow.compact).toBe(true);
      const band = lane(p, c.side); expect(c.x).toBeGreaterThanOrEqual(band.left); expect(c.x + c.width).toBeLessThanOrEqual(band.right);
    }
  });
  it('snaps to grid/neighbors and avoids occupied rectangles', () => {
    const p = { ...input, preferences: { ...input.preferences!, placementMode: 'snap' as const } };
    const first = positionFromDrop(p, input.anchors[0], 1200, 500, [])!;
    const second = positionFromDrop(p, { key: 'b', x: 700, y: 320 }, 1200, 500, [first.placement])!;
    expect(second.snapped).toBe(true); expect(overlapsCard(first.placement, second.placement)).toBe(false);
  });
  it('scales vertical offsets with line height and clips at the current viewport', () => {
    const manual = { side: 'left' as const, xNormalized: 1, yOffset: 2 };
    const normal = layoutCards({ ...input, anchors: [{ ...input.anchors[0], manual }] })[0];
    const larger = layoutCards({ ...input, lineHeight: 36, anchors: [{ ...input.anchors[0], manual }] })[0];
    expect(larger.y - normal.y).toBe(24);
    const clipped = layoutCards({ ...input, anchors: [{ ...input.anchors[0], manual: { ...manual, yOffset: 80 } }] })[0];
    expect(clipped.y + clipped.height).toBeLessThanOrEqual(input.viewport.bottom - 8);
  });
});
describe('connector geometry', () => {
  const card = layoutCards(input)[0];
  it.each(['curve', 'straight', 'elbow'] as const)('uses final card edge for %s', style => {
    const d = connectorPath(700, 302, card, style);
    expect(d).toContain('M 700 302'); expect(d).not.toMatch(/NaN|Infinity/);
    expect(d).toContain(style === 'curve' ? ' C ' : style === 'straight' ? ' L ' : ' H ');
  });
  it('rejects invalid anchor coordinates', () => expect(connectorPath(NaN, 0, card)).toBe(''));
});
