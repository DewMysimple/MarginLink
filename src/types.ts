import type { TFile } from 'obsidian';

export type Side = 'left' | 'right';
export interface WikilinkOccurrence {
  raw: string;
  start: number;
  end: number;
  target: string;
  alias?: string;
  label: string;
}
export interface Range { start: number; end: number }
export interface ResolvedLink { file: TFile | null; subpath: string; target: string }
export interface Anchor {
  key: string;
  occurrence: WikilinkOccurrence;
  rect: DOMRect;
  element?: HTMLElement;
  layoutKey?: string;
}
export type LineMode = 'none' | 'hover' | 'always';
export type LineStyle = 'curve' | 'straight' | 'elbow';
export type CardShape = 'horizontal' | 'square' | 'icon';
export type PlacementMode = 'auto' | 'free' | 'snap';
export interface Preferences {
  enabled: boolean;
  lines: LineMode;
  density: 'auto' | 'compact';
  layout: 'balanced' | 'left' | 'right';
  placementMode: PlacementMode;
  lineStyle: LineStyle;
  lineWidth: number;
  lineOpacity: number;
  lineColor: 'theme' | 'purple' | 'blue' | 'green' | 'gray';
  cardShape: CardShape;
  cardSize: 'small' | 'medium' | 'large';
  cardRadius: number;
  cardBorder: boolean;
  cardShadow: 'none' | 'subtle' | 'strong';
  showPath: boolean;
  edgePadding: number;
  snapGrid: number;
  hoverFeedback: boolean;
  dragHints: boolean;
  reduceMotion: boolean;
}
export const DEFAULT_PREFERENCES: Preferences = {
  enabled: true, lines: 'hover', density: 'auto', layout: 'balanced', placementMode: 'auto',
  lineStyle: 'curve', lineWidth: 1.5, lineOpacity: 0.65, lineColor: 'theme',
  cardShape: 'horizontal', cardSize: 'medium', cardRadius: 8, cardBorder: true,
  cardShadow: 'subtle', showPath: true, edgePadding: 16, snapGrid: 12,
  hoverFeedback: true, dragHints: true, reduceMotion: false
};
export function ownRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(DEFAULT_PREFERENCES)) if (Object.hasOwn(value, key)) result[key] = (value as Record<string, unknown>)[key];
  return result;
}
export function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
// Explicit whitelist; prototype/injected relation properties never enter preferences.
export function readPreferences(value: unknown): Preferences {
  const v = ownRecord(value);
  const choice = <T extends string>(key: keyof Preferences, values: readonly T[], fallback: T): T => values.includes(v[key] as T) ? v[key] as T : fallback;
  const bool = (key: keyof Preferences) => typeof v[key] === 'boolean' ? v[key] as boolean : DEFAULT_PREFERENCES[key] as boolean;
  return {
    enabled: bool('enabled'),
    lines: choice('lines', ['none', 'hover', 'always'], 'hover'),
    density: v.density === 'compact' ? 'compact' : 'auto',
    layout: choice('layout', ['balanced', 'left', 'right'], 'balanced'),
    placementMode: choice('placementMode', ['auto', 'free', 'snap'], 'auto'),
    lineStyle: choice('lineStyle', ['curve', 'straight', 'elbow'], 'curve'),
    lineWidth: Math.round(finiteNumber(v.lineWidth, 1.5, 1, 5) * 2) / 2,
    lineOpacity: finiteNumber(v.lineOpacity, 0.65, 0.1, 1),
    lineColor: choice('lineColor', ['theme', 'purple', 'blue', 'green', 'gray'], 'theme'),
    cardShape: choice('cardShape', ['horizontal', 'square', 'icon'], 'horizontal'),
    cardSize: choice('cardSize', ['small', 'medium', 'large'], 'medium'),
    cardRadius: finiteNumber(v.cardRadius, 8, 0, 20), cardBorder: bool('cardBorder'),
    cardShadow: choice('cardShadow', ['none', 'subtle', 'strong'], 'subtle'), showPath: bool('showPath'),
    edgePadding: finiteNumber(v.edgePadding, 16, 8, 32), snapGrid: finiteNumber(v.snapGrid, 12, 4, 32),
    hoverFeedback: bool('hoverFeedback'), dragHints: bool('dragHints'), reduceMotion: bool('reduceMotion')
  };
}
export interface RelativePosition { side: Side; xNormalized: number; yOffset: number }
// yOffset is measured in current text line heights; never a window pixel coordinate.
export interface PersistedLayout extends RelativePosition { source: string; key: string; updated: number }
export interface StoredData { schemaVersion: 2; preferences: Preferences; layouts: PersistedLayout[] }
