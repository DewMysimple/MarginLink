import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutIdentities, legacyLayoutAliases, legacyLayoutIdentities } from '../src/core/layout-identity';
import * as parser from '../src/core/wikilink-parser';
import { LayoutStore } from '../src/core/layout-store';

const { parseWikilinks } = parser;
afterEach(() => vi.restoreAllMocks());

describe('layout identity across reading and editing line endings', () => {
  it('uses the same keys with raw reading offsets and LF editor offsets', () => {
    const lf = 'A context\n[[Target|first]]\nmore text\n[[Target|second]]\nA tail';
    const crlf = lf.replaceAll('\n', '\r\n');
    const editorLinks = parseWikilinks(lf), readingLinks = parseWikilinks(crlf);
    const editorKeys = layoutIdentities(lf, editorLinks), readingKeys = layoutIdentities(crlf, readingLinks);
    expect([...readingKeys.values()]).toEqual([...editorKeys.values()]);
    expect([...readingKeys.keys()]).toEqual(readingLinks.map(link => link.start));
    expect([...readingKeys.keys()]).not.toEqual([...editorKeys.keys()]);
  });
  it('reads an existing raw preview record in both modes and merges it on the next move', () => {
    const lf = 'Before\n[[Target|shared]]\nAfter', crlf = lf.replaceAll('\n', '\r\n');
    const rawLinks = parseWikilinks(crlf), canonical = [...layoutIdentities(lf, parseWikilinks(lf)).values()][0];
    const raw = [...legacyLayoutIdentities(crlf, rawLinks).values()][0];
    const aliases = legacyLayoutAliases(crlf, rawLinks);
    const oldPosition = { side: 'left' as const, xNormalized: 0.2, yOffset: 6 };
    const store = new LayoutStore([{ source: 'A.md', key: raw, ...oldPosition, updated: Date.now() }], () => {});
    expect(raw).not.toBe(canonical);
    expect(store.get('A.md', canonical, aliases.get(canonical))).toEqual(oldPosition);
    expect(store.get('A.md', [...layoutIdentities(crlf, rawLinks).values()][0], aliases.get(canonical))).toEqual(oldPosition);
    const moved = { side: 'right' as const, xNormalized: 0.7, yOffset: 12 };
    store.set('A.md', canonical, moved, aliases.get(canonical));
    expect(store.snapshot()).toHaveLength(1); expect(store.snapshot()[0].key).toBe(canonical);
    expect(store.get('A.md', canonical)).toEqual(moved);
    store.set('A.md', raw, oldPosition);
    store.clear('A.md', canonical, aliases.get(canonical));
    expect(store.snapshot()).toEqual([]);
  });
  it('does not use a legacy alias to distinguish otherwise identical normalized occurrences', () => {
    const paragraph = 'same '.repeat(20) + '\n[[Target|same]]\n' + 'same '.repeat(20) + '\n';
    const text = paragraph.replaceAll('\n', '\r\n') + paragraph;
    const links = parseWikilinks(text);
    expect(legacyLayoutIdentities(text, links).size).toBe(2);
    expect(layoutIdentities(text, links).size).toBe(0);
    expect(legacyLayoutAliases(text, links).size).toBe(0);
  });
  it('migrates confirmed raw records before the host normalizes the file to LF', () => {
    const lf = 'Before\n[[Target|shared]]\nAfter', crlf = lf.replaceAll('\n', '\r\n');
    const links = parseWikilinks(crlf), aliases = legacyLayoutAliases(crlf, links);
    const canonical = [...aliases.keys()][0], raw = aliases.get(canonical)!;
    const oldPosition = { side: 'left' as const, xNormalized: 0.2, yOffset: 6 }, updated = Date.now() - 100;
    let changes = 0;
    const store = new LayoutStore([
      { source: 'A.md', key: raw, ...oldPosition, updated },
      { source: 'A.md', key: canonical, side: 'right', xNormalized: 0.7, yOffset: 12, updated: updated - 100 },
      { source: 'B.md', key: raw, ...oldPosition, updated }
    ], () => changes++);
    store.migrateAliases('A.md', aliases);
    expect(store.snapshot().find(e => e.source === 'A.md')).toEqual({ source: 'A.md', key: canonical, ...oldPosition, updated });
    expect(store.get('B.md', raw)).toEqual(oldPosition);
    store.reconcileDocument('A.md', lf);
    expect(store.get('A.md', [...layoutIdentities(lf, parseWikilinks(lf)).values()][0])).toEqual(oldPosition);
    expect(store.get('A.md', [...layoutIdentities(crlf, links).values()][0])).toEqual(oldPosition);
    store.migrateAliases('A.md', aliases);
    expect(changes).toBe(1);
  });
  it('recovers a raw CRLF record even if the first complete cache snapshot is already LF', () => {
    const lf = 'Before\n[[Target|shared]]\nAfter', crlf = lf.replaceAll('\n', '\r\n');
    const raw = [...legacyLayoutIdentities(crlf, parseWikilinks(crlf)).values()][0];
    const canonical = [...layoutIdentities(lf, parseWikilinks(lf)).values()][0];
    const position = { side: 'right' as const, xNormalized: 0.6, yOffset: 9 }, updated = Date.now() - 100;
    const store = new LayoutStore([{ source: 'A.md', key: raw, ...position, updated }], () => {});
    expect(legacyLayoutAliases(lf, parseWikilinks(lf)).get(canonical)).toBe(raw);
    store.reconcileDocument('A.md', lf);
    expect(store.snapshot()).toEqual([{ source: 'A.md', key: canonical, ...position, updated }]);
    expect(store.get('A.md', canonical)).toEqual(position);
  });
  it('skips legacy parsing for notes without layouts and exact snapshots with only canonical keys', () => {
    const text = 'Before\n[[Target|shared]]\nAfter', links = parseWikilinks(text);
    const identities = layoutIdentities(text, links), key = identities.get(links[0].start)!;
    const position = { side: 'left' as const, xNormalized: 0.5, yOffset: 3 };
    const onChange = vi.fn();
    const store = new LayoutStore([{ source: 'Saved.md', key, ...position, updated: Date.now() }], onChange);
    const parse = vi.spyOn(parser, 'parseWikilinks');
    expect(store.migrateLegacyLayouts('No layouts.md', text)).toEqual(new Map());
    expect(store.migrateLegacyLayouts('Saved.md', text, { text, parsed: { links }, identities })).toEqual(new Map());
    expect(store.get('Saved.md', key)).toEqual(position);
    expect(parse).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled();
  });
  it.each(['already LF', 'still CRLF'])('migrates an unmatched raw record when the confirmed file is %s', ending => {
    const lf = 'Before\n[[Target|shared]]\nAfter', crlf = lf.replaceAll('\n', '\r\n');
    const links = parseWikilinks(lf), identities = layoutIdentities(lf, links), key = identities.get(links[0].start)!;
    const raw = [...legacyLayoutIdentities(crlf, parseWikilinks(crlf)).values()][0];
    const position = { side: 'right' as const, xNormalized: 0.5, yOffset: 3 }, updated = Date.now();
    const store = new LayoutStore([{ source: 'A.md', key: raw, ...position, updated }], () => {});
    const parse = vi.spyOn(parser, 'parseWikilinks');
    const confirmed = ending === 'already LF' ? lf : crlf;
    const aliases = store.migrateLegacyLayouts('A.md', confirmed, { text: lf, parsed: { links }, identities });
    // LF reuses the primary parse, CRLF rejects the editor's different offsets.
    expect(parse.mock.calls).toEqual([[crlf]]);
    expect(aliases.get(key)).toBe(raw);
    expect(store.snapshot()).toEqual([{ source: 'A.md', key, ...position, updated }]);
  });
});
