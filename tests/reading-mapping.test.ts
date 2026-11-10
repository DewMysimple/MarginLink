import { describe, it, expect } from 'vitest';
import { parseDocument } from '../src/core/wikilink-parser';
import { mapReadingLinks } from '../src/reading/source-mapping';
describe('reading-mode source occurrence mapping', () => {
  it('does not map cards to ordinary links or reference-style links with identical targets and aliases', () => {
    const parsed = parseDocument('[same](Note.md) [[Note|same]] [same][ref] [[Note.md|same]]\n\n[ref]: Note.md');
    const events = [...parsed.links.map(l => ({ start: l.start, target: l.target, occurrence: l })), ...parsed.markdownLinks];
    const anchors = [0, 1, 2, 3].map(i => ({ element: i, target: 'Note.md' }));
    const mapped = mapReadingLinks(events, anchors, value => value.replace(/\.md$/, ''));
    expect(mapped.map(x => x.element)).toEqual([1, 3]);
    expect(mapped.map(x => x.occurrence.start)).toEqual(parsed.links.map(l => l.start));
  });
  it('refuses ambiguous groups created by foreign HTML or postprocessors', () => {
    const parsed = parseDocument('[[Note|same]]');
    const events = parsed.links.map(l => ({ start: l.start, target: l.target, occurrence: l }));
    expect(mapReadingLinks(events, [{ element: 'injected', target: 'Note' }, { element: 'real', target: 'Note' }], x => x)).toEqual([]);
  });
  it('keeps heading and block subpaths distinct', () => {
    const parsed = parseDocument('[[Note#Heading|same]] [[Note#^block|same]]');
    const mapped = mapReadingLinks(parsed.links.map(l => ({ start: l.start, target: l.target, occurrence: l })), [
      { element: 0, target: 'Note#Heading' }, { element: 1, target: 'Note#^block' }
    ], x => x);
    expect(mapped.map(l => l.occurrence.target)).toEqual(['Note#Heading', 'Note#^block']);
  });
});
