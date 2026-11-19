import type { Box, CardShape, Preferences, RelativePosition, Side } from '../types';
export type { Box } from '../types';
export interface LayoutAnchor { key: string; x: number; y: number; preferred?: Side; manual?: RelativePosition & { initial?: true } }
export interface LayoutInput {
  width: number; height: number; body: Box; viewport: Box;
  anchors: LayoutAnchor[]; density: Preferences['density']; layout: Preferences['layout'];
  preferences?: Preferences; lineHeight?: number;
}
export interface Placement {
  key: string; side: Side; x: number; y: number; width: number; height: number;
  compact: boolean; shape?: CardShape; manual?: boolean;
}
const CARD_GAP = 10;

/** Pack each automatic column in document coordinates. A stack with colliding
 * desired tops shares the displacement equally, so a dense cluster doesn't
 * push a long chain of otherwise well-spaced cards down the page. */
export function packInitialSlots(slots: Placement[]): Map<string, number> {
  const tops = new Map<string, number>();
  for (const side of ['left', 'right'] as const) {
    const column = slots.filter(card => card.side === side).sort((a, b) => a.y - b.y || a.key.localeCompare(b.key));
    const stacks: { start: number; count: number; mean: number }[] = [];
    // Subtract cumulative heights and gaps: separation now requires only
    // nondecreasing tops. Pool adjacent out-of-order blocks at their mean.
    let occupied = 0;
    for (let i = 0; i < column.length; i++) {
      const card = column[i], stack = { start: i, count: 1, mean: card.y - occupied };
      occupied += card.height + CARD_GAP;
      while (stacks.length && stacks[stacks.length - 1].mean > stack.mean) {
        const before = stacks.pop()!;
        stack.mean = (before.mean * before.count + stack.mean * stack.count) / (before.count + stack.count);
        stack.count += before.count;
        stack.start = before.start;
      }
      stacks.push(stack);
    }
    occupied = 0;
    for (const stack of stacks) for (let i = stack.start; i < stack.start + stack.count; i++) {
      const card = column[i];
      if (stack.count > 1) tops.set(card.key, stack.mean + occupied);
      occupied += card.height + CARD_GAP;
    }
  }
  return tops;
}
// Pointer coordinates hit-test the lane; the grab point only positions the card.
// Omitted for keyboard movement, which intentionally uses the card's centre.
export interface GrabPoint { u: number; v: number }
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function lane(input: LayoutInput, side: Side): Box {
  const pad = input.preferences?.edgePadding ?? 16;
  return {
    left: side === 'left' ? Math.max(0, input.viewport.left) + 8 : input.body.right + pad,
    right: side === 'left' ? input.body.left - pad : Math.min(input.width, input.viewport.right) - 8,
    top: Math.max(8, input.viewport.top + 8), bottom: Math.min(input.height - 8, input.viewport.bottom - 8)
  };
}
export function dimensions(input: LayoutInput, side: Side): { width: number; height: number; shape: CardShape } | undefined {
  const band = lane(input, side), space = band.right - band.left;
  const p = input.preferences;
  const size = p?.cardSize ?? 'medium';
  const icon = { small: 32, medium: 36, large: 44 }[size];
  if (space < icon) return;
  let shape = p?.cardShape ?? 'horizontal';
  if (input.density === 'compact') shape = 'icon';
  const square = { small: 76, medium: 84, large: 92 }[size];
  const width = { small: 164, medium: 196, large: 220 }[size];
  if ((shape === 'square' && space < square) || (shape === 'horizontal' && space < 128)) shape = 'icon';
  return { shape, width: shape === 'icon' ? icon : shape === 'square' ? square : Math.min(width, space),
    height: shape === 'icon' ? icon : shape === 'square' ? square : { small: 44, medium: 48, large: 56 }[size] };
}
export function overlapsCard(a: Placement, b: Placement, gap = CARD_GAP): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
function legalize(candidate: Placement, input: LayoutInput, occupied: Placement[]): Placement | undefined {
  const band = lane(input, candidate.side);
  if (candidate.height > band.bottom - band.top) return;
  const x = clamp(candidate.x, band.left, band.right - candidate.width);
  const target = clamp(candidate.y, band.top, band.bottom - candidate.height);
  // User-directed placement may intentionally overlap another card. Only the
  // moving card is clamped to its lane; automatic solving owns collision gaps.
  if (input.preferences && input.preferences.placementMode !== 'auto') return { ...candidate, x, y: target };
  const ys = [target, ...occupied.flatMap(c => [c.y + c.height + CARD_GAP, c.y - candidate.height - CARD_GAP])]
    .filter(y => y >= band.top && y + candidate.height <= band.bottom).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
  for (const y of ys) {
    const card = { ...candidate, x, y };
    if (!occupied.some(c => overlapsCard(card, c))) return card;
  }
}
export function positionFromDrop(input: LayoutInput, anchor: LayoutAnchor, x: number, y: number, occupied: Placement[], grabPoint: GrabPoint = { u: 0.5, v: 0.5 }): { placement: Placement; relative: RelativePosition; snapped: boolean } | undefined {
  if (![x, y, grabPoint.u, grabPoint.v, input.width, input.height, ...Object.values(input.body), ...Object.values(input.viewport), anchor.y].every(Number.isFinite) ||
      input.width <= 0 || input.height <= 0 || grabPoint.u < 0 || grabPoint.u > 1 || grabPoint.v < 0 || grabPoint.v > 1) return;
  const side = x < input.body.left ? 'left' : x > input.body.right ? 'right' : undefined;
  if (!side) return;
  const band = lane(input, side), dim = dimensions(input, side);
  if (!dim || x < band.left || x > band.right || y < band.top || y > band.bottom) return;
  let left = x - dim.width * grabPoint.u, top = y - dim.height * grabPoint.v;
  const snap = input.preferences?.placementMode === 'snap';
  if (snap) {
    const grid = input.preferences?.snapGrid ?? 12;
    left = band.left + Math.round((left - band.left) / grid) * grid;
    top = band.top + Math.round((top - band.top) / grid) * grid;
  }
  const placement = legalize({ key: anchor.key, side, x: left, y: top, ...dim, compact: dim.shape === 'icon', manual: true }, input, occupied);
  if (!placement) return;
  const relative = positionRelative(input, anchor, placement);
  if (!relative) return;
  return { placement, snapped: snap || Math.abs(placement.y - top) > 1, relative: { ...relative, yOffset: clamp(relative.yOffset, -80, 80) } };
}
/** Map the actual displayed card to text-relative UI coordinates. Unlike a
 * drop, a snapshot must not clamp its vertical offset and silently move it.
 * The caller checks the storage budget before persisting an exact snapshot. */
