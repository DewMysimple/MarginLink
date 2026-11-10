import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, readPreferences } from '../src/types';
import { LayoutStore, readLayouts, readStoredData, MAX_LAYOUTS, MAX_LAYOUT_AGE } from '../src/core/layout-store';
import { layoutIdentities } from '../src/core/layout-identity';
import { parseWikilinks } from '../src/core/wikilink-parser';

const now = Date.now();
const record = { source: 'Notes/A.md', key: 'a'.repeat(64), side: 'left', xNormalized: 0.4, yOffset: -2, updated: now };
const ids = (text: string) => layoutIdentities(text, parseWikilinks(text));
describe('v0.2 UI data whitelist and migration', () => {
  it('preserves every legacy preference and its auto placement semantics', () => {
    expect(readStoredData({ enabled: false, lines: 'always', density: 'compact', layout: 'right' })).toEqual({ schemaVersion: 2,
      preferences: { ...DEFAULT_PREFERENCES, enabled: false, lines: 'always', density: 'compact', layout: 'right' }, layouts: [] });
  });
  it.each(['none', 'hover', 'always'])('reads line mode %s without introducing relationships', lines => {
    expect(readPreferences({ lines, graph: ['x'] }).lines).toBe(lines);
    expect(Object.keys(readPreferences({ lines, graph: ['x'] }))).not.toContain('graph');
  });
  it('bounds numeric values and rejects non-finite or inherited controls', () => {
    const p = readPreferences({ lineWidth: 8, lineOpacity: 0, cardRadius: NaN, snapGrid: Infinity, cardShape: 'script', edgePadding: -10 });
    expect([p.lineWidth, p.lineOpacity, p.cardRadius, p.snapGrid, p.edgePadding]).toEqual([5, 0.1, 8, 12, 8]);
    expect(p.cardShape).toBe('horizontal');
    expect(readPreferences(Object.create({ enabled: false }))).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences({ lineWidth: 1.74 }).lineWidth).toBe(1.5);
  });
  it.each([null, [], 'bad', 2])('handles malformed data %s', data => {
    expect(readStoredData(data)).toEqual({ schemaVersion: 2, preferences: DEFAULT_PREFERENCES, layouts: [] });
  });
  it('accepts only known schema layouts and strips injected fields', () => {
    const data = readStoredData({ schemaVersion: 2, preferences: { lines: 'none' }, layouts: [{ ...record, relations: ['bad'], text: 'sensitive' }] });
    expect(data.layouts).toEqual([record]); expect(data.preferences.lines).toBe('none');
    expect(readStoredData({ schemaVersion: 999, layouts: [record] }).layouts).toEqual([]);
  });
  it.each([{ source: '../A.md' }, { source: 'C:/A.md' }, { source: '/A.md' }, { source: 'A\\B.md' }, { key: 'offset:32' }, { yOffset: Infinity }, { yOffset: 81 }, { xNormalized: -1 }, { updated: now + 90000 }, { updated: now - MAX_LAYOUT_AGE - 1 }, { side: 'body' }])('discards unsafe record %j', patch => {
    expect(readLayouts([{ ...record, ...patch }], now)).toEqual([]);
  });
  it('deduplicates, expires, and bounds per-note/global records', () => {
    expect(readLayouts([record, { ...record, yOffset: 9, updated: now - 1 }], now)).toEqual([record]);
    const many = Array.from({ length: 1200 }, (_, i) => ({ ...record, source: `${Math.floor(i / 150)}.md`, key: i.toString(16).padStart(64, '0') }));
    const valid = readLayouts(many, now); expect(valid.length).toBe(MAX_LAYOUTS);
    expect(valid.filter(e => e.source === '0.md').length).toBe(100);
  });
});
describe('weak occurrence identity and UI-only store', () => {
  it('survives distant prefix insertion without using offsets', () => {
    const source = 'Paragraph '.repeat(20) + 'before [[A|same]] after ' + 'tail '.repeat(20);
    expect([...ids(source).values()]).toEqual([...ids('inserted\n'.repeat(200) + source).values()]);
    expect([...ids(source).values()]).toEqual([...ids(('inserted\n'.repeat(200) + source).slice(1500)).values()]);
    expect([...ids(source).values()]).toEqual([...ids(source.slice(50)).values()]);
  });
  it('distinguishes repeated targets using local contexts', () => {
    const text = 'one [[A|same]] alpha\n\n' + 'gap '.repeat(40) + 'two [[A|same]] beta';
    const keys = [...ids(text).values()]; expect(keys.length).toBe(2); expect(new Set(keys).size).toBe(2);
    expect([...ids(text.replace('one [[A|same]]', 'removed')).values()]).not.toContain(keys[0]);
    // Population change invalidates all identical-raw siblings rather than guessing.
    expect([...ids(text.replace('one [[A|same]]', 'removed')).values()]).not.toContain(keys[1]);
  });
  it('refuses indistinguishable contexts, and hashes rather than copies text', () => {
    const paragraph = 'same '.repeat(20) + '[[A|private alias]]' + 'same '.repeat(20) + '\n';
    expect(ids(paragraph.repeat(3)).size).toBe(0);
    const key = [...ids('private [[A|sensitive]] text').values()][0];
    expect(key).toMatch(/^[0-9a-f]{64}$/); expect(key).not.toContain('sensitive');
  });
  it('restores only requested actual identities, prunes deletion, and scopes clearing', () => {
    let changes = 0;
    const store = new LayoutStore([], () => changes++), key = 'b'.repeat(64);
    store.set('A.md', key, { side: 'right', xNormalized: 0.2, yOffset: 1 });
    store.set('B.md', key, { side: 'left', xNormalized: 0, yOffset: 2 });
    expect(store.get('A.md', 'c'.repeat(64))).toBeUndefined();
    expect(new LayoutStore(store.snapshot(), () => {}).get('A.md', key)?.side).toBe('right');
    store.clear('A.md'); expect(store.get('B.md', key)).toBeDefined();
    store.reconcile('B.md', new Set()); expect(store.snapshot()).toEqual([]);
    expect(changes).toBe(4);
    expect(readStoredData(null).layouts).toEqual([]);
  });
});
