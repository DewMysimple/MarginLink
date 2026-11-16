import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, readPreferences } from '../src/types';
import { LayoutStore, readLayouts, readStoredData, MAX_LAYOUTS, MAX_LAYOUT_AGE } from '../src/core/layout-store';
import { layoutIdentities, legacyLayoutIdentities } from '../src/core/layout-identity';
import { parseWikilinks } from '../src/core/wikilink-parser';

const now = Date.now();
const record = { source: 'Notes/A.md', key: 'a'.repeat(64), side: 'left', xNormalized: 0.4, yOffset: -2, updated: now };
const ids = (text: string) => layoutIdentities(text, parseWikilinks(text));
describe('v0.2 UI data whitelist and migration', () => {
  it('preserves every supplied legacy preference while using current defaults for missing fields', () => {
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
    expect(p.cardShape).toBe('square');
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
  it('commits each source immediately and reconciles only its complete document', () => {
    const a = 'A context [[Shared|same target]] A tail', b = 'B context [[Shared|same target]] B tail';
    const keyA = [...ids(a).values()][0], keyB = [...ids(b).values()][0];
    const store = new LayoutStore([], () => {});
    const aPosition = { side: 'right' as const, xNormalized: 0.8, yOffset: 12 };
    const bPosition = { side: 'left' as const, xNormalized: 0.2, yOffset: -3 };
    store.set('A.md', keyA, aPosition);
    store.set('B.md', keyB, bPosition);
    // No timer, flush, or persistence round trip is necessary for A → B → A.
    store.reconcileDocument('B.md', b);
    expect(store.get('B.md', keyB)).toEqual(bPosition);
    store.reconcileDocument('A.md', a);
    expect(store.get('A.md', keyA)).toEqual(aPosition);
    store.reconcileDocument('A.md', a.replace('[[Shared|same target]]', 'removed'));
    expect(store.get('A.md', keyA)).toBeUndefined();
    expect(store.get('B.md', keyB)).toEqual(bPosition);
  });
  it('preserves LF editor and historical CRLF preview identities until actual deletion', () => {
    const lf = 'Context before\n[[Shared|same target]]\nContext after';
    const crlf = lf.replaceAll('\n', '\r\n');
    const store = new LayoutStore([], () => {});
    const keys = [...ids(lf).values(), ...legacyLayoutIdentities(crlf, parseWikilinks(crlf)).values()];
    for (const key of keys) store.set('A.md', key, { side: 'right', xNormalized: 0.5, yOffset: 2 });
    store.reconcileDocument('A.md', crlf);
    expect(store.snapshot()).toHaveLength(1);
    store.reconcileDocument('A.md', crlf.replace('[[Shared|same target]]', 'removed'));
    expect(store.snapshot()).toEqual([]);
  });
  it('keeps unrelated layouts on rename/delete and migrates only matching source paths', () => {
    let changes = 0;
    const store = new LayoutStore([], () => changes++), key = 'd'.repeat(64);
    const position = { side: 'right' as const, xNormalized: 0.6, yOffset: 7 };
    for (const source of ['Folder/A.md', 'Folder/Nested/B.md', 'Folder2/C.md']) store.set(source, key, position);
    const saved = store.snapshot();
    store.renameSource('unrelated.png', 'unrelated-new.png'); store.deleteSource('unrelated-new.png');
    expect(store.snapshot()).toEqual(saved); expect(changes).toBe(3);
    store.renameSource('Folder', 'Moved');
    expect(store.get('Moved/A.md', key)).toEqual(position);
    expect(store.get('Moved/Nested/B.md', key)).toEqual(position);
    expect(store.get('Folder2/C.md', key)).toEqual(position);
    store.renameSource('Moved/A.md', 'Moved/Renamed.md');
    expect(store.get('Moved/A.md', key)).toBeUndefined();
    expect(store.get('Moved/Renamed.md', key)).toEqual(position);
    store.deleteSource('Moved');
    expect(store.snapshot().map(e => e.source)).toEqual(['Folder2/C.md']);
  });
});
