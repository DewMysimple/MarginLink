import type { CardShape, Preferences, RelativePosition, Side } from '../types';
export interface Box { left: number; right: number; top: number; bottom: number }
export interface LayoutAnchor { key: string; x: number; y: number; preferred?: Side; manual?: RelativePosition }
export interface LayoutInput {
  width: number; height: number; body: Box; viewport: Box;
  anchors: LayoutAnchor[]; density: Preferences['density']; layout: Preferences['layout'];
  preferences?: Preferences; lineHeight?: number;
}
export interface Placement {
  key: string; side: Side; x: number; y: number; width: number; height: number;
  compact: boolean; shape?: CardShape; manual?: boolean;
}
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
export function overlapsCard(a: Placement, b: Placement, gap = 10): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
function legalize(candidate: Placement, input: LayoutInput, occupied: Placement[]): Placement | undefined {
  const band = lane(input, candidate.side);
  if (candidate.height > band.bottom - band.top) return;
  const x = clamp(candidate.x, band.left, band.right - candidate.width);
  const target = clamp(candidate.y, band.top, band.bottom - candidate.height);
  const ys = [target, ...occupied.flatMap(c => [c.y + c.height + 10, c.y - candidate.height - 10])]
    .filter(y => y >= band.top && y + candidate.height <= band.bottom).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
  for (const y of ys) {
    const card = { ...candidate, x, y };
    if (!occupied.some(c => overlapsCard(card, c))) return card;
  }
}
export function positionFromDrop(input: LayoutInput, anchor: LayoutAnchor, x: number, y: number, occupied: Placement[]): { placement: Placement; relative: RelativePosition; snapped: boolean } | undefined {
  if (![x, y].every(Number.isFinite)) return;
  const side = x < input.body.left ? 'left' : x > input.body.right ? 'right' : undefined;
  if (!side) return;
  const band = lane(input, side), dim = dimensions(input, side);
  if (!dim || x < band.left || x > band.right || y < band.top || y > band.bottom) return;
  let left = x - dim.width / 2, top = y - dim.height / 2;
  const snap = input.preferences?.placementMode === 'snap';
  if (snap) {
    const grid = input.preferences?.snapGrid ?? 12;
    left = band.left + Math.round((left - band.left) / grid) * grid;
    top = band.top + Math.round((top - band.top) / grid) * grid;
    const aligned = occupied.find(c => c.side === side && Math.abs(c.x - left) <= grid);
    if (aligned) left = aligned.x;
  }
  const placement = legalize({ key: anchor.key, side, x: left, y: top, ...dim, compact: dim.shape === 'icon', manual: true }, input, occupied);
  if (!placement) return;
  return { placement, snapped: snap || Math.abs(placement.y - top) > 1, relative: {
    side, xNormalized: clamp((placement.x - band.left) / Math.max(1, band.right - band.left - placement.width), 0, 1),
    yOffset: clamp((placement.y + placement.height / 2 - anchor.y) / (input.lineHeight ?? 24), -80, 80)
  } };
}
export function layoutCards(input: LayoutInput): Placement[] {
  if (![input.width, input.height, ...Object.values(input.body), ...Object.values(input.viewport)].every(Number.isFinite) || input.width <= 0 || input.height < 36) return [];
  const p = input.preferences;
  const manualMode = p && p.placementMode !== 'auto';
  const output: Placement[] = [];
  const ordered = [...input.anchors].filter(a => Number.isFinite(a.x) && Number.isFinite(a.y) && a.y >= input.viewport.top && a.y <= input.viewport.bottom)
    .sort((a, b) => Number(!!(manualMode && b.manual)) - Number(!!(manualMode && a.manual)) || a.y - b.y || a.key.localeCompare(b.key));
  const counts = { left: 0, right: 0 };
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
    const card = legalize({ key: a.key, side, x, y, ...dim, compact: dim.shape === 'icon', manual: !!saved }, input, output);
    if (card) { counts[side]++; output.push(card); }
  }
  return output;
}
