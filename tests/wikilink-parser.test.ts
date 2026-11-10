import { describe, expect, it } from 'vitest';
import { parseWikilinks } from '../src/core/wikilink-parser';
describe('native Wikilink occurrences', () => {
  it('preserves targets, aliases, extensions, Unicode and subpaths', () => {
    const text = '[[Note]] [[Folder/Note.md|别名]] [[Board.canvas|导图]] [[product_release_stages.html|Early Access]] [[设计文档#方案讨论|方案]] [[note#^block-id|内容]] [[../中文/😀 文件.md| 🌸 ]]';
    const result = parseWikilinks(text);
    expect(result.map(x => x.target)).toEqual(['Note', 'Folder/Note.md', 'Board.canvas', 'product_release_stages.html', '设计文档#方案讨论', 'note#^block-id', '../中文/😀 文件.md']);
    expect(result.at(-1)?.alias).toBe(' 🌸 ');
    for (const link of result) expect(text.slice(link.start, link.end)).toBe(link.raw);
  });
  it('retains every repeated occurrence, even identical labels on a single line', () => {
    const result = parseWikilinks('[[A|same]] [[B|same]] [[A|same]]');
    expect(result).toHaveLength(3);
    expect(new Set(result.map(x => x.start)).size).toBe(3);
  });
  it('ignores embeds, frontmatter, fenced / indented code, inline code, comments, HTML, math, URLs and Markdown links', () => {
    const text = [
      '---', 'property: "[[yaml]]"', '---', '',
      '![[image.png]]', '`[[inline]]`', '``[[backticks]]``',
      '```md', '[[fence]]', '```', '', '    [[indented]]', '',
      '> ```', '> [[quoted fence]]', '> ```', '',
      '[display [[bad]]](Note.md)', '[normal](Note.md)', '<https://example.org/[[auto]]>',
      'https://example.org/[[bare]]', '<!-- [[comment]] -->',
      '%% [[obsidian comment]] %%', '$[[math]]$', '$$\n[[block math]]\n$$',
      '\\[[escaped]]', '<div>\n[[html]]\n</div>', '', '[[real]]'
    ].join('\n');
    expect(parseWikilinks(text).map(x => x.target)).toEqual(['real']);
  });
  it('does not truncate heading/block links or conflate paths', () => {
    expect(parseWikilinks('[[A/Note#heading|same]] [[B/Note#^block|same]]').map(l => l.target)).toEqual(['A/Note#heading', 'B/Note#^block']);
  });
  it('skips multiline and malformed tokens', () => {
    expect(parseWikilinks('[[A\nB]] [[A|b|c]] [[unfinished')).toEqual([]);
  });
  it('still recognizes native Wikilinks when a matching Markdown reference definition exists', () => {
    expect(parseWikilinks('[[Note]]\n\n[Note]: Other.md').map(l => l.target)).toEqual(['Note']);
  });
});
