import { describe, it, expect } from 'vitest';
import { formatWikilink } from '../src/core/link-formatter';
import { parseWikilinks } from '../src/core/wikilink-parser';
describe('lossless native Wikilink creation', () => {
  it.each(['Early Access', ' 中文标点，😀。 ', 'a # b', ' hello! '])('preserves alias %s', alias => {
    const link = formatWikilink('参考/文件.md', alias);
    expect(parseWikilinks(link)[0].alias).toBe(alias);
    expect(link).toBe(`[[参考/文件.md|${alias}]]`);
  });
  it.each(['a|b', ']]', '[[x]]', 'a\nb', 'a\\b', '', '   ', '<tag>'])('rejects unsafe alias %s', alias => {
    expect(() => formatWikilink('Note.md', alias)).toThrow();
  });
  it.each(['a#b.md', 'a|b.md', 'a]]b.md', 'bad\\file.md', ' bad.md', 'bad^file.md'])('rejects unsafe path %s', path => {
    expect(() => formatWikilink(path, 'text')).toThrow();
  });
  it('preserves file extension and exact root-relative folder path', () => {
    expect(formatWikilink('B/Note.md', 'same')).toBe('[[B/Note.md|same]]');
    expect(formatWikilink('References/stages.html', 'Early Access')).toBe('[[References/stages.html|Early Access]]');
  });
});
