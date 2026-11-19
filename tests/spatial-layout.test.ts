import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, type CardShape } from '../src/types';
import { layoutCards, positionFromDrop, overlapsCard, lane, type LayoutInput } from '../src/view/layout-engine';
import { connectorRoute } from '../src/view/connector-renderer';
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
    expect(layoutCards({ ...saved, anchors: [{ ...saved.anchors[0], y: -200 }] })[0].y).toBeLessThan(0);
  });
  it('restores the exact original rectangle after temporary viewport constraints', () => {
    const moved = positionFromDrop(input, input.anchors[0], 1270, 660, [])!;
    const manual = { ...moved.relative };
    const saved = { ...input, anchors: [{ ...input.anchors[0], manual }] };
    const original = layoutCards(saved);
    const narrowed = { ...saved, width: 1120, viewport: { ...input.viewport, right: 1120, bottom: 400 } };
    for (const p of layoutCards(narrowed)) {
      expect(p.x).toBeGreaterThan(input.body.right); expect(p.y + p.height / 2).toBe(original[0].y + original[0].height / 2);
    }
    expect(manual).toEqual(moved.relative);
    expect(layoutCards(saved)).toEqual(original);
  });
  it('ignores saved positions in auto mode and restores manual coordinates independently', () => {
    const manual = { side: 'right' as const, xNormalized: 0.3, yOffset: 5 };
    const data = { ...input, anchors: [{ ...input.anchors[0], manual }] };
    const auto = { ...DEFAULT_PREFERENCES, placementMode: 'auto' as const };
    expect(layoutCards({ ...data, preferences: auto })).toEqual(layoutCards({ ...input, preferences: auto }));
    const placed = layoutCards({ ...data, anchors: [...data.anchors, { key: 'b', x: 700, y: 420 }, { key: 'c', x: 710, y: 425, manual }] });
    expect(placed.find(p => p.key === 'a')).toMatchObject({ manual: true, side: 'right', y: 300 + 5 * 24 - 42 });
    expect(placed.find(p => p.key === 'c')).toMatchObject({ manual: true, side: 'right', y: 425 + 5 * 24 - 42 });
    const canonical = layoutCards({ ...input, anchors: [{ ...input.anchors[0] }, { key: 'b', x: 700, y: 420 }, { key: 'c', x: 710, y: 425 }] });
    expect(placed.find(p => p.key === 'b')).toEqual(canonical.find(p => p.key === 'b'));
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
  it('snaps only the moving card to the nearest clear grid row', () => {
    const p = { ...input, preferences: { ...input.preferences!, placementMode: 'snap' as const } };
    const first = positionFromDrop(p, input.anchors[0], 1200, 500, [])!;
    const second = positionFromDrop(p, { key: 'b', x: 700, y: 320 }, 1200, 500, [first.placement])!;
    expect(second.snapped).toBe(true); expect(overlapsCard(first.placement, second.placement)).toBe(false);
    expect(second.placement.x).toBe(first.placement.x);
    expect(Math.abs(second.placement.y - first.placement.y)).toBe(Math.ceil((first.placement.height + 10) / p.preferences.snapGrid) * p.preferences.snapGrid);
  });
  it('scales vertical offsets with line height without clamping static display', () => {
    const manual = { side: 'left' as const, xNormalized: 1, yOffset: 2 };
    const normal = layoutCards({ ...input, anchors: [{ ...input.anchors[0], manual }] })[0];
    const larger = layoutCards({ ...input, lineHeight: 36, anchors: [{ ...input.anchors[0], manual }] })[0];
    expect(larger.y - normal.y).toBe(24);
    const clipped = layoutCards({ ...input, anchors: [{ ...input.anchors[0], manual: { ...manual, yOffset: 80 } }] })[0];
    expect(clipped.y + clipped.height / 2).toBe(input.anchors[0].y + 80 * 24);
  });
  it.each(['free', 'snap', 'manual'] as const)('leaves the original card in place when a %s drop has no clear row', placementMode => {
    const data = { ...input, height: 150, viewport: { ...input.viewport, top: 0, bottom: 150 },
      preferences: { ...input.preferences!, placementMode } };
    const occupied = [{ key: 'neighbour', side: 'right' as const, x: 1130, y: 30, width: 84, height: 84, compact: false }];
    expect(positionFromDrop(data, input.anchors[0], 1172, 75, occupied)).toBeUndefined();
    const beside = positionFromDrop(data, input.anchors[0], 1328, 75, occupied)!;
    expect(beside).toBeDefined(); expect(overlapsCard(beside.placement, occupied[0])).toBe(false);
  });
});
describe('connector geometry', () => {
  const text = { left: 90, top: 40, right: 150, bottom: 60 };
  it.each(['curve', 'straight', 'elbow'] as const)('only uses vertical text midpoints for %s', style => {
    for (const x of [0, 200]) {
      const route = connectorRoute([text], { x, y: 40, width: 20, height: 20 }, style)!;
      expect(['top', 'bottom']).toContain(route.choice.source);
      expect(route.path.startsWith(`M 120 ${route.choice.source === 'top' ? 40 : 60}`)).toBe(true);
    }
  });
  it('selects a reachable wrapped fragment independently of the layout reference', () => {
    const lines = [text, { left: 10, top: 66, right: 50, bottom: 86 }];
    expect(connectorRoute(lines, { x: 180, y: 40, width: 20, height: 20 })?.choice.fragment).toBe(0);
    expect(connectorRoute(lines, { x: -40, y: 66, width: 20, height: 20 })?.choice.fragment).toBe(1);
  });
  it('keeps chosen ports when an equivalent route only improves slightly', () => {
    const square = { left: 0, right: 20, top: 0, bottom: 20 };
    const diagonal = { x: 100, y: 100, width: 20, height: 20 };
    const route = connectorRoute([square], diagonal)!;
    expect(connectorRoute([square], { ...diagonal, y: 101 }, 'curve', route.choice)?.choice).toEqual(route.choice);
  });
  it('rejects invalid anchor coordinates', () => {
    expect(connectorRoute([{ ...text, left: NaN, right: NaN }], { x: 0, y: 0, width: 20, height: 20 })).toBeUndefined();
  });
});
