import { readPreferences, type PersistedLayout, type RelativePosition, type StoredData } from '../types';
import { layoutIdentities, legacyLayoutAliases, legacyLayoutIdentities } from './layout-identity';
import { parseWikilinks } from './wikilink-parser';

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
  get(source: string, key?: string, legacyKey?: string): RelativePosition | undefined {
    const e = this.records.find(e => e.source === source && (e.key === key || e.key === legacyKey) && Date.now() - e.updated <= MAX_LAYOUT_AGE);
    return e ? { side: e.side, xNormalized: e.xNormalized, yOffset: e.yOffset } : undefined;
  }
  set(source: string, key: string, position: RelativePosition, legacyKey?: string): void {
    this.records = readLayouts([{ source, key, ...position, updated: Date.now() }, ...this.records.filter(e => e.source !== source || (e.key !== key && e.key !== legacyKey))]);
    this.changed();
  }
  clear(source?: string, key?: string, legacyKey?: string): void {
    const next = this.records.filter(e => source !== undefined && (e.source !== source || (key !== undefined && e.key !== key && e.key !== legacyKey)));
    if (next.length === this.records.length) return;
    this.records = next; this.changed();
  }
  migrateAliases(source: string, aliases: ReadonlyMap<string, string>): void {
    const canonical = new Map<string, string>(), ambiguous = new Set<string>();
    for (const [key, legacy] of aliases) {
      if (key === legacy) continue;
      if (canonical.has(legacy)) ambiguous.add(legacy);
      canonical.set(legacy, key);
    }
    for (const key of ambiguous) canonical.delete(key);
    if (!this.records.some(e => e.source === source && canonical.has(e.key))) return;
    // Preserve coordinates and timestamps. readLayouts merges duplicates by the
    // latest update when both old preview and canonical records already exist.
    this.records = readLayouts(this.records.map(e => e.source === source && canonical.has(e.key) ? { ...e, key: canonical.get(e.key)! } : e));
    this.changed();
  }
  reconcile(source: string, valid: Set<string>): void {
    const next = this.records.filter(e => e.source !== source || valid.has(e.key));
    if (next.length !== this.records.length) { this.records = next; this.changed(); }
  }
  // Call only with the complete source text delivered for this file by the
  // metadata cache. A view's loading editor or preview section is not evidence
  // that links have been deleted from that source note.
  reconcileDocument(source: string, text: string): void {
    if (!this.records.some(e => e.source === source)) return;
    const links = parseWikilinks(text);
    this.migrateAliases(source, legacyLayoutAliases(text, links));
    const keys = new Set(layoutIdentities(text, links).values());
    // Keep both historical raw preview keys and CodeMirror's LF-normalized keys.
    // These still come only from real occurrences in this complete document.
    if (text.includes('\r')) for (const key of legacyLayoutIdentities(text, links).values()) keys.add(key);
    this.reconcile(source, keys);
  }
  renameSource(oldPath: string, newPath: string): void {
    const belongs = (source: string) => source === oldPath || source.startsWith(oldPath + '/');
    if (!this.records.some(e => belongs(e.source))) return;
    this.records = readLayouts(this.records.map(e => belongs(e.source) ? { ...e, source: newPath + e.source.slice(oldPath.length) } : e));
    this.changed();
  }
  deleteSource(path: string): void {
    const next = this.records.filter(e => e.source !== path && !e.source.startsWith(path + '/'));
    if (next.length === this.records.length) return;
    this.records = next; this.changed();
  }
}
