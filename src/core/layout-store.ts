import { readPreferences, type PersistedLayout, type RelativePosition, type StoredData } from '../types';

export const MAX_LAYOUTS = 500;
export const MAX_NOTE_LAYOUTS = 100;
export const MAX_LAYOUT_AGE = 90 * 24 * 60 * 60 * 1000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function readLayouts(value: unknown, now = Date.now()): PersistedLayout[] {
  if (!Array.isArray(value)) return [];
  const candidates: PersistedLayout[] = [];
  // Bounded work on damaged input as well as bounded output.
  for (const entry of value.slice(0, MAX_LAYOUTS * 4)) {
    if (!object(entry) || !['source', 'key', 'side', 'xNormalized', 'yOffset', 'updated'].every(k => Object.hasOwn(entry, k))) continue;
    const { source, key, side, xNormalized, yOffset, updated } = entry;
    if (typeof source !== 'string' || source.length > 1024 || !source.endsWith('.md') || source.includes('\\') || [...source].some(c => c.charCodeAt(0) < 32) || source.startsWith('/') || source.split('/').some(p => p === '..' || p === '.' || !p) || /^[A-Za-z]:/.test(source)) continue;
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || (side !== 'left' && side !== 'right')) continue;
    if (typeof xNormalized !== 'number' || !Number.isFinite(xNormalized) || xNormalized < 0 || xNormalized > 1) continue;
    if (typeof yOffset !== 'number' || !Number.isFinite(yOffset) || Math.abs(yOffset) > 80) continue;
    if (typeof updated !== 'number' || !Number.isFinite(updated) || updated < now - MAX_LAYOUT_AGE || updated > now + 60000) continue;
    candidates.push({ source, key, side, xNormalized, yOffset, updated });
  }
  const seen = new Set<string>(), notes = new Map<string, number>();
  return candidates.sort((a, b) => b.updated - a.updated).filter(e => {
    const id = JSON.stringify([e.source, e.key]);
    if (seen.has(id) || (notes.get(e.source) ?? 0) >= MAX_NOTE_LAYOUTS) return false;
    seen.add(id); notes.set(e.source, (notes.get(e.source) ?? 0) + 1); return true;
  }).slice(0, MAX_LAYOUTS);
}
export function readStoredData(value: unknown, now = Date.now()): StoredData {
  if (!object(value)) return { schemaVersion: 2, preferences: readPreferences(null), layouts: [] };
  if (Object.hasOwn(value, 'schemaVersion')) {
    // Unknown future schemas must not be interpreted as today's layout records.
    return { schemaVersion: 2, preferences: readPreferences(value.preferences), layouts: value.schemaVersion === 2 ? readLayouts(value.layouts, now) : [] };
  }
  return { schemaVersion: 2, preferences: readPreferences(value), layouts: [] };
}

export class LayoutStore {
  private records: PersistedLayout[];
  constructor(records: PersistedLayout[], private changed: () => void) { this.records = readLayouts(records); }
  snapshot(): PersistedLayout[] { return readLayouts(this.records); }
  get(source: string, key?: string): RelativePosition | undefined {
    const e = this.records.find(e => e.source === source && e.key === key && Date.now() - e.updated <= MAX_LAYOUT_AGE);
    return e ? { side: e.side, xNormalized: e.xNormalized, yOffset: e.yOffset } : undefined;
  }
  set(source: string, key: string, position: RelativePosition): void {
    this.records = readLayouts([{ source, key, ...position, updated: Date.now() }, ...this.records.filter(e => e.source !== source || e.key !== key)]);
    this.changed();
  }
  clear(source?: string, key?: string): void {
    const next = this.records.filter(e => source !== undefined && (e.source !== source || (key !== undefined && e.key !== key)));
    if (next.length === this.records.length) return;
    this.records = next; this.changed();
  }
  reconcile(source: string, valid: Set<string>): void {
    const next = this.records.filter(e => e.source !== source || valid.has(e.key));
    if (next.length !== this.records.length) { this.records = next; this.changed(); }
  }
}
