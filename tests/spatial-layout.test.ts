import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, type CardShape } from '../src/types';
import { layoutCards, positionFromDrop, overlapsCard, lane, type LayoutInput } from '../src/view/layout-engine';
import { connectorPath } from '../src/view/connector-renderer';
const input: LayoutInput = { width: 1400, height: 800, body: { left: 360, right: 1040, top: 0, bottom: 800 },
  viewport: { left: 0, right: 1400, top: 40, bottom: 760 }, density: 'auto', layout: 'balanced',
  preferences: { ...DEFAULT_PREFERENCES, placementMode: 'free' }, lineHeight: 24, anchors: [{ key: 'a', x: 700, y: 300 }] };
describe('relative spatial layout', () => {
  it.each([
    { grab: { u: 78 / 84, v: 6 / 84 }, pointer: [1286, 218], expected: [1208, 212] },
    { grab: { u: 6 / 84, v: 78 / 84 }, pointer: [1198, 290], expected: [1192, 212] }
  ])('preserves the independently calculated square-card corner displacement: $expected', ({ grab, pointer, expected }) => {
    const square = { ...input, preferences: { ...input.preferences!, cardShape: 'square' as const } };
    const result = positionFromDrop(square, input.anchors[0], pointer[0], pointer[1], [], grab)!;
    expect([result.placement.x, result.placement.y]).toEqual(expected);
    expect(layoutCards({ ...square, anchors: [{ ...input.anchors[0], manual: result.relative }] })[0]).toMatchObject({ x: expected[0], y: expected[1] });
  });
  it.each<CardShape>(['horizontal', 'square', 'icon'])('matches pointer displacement at every corner and centre for %s', cardShape => {
    const p = { ...input, preferences: { ...input.preferences!, cardShape } };
    const width = cardShape === 'horizontal' ? 196 : cardShape === 'square' ? 84 : 36;
    const height = cardShape === 'horizontal' ? 48 : width;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]]) {
      const result = positionFromDrop(p, input.anchors[0], 1158 + u * width + 8, 200 + v * height + 12, [], { u, v })!;
      expect(result.placement.x).toBeCloseTo(1166); expect(result.placement.y).toBeCloseTo(212);
    }
  });
  it('uses the target-side dimensions across sides and keeps pointer hit-testing independent of the grabbed rectangle', () => {
    const p = { ...input, body: { ...input.body, left: 100 }, preferences: { ...input.preferences!, cardShape: 'square' as const } };
    const result = positionFromDrop(p, input.anchors[0], 50, 300, [], { u: 78 / 84, v: 6 / 84 })!;
    expect(result.placement.shape).toBe('icon');
    expect(result.placement.x).toBeCloseTo(50 - 36 * 78 / 84);
    expect(result.placement.y).toBeCloseTo(300 - 36 * 6 / 84);
    // A displaced grab point cannot turn a pointer in the body into a valid drop.
    expect(positionFromDrop(p, input.anchors[0], 1030, 300, [], { u: 1, v: 0 })).toBeUndefined();
    const boundary = positionFromDrop(p, input.anchors[0], 1057, 300, [], { u: 1, v: 0 })!;
    expect(boundary.placement.x).toBe(1056);
  });
  it('retains centre semantics for keyboard moves and refuses invalid grab ratios', () => {
    const square = { ...input, preferences: { ...input.preferences!, cardShape: 'square' as const } };
    expect(positionFromDrop(square, input.anchors[0], 1286, 218, [])?.placement).toMatchObject({ x: 1244, y: 176 });
    for (const grab of [{ u: NaN, v: 0 }, { u: 0, v: Infinity }, { u: -1, v: 0 }, { u: 0, v: 1.01 }]) {
      expect(positionFromDrop(square, input.anchors[0], 1200, 300, [], grab)).toBeUndefined();
    }
  });
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
  it('restores the exact original rectangle after temporary viewport constraints', () => {
    const moved = positionFromDrop(input, input.anchors[0], 1270, 660, [])!;
    const manual = { ...moved.relative };
    const saved = { ...input, anchors: [{ ...input.anchors[0], manual }] };
    const original = layoutCards(saved);
    const narrowed = { ...saved, width: 1120, viewport: { ...input.viewport, right: 1120, bottom: 400 } };
    for (const p of layoutCards(narrowed)) {
      expect(p.x).toBeGreaterThan(input.body.right); expect(p.y + p.height).toBeLessThanOrEqual(392);
    }
    expect(manual).toEqual(moved.relative);
    expect(layoutCards(saved)).toEqual(original);
  });
  it('ignores saved positions in auto mode and respects manually positioned cards first', () => {
    const manual = { side: 'right' as const, xNormalized: 0.3, yOffset: 5 };
    const data = { ...input, anchors: [{ ...input.anchors[0], manual }] };
    const auto = { ...DEFAULT_PREFERENCES, placementMode: 'auto' as const };
    expect(layoutCards({ ...data, preferences: auto })).toEqual(layoutCards({ ...input, preferences: auto }));
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
