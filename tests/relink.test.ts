import { describe, expect, it, vi } from 'vitest';
import { checkedOccurrence, originalLinkText, relinkLayoutAliases, relinkText } from '../src/core/relink';
import { parseWikilinks } from '../src/core/wikilink-parser';
import { layoutIdentities } from '../src/core/layout-identity';
import { LayoutStore } from '../src/core/layout-store';

describe('original text of one Wikilink occurrence', () => {
  it.each([
    ['[[详细分析/Vocabulary/imperative_languages.html|imperative languages]]', 'imperative languages'],
    ['[[same| 原文  text ]]', ' 原文  text '],
    ['[[Folder/Note#标题]]', 'Folder/Note#标题'],
    ['[[Folder/Note#^block|]]', 'Folder/Note#^block']
  ])('extracts only the original text from %s', (raw, expected) => {
    expect(originalLinkText(parseWikilinks(raw)[0])).toBe(expected);
  });
});

describe('one occurrence relinking and layout continuity', () => {
  it('changes only the second identical occurrence and preserves its exact alias and its neighbor placement across undo/redo', () => {
    const before = 'first [[old/a.html|streams]] then [[old/a.html|streams]] [[neighbor|旁卡]] end';
    const links = parseWikilinks(before), occurrence = links[1], replacement = relinkText(occurrence, 'new/b.html');
    const after = before.slice(0, occurrence.start) + replacement + before.slice(occurrence.end);
    expect(after).toBe('first [[old/a.html|streams]] then [[new/b.html|streams]] [[neighbor|旁卡]] end');
    const oldKeys = layoutIdentities(before, links), next = parseWikilinks(after), newKeys = layoutIdentities(after, next);
    const changed = vi.fn(), store = new LayoutStore([], changed);
    const positions = links.map((_, i) => ({ side: 'right' as const, xNormalized: 0.2 + i / 10, yOffset: i + 1 }));
    links.forEach((link, i) => store.set('A.md', oldKeys.get(link.start)!, positions[i]));
    store.preserveRelink('A.md', relinkLayoutAliases(before, after, occurrence.start, occurrence.end, replacement));
    for (const [text, parsed, keys] of [[after, next, newKeys], [before, links, oldKeys], [after, next, newKeys]] as const) {
      // The immediate render precedes metadata reconciliation during Undo/Redo.
      parsed.forEach((link, i) => expect(store.get('A.md', keys.get(link.start))).toEqual(positions[i]));
      store.reconcileRelink('A.md', new Set(keys.values()));
      const reopened = new LayoutStore(store.snapshot(), () => {});
      parsed.forEach((link, i) => expect(reopened.get('A.md', keys.get(link.start))).toEqual(positions[i]));
      store.reconcileDocument('A.md', text);
      parsed.forEach((link, i) => expect(store.get('A.md', keys.get(link.start))).toEqual(positions[i]));
      expect(store.snapshot()).toHaveLength(3);
    }
    expect(JSON.stringify(store.snapshot())).not.toContain('streams');
  });
  it.each(['[[old]]', '[[old|]]', '[[old| 中文 alias ]]'])('preserves alias syntax for %s', raw => {
    const occurrence = parseWikilinks(raw)[0];
    expect(relinkText(occurrence, 'new.xmind', '#^block')).toBe(raw.replace('old', 'new.xmind#^block'));
  });
  it('rejects stale occurrence locations, unsafe filenames and unproven splices', () => {
    const before = 'x [[old|alias]]', occurrence = parseWikilinks(before)[0];
    expect(() => checkedOccurrence('prefix ' + before, occurrence)).toThrow();
    expect(() => relinkText(occurrence, 'bad|path')).toThrow();
    expect(() => relinkText(occurrence, 'new', '#bad|path')).toThrow();
    expect(() => relinkLayoutAliases(before, 'unrelated', occurrence.start, occurrence.end, '[[new|alias]]')).toThrow();
  });
  it('clears or repositions the same manual card after undo, without restoring an older placement on redo', () => {
    const before = 'A [[old|item]] B', occurrence = parseWikilinks(before)[0], after = 'A [[new|item]] B';
    const oldKey = layoutIdentities(before, [occurrence]).get(occurrence.start)!;
    const newKey = [...layoutIdentities(after, parseWikilinks(after)).values()][0];
    const store = new LayoutStore([], () => {}), position = { side: 'left' as const, xNormalized: .3, yOffset: 2 };
    store.set('A.md', oldKey, position);
    store.preserveRelink('A.md', relinkLayoutAliases(before, after, occurrence.start, occurrence.end, '[[new|item]]'));
    store.set('A.md', oldKey, { ...position, yOffset: 5 });
    expect(store.get('A.md', newKey)?.yOffset).toBe(5); expect(store.snapshot()).toHaveLength(1);
    store.clear('A.md', newKey); expect(store.get('A.md', oldKey)).toBeUndefined();
  });
  it('does not transfer layout when either occurrence identity is ambiguous', () => {
    const repeated = 'prefix' + (' '.repeat(60) + '[[same]]' + ' '.repeat(60)).repeat(2) + 'end';
    const second = parseWikilinks(repeated)[1], replacement = '[[new]]';
    const after = repeated.slice(0, second.start) + replacement + repeated.slice(second.end);
    expect(relinkLayoutAliases(repeated, after, second.start, second.end, replacement).size).toBe(0);
  });
});
