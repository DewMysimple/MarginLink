import { readPreferences, type PersistedLayout, type RelativePosition, type StoredData } from '../types';
import { layoutIdentities, legacyLayoutAliases, legacyLayoutIdentities } from './layout-identity';
import { parseWikilinks, type ParsedDocument } from './wikilink-parser';

export const MAX_LAYOUTS = 500;
export const MAX_NOTE_LAYOUTS = 100;
export const MAX_LAYOUT_AGE = 90 * 24 * 60 * 60 * 1000;
export interface LayoutPosition { key: string; position: RelativePosition; legacyKey?: string; origin?: PersistedLayout['origin'] }
interface LayoutSourceSnapshot {
  text: string;
  parsed: Pick<ParsedDocument, 'links'>;
  identities: ReadonlyMap<number, string>;
}
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
    const origin = entry.origin;
    candidates.push({ source, key, side, xNormalized, yOffset, updated,
      ...(origin === 'manual' || origin === 'initial' ? { origin } : {}) });
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
  // Bounded, session-only UI identity aliases from checked relink transactions.
  // No source text or relationship data is stored. They let native Undo/Redo
  // find the same manual placement before metadata reconciliation runs.
  private relinkAliases = new Map<string, Map<string, Set<string>>>();
  constructor(records: PersistedLayout[], private changed: () => void) { this.records = readLayouts(records); }
  snapshot(): PersistedLayout[] { return readLayouts(this.records); }
  get(source: string, key?: string, legacyKey?: string): (RelativePosition & { initial?: true }) | undefined {
    const keys = this.equivalentKeys(source, key); if (legacyKey) keys.add(legacyKey);
    const e = this.records.find(e => e.source === source && keys.has(e.key) && Date.now() - e.updated <= MAX_LAYOUT_AGE);
    if (!e) return;
    // Before origins were recorded, automatic square/icon/horizontal slots
    // sat flush with the inner lane edge. Preserve other legacy coordinates.
    const initial = e.origin === 'initial' || (!e.origin && e.xNormalized === (e.side === 'left' ? 1 : 0));
    return { side: e.side, xNormalized: e.xNormalized, yOffset: e.yOffset, ...(initial ? { initial: true } : {}) };
  }
  set(source: string, key: string, position: RelativePosition, legacyKey?: string): void {
    this.setMany(source, [{ key, position, legacyKey }], true);
  }
  /** Freeze measured UI positions once. Initialization never evicts another
   * card's saved slot or refreshes timestamps on scroll/render. Explicit user
   * moves may replace old slots under the existing bounded retention policy. */
  setMany(source: string, positions: readonly LayoutPosition[], overwrite = false): void {
    const now = Date.now();
    let next = readLayouts(this.records, now), changed = false;
    for (const { key, position, legacyKey, origin } of positions.slice(0, MAX_NOTE_LAYOUTS)) {
      const keys = this.equivalentKeys(source, key); if (legacyKey) keys.add(legacyKey);
      const exists = next.some(e => e.source === source && keys.has(e.key));
      if (exists && !overwrite) continue;
      const record = readLayouts([{ source, key, ...position, origin: origin ?? (overwrite ? 'manual' : 'initial'), updated: now }], now)[0];
      if (!record) continue;
      if (!exists && !overwrite && (next.length >= MAX_LAYOUTS || next.filter(e => e.source === source).length >= MAX_NOTE_LAYOUTS)) continue;
      next = [record, ...next.filter(e => e.source !== source || !keys.has(e.key))]; changed = true;
    }
    if (!changed) return;
    this.records = readLayouts(next, now); this.changed();
  }
  clear(source?: string, key?: string, legacyKey?: string): void {
    const keys = source && key ? this.equivalentKeys(source, key) : new Set<string>(); if (legacyKey) keys.add(legacyKey);
    const next = this.records.filter(e => source !== undefined && (e.source !== source || (key !== undefined && !keys.has(e.key))));
    if (next.length === this.records.length) return;
    this.records = next; this.changed();
  }
  private equivalentKeys(source: string, key?: string): Set<string> {
    const keys = new Set<string>(); if (!key) return keys;
    const graph = this.relinkAliases.get(source), pending = [key];
    while (pending.length && keys.size < MAX_NOTE_LAYOUTS * 16) {
      const current = pending.pop()!; if (keys.has(current)) continue;
      keys.add(current); for (const other of graph?.get(current) ?? []) pending.push(other);
    }
    return keys;
  }
  preserveRelink(source: string, aliases: ReadonlyMap<string, string>): void {
    let graph = this.relinkAliases.get(source);
    if (!graph) { graph = new Map(); this.relinkAliases.set(source, graph); }
    for (const [key, previous] of aliases) {
      if (!graph.has(key)) graph.set(key, new Set()); graph.get(key)!.add(previous);
      if (!graph.has(previous)) graph.set(previous, new Set()); graph.get(previous)!.add(key);
    }
    // Keep recent transactions useful without creating an unbounded history.
    if (graph.size > MAX_NOTE_LAYOUTS * 16) this.relinkAliases.delete(source);
    if (this.relinkAliases.size > MAX_LAYOUTS) this.relinkAliases.delete(this.relinkAliases.keys().next().value!);
    this.migrateAliases(source, aliases);
  }
  reconcileRelink(source: string, valid: ReadonlySet<string>): void {
    if (!this.relinkAliases.has(source)) return;
    let changed = false;
    const next = this.records.map(record => {
      if (record.source !== source || valid.has(record.key)) return record;
      const matches = [...this.equivalentKeys(source, record.key)].filter(key => valid.has(key));
      if (matches.length !== 1) return record;
      changed = true; return { ...record, key: matches[0] };
    });
    if (changed) { this.records = readLayouts(next); this.changed(); }
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
  // Call with a confirmed full document. Exact source text is required to
  // reuse offsets because an LF editor and a CRLF file can share identities.
  migrateLegacyLayouts(source: string, text: string, snapshot?: LayoutSourceSnapshot): Map<string, string> {
    const saved = this.records.filter(record => record.source === source);
    if (!saved.length) return new Map();
    const exact = snapshot?.text === text ? snapshot : undefined;
    const links = exact?.parsed.links ?? parseWikilinks(text);
    const identities = exact?.identities ?? layoutIdentities(text, links);
    const canonical = new Set(identities.values());
    if (saved.every(record => canonical.has(record.key))) return new Map();
    const aliases = legacyLayoutAliases(text, links, identities);
    this.migrateAliases(source, aliases);
    return aliases;
  }
  reconcile(source: string, valid: Set<string>): void {
    const next = this.records.flatMap(e => {
      if (e.source !== source || valid.has(e.key)) return [e];
      const matches = [...this.equivalentKeys(source, e.key)].filter(key => valid.has(key));
      return matches.length === 1 ? [{ ...e, key: matches[0] }] : [];
    });
    if (next.length !== this.records.length || next.some((e, index) => e.key !== this.records[index]?.key)) { this.records = readLayouts(next); this.changed(); }
  }
  // Call only with the complete source text delivered for this file by the
  // metadata cache. A view's loading editor or preview section is not evidence
  // that links have been deleted from that source note.
  reconcileDocument(source: string, text: string): void {
    if (!this.records.some(e => e.source === source)) return;
    const links = parseWikilinks(text);
    const identities = layoutIdentities(text, links);
    this.migrateLegacyLayouts(source, text, { text, parsed: { links }, identities });
    const keys = new Set(identities.values());
    // Keep both historical raw preview keys and CodeMirror's LF-normalized keys.
    // These still come only from real occurrences in this complete document.
    if (text.includes('\r')) for (const key of legacyLayoutIdentities(text, links).values()) keys.add(key);
    this.reconcile(source, keys);
  }
  renameSource(oldPath: string, newPath: string): void {
    const belongs = (source: string) => source === oldPath || source.startsWith(oldPath + '/');
    for (const [source, aliases] of [...this.relinkAliases]) if (belongs(source)) { this.relinkAliases.delete(source); this.relinkAliases.set(newPath + source.slice(oldPath.length), aliases); }
    if (!this.records.some(e => belongs(e.source))) return;
    this.records = readLayouts(this.records.map(e => belongs(e.source) ? { ...e, source: newPath + e.source.slice(oldPath.length) } : e));
    this.changed();
  }
  deleteSource(path: string): void {
    for (const source of this.relinkAliases.keys()) if (source === path || source.startsWith(path + '/')) this.relinkAliases.delete(source);
    const next = this.records.filter(e => e.source !== path && !e.source.startsWith(path + '/'));
    if (next.length === this.records.length) return;
    this.records = next; this.changed();
  }
}
