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
}
export interface Preferences {
  enabled: boolean;
  lines: 'hover' | 'always';
  density: 'auto' | 'compact';
  layout: 'balanced' | 'left' | 'right';
}
export const DEFAULT_PREFERENCES: Preferences = {
  enabled: true, lines: 'hover', density: 'auto', layout: 'balanced'
};
// Deliberate whitelist: no link, path, ID or position can enter persisted settings.
export function readPreferences(value: unknown): Preferences {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : true,
    lines: v.lines === 'always' ? 'always' : 'hover',
    density: v.density === 'compact' ? 'compact' : 'auto',
    layout: v.layout === 'left' || v.layout === 'right' ? v.layout : 'balanced'
  };
}