export function positionRelative(input: LayoutInput, anchor: LayoutAnchor, placement: Placement): RelativePosition | undefined {
  const band = lane(input, placement.side), lineHeight = input.lineHeight ?? 24;
  if (![placement.x, placement.y, placement.width, placement.height, anchor.y, ...Object.values(band), lineHeight].every(Number.isFinite) ||
      lineHeight <= 0 || placement.width <= 0 || placement.height <= 0) return;
  const range = band.right - band.left - placement.width;
  if (range < -0.000001 || placement.x < band.left - 0.000001 || placement.x > band.right - placement.width + 0.000001) return;
  return { side: placement.side,
    xNormalized: range > 0 ? clamp((placement.x - band.left) / range, 0, 1) : 0,
    yOffset: (placement.y + placement.height / 2 - anchor.y) / lineHeight };
}
// Static display is unbounded vertically. Only a drop is constrained to the
// viewport; scrolling must never push a card away from its text reference.
export function displayPosition(candidate: Placement, input: LayoutInput, occupied: Placement[]): Placement {
  const band = lane(input, candidate.side);
  const x = clamp(candidate.x, band.left, band.right - candidate.width);
  const exact = { ...candidate, x };
  if (!occupied.some(c => overlapsCard(exact, c))) return exact;
  const ys = [candidate.y, ...occupied.flatMap(c => [c.y + c.height + CARD_GAP, c.y - candidate.height - CARD_GAP])]
    .sort((a, b) => Math.abs(a - candidate.y) - Math.abs(b - candidate.y) || a - b);
  for (const y of ys) {
    const card = { ...candidate, x, y };
    if (!occupied.some(c => overlapsCard(card, c))) return card;
  }
  return { ...candidate, x }; // Finite occupied rectangles always leave an outer slot.
}
export function layoutCards(input: LayoutInput, occupied: Placement[] = []): Placement[] {
  if (![input.width, input.height, ...Object.values(input.body), ...Object.values(input.viewport)].every(Number.isFinite) || input.width <= 0 || input.height < 36) return [];
  const p = input.preferences;
  if (p?.placementMode === 'manual') {
    // Each missing position has a local, repeatable starting point. Neither
    // viewport arrival order, other cards nor automatic side preferences may
    // rebalance a completely manual note. A user may deliberately overlap it.
    return input.anchors.filter(a => Number.isFinite(a.x) && Number.isFinite(a.y)).flatMap(a => {
      const saved = a.manual;
      const side = saved?.side ?? a.preferred ?? (Math.abs(a.x - input.body.left) <= Math.abs(a.x - input.body.right) ? 'left' : 'right');
      const dim = dimensions(input, side);
      if (!dim) return []; // Keep this side; temporarily unavailable is not a move.
      const band = lane(input, side);
      return [{ key: a.key, side, ...dim,
        x: saved ? band.left + saved.xNormalized * Math.max(0, band.right - band.left - dim.width) : side === 'left' ? band.right - dim.width : band.left,
        y: a.y + (saved?.yOffset ?? 0) * (input.lineHeight ?? 24) - dim.height / 2,
        compact: dim.shape === 'icon', manual: !!saved }];
    });
  }
  const manualMode = p && p.placementMode !== 'auto';
  if (manualMode && input.anchors.some(a => a.manual)) {
    // Derive every automatic slot from the same occurrence set first. A saved
    // manual card must not change unedited cards' initial sides or ordering.
    const automatic = layoutCards({ ...input, preferences: { ...p!, placementMode: 'auto' } }, occupied);
    const anchors = new Map(input.anchors.map(a => [a.key, a]));
    const restored = automatic.flatMap(card => {
      const anchor = anchors.get(card.key)!, saved = anchor.manual;
      if (!saved) return [card];
      const dim = dimensions(input, saved.side);
      if (!dim) return []; // Retain the saved record while its lane is unavailable.
      const band = lane(input, saved.side);
      return [{ ...card, ...dim, side: saved.side,
        x: band.left + saved.xNormalized * Math.max(0, band.right - band.left - dim.width),
        y: anchor.y + saved.yOffset * (input.lineHeight ?? 24) - dim.height / 2,
        compact: dim.shape === 'icon', manual: true }];
    });
    if (!input.anchors.some(a => a.manual?.initial) || restored.length < 2) return restored;
    const initial = new Map(restored.filter(card => anchors.get(card.key)?.manual?.initial).map(card => [card.key, card]));
    const packed = packInitialSlots([...occupied, ...automatic.map(card => initial.get(card.key) ?? card)]);
    return restored.map(card => {
      const saved = anchors.get(card.key)?.manual;
      return saved && !saved.initial ? card : { ...card, y: packed.get(card.key) ?? card.y };
    });
  }
  const output: Placement[] = [];
  const ordered = [...input.anchors].filter(a => Number.isFinite(a.x) && Number.isFinite(a.y))
    .sort((a, b) => Number(!!(manualMode && b.manual)) - Number(!!(manualMode && a.manual)) || a.y - b.y || a.key.localeCompare(b.key));
  const counts = { left: occupied.filter(c => c.side === 'left').length, right: occupied.filter(c => c.side === 'right').length };
  for (const a of ordered) {
    const saved = manualMode ? a.manual : undefined;
    const sides = (['left', 'right'] as Side[]).filter(s => dimensions(input, s));
    const score = (side: Side) => Math.abs(a.x - (side === 'left' ? input.body.left : input.body.right)) + counts[side] * Math.max(100, (input.body.right - input.body.left) * 0.45) - (a.preferred === side ? input.width * 2 : 0) - (input.layout === side ? input.width : 0);
    const side = saved?.side ?? sides.sort((a, b) => score(a) - score(b))[0];
    if (!side) continue;
    const dim = dimensions(input, side);
    if (!dim) continue; // Saved side temporarily unavailable: hide, never overwrite the record.
    const band = lane(input, side);
    const x = saved ? band.left + saved.xNormalized * Math.max(0, band.right - band.left - dim.width) : side === 'left' ? band.right - dim.width : band.left;
    const y = a.y + (saved?.yOffset ?? 0) * (input.lineHeight ?? 24) - dim.height / 2;
    const candidate = { key: a.key, side, x, y, ...dim, compact: dim.shape === 'icon', manual: !!saved };
    // A persisted manual position is the user's exact relative placement,
    // including deliberate overlap. Never legalize it against neighbouring UI.
    const card = saved ? candidate : displayPosition(candidate, input, [...occupied, ...output]);
    if (card) { counts[side]++; output.push(card); }
  }
  return output;
}
