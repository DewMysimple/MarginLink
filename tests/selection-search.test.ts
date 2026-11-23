import { describe, expect, it } from 'vitest';
import { findSelectionMatches } from '../src/editor/selection-search';
import type { SelectionSnapshot } from '../src/editor/selection-validation';

const exact = { caseSensitive: true, wholeWord: false };
const wholeWord = { caseSensitive: false, wholeWord: true };
function snapshot(text: string, selected: string, from = text.indexOf(selected)): SelectionSnapshot {
  return { text, selected, from, to: from + selected.length, sourcePath: 'A.md', revision: 1 };
}

describe('finding safe matching text in the current note', () => {
  it('finds literal matches, with case folding preserving each exact spelling', () => {
    const s = snapshot('C++ c++ CCCC C++', 'C++');
    expect(findSelectionMatches(s, exact).map(({ from, text }) => [from, text])).toEqual([[0, 'C++'], [13, 'C++']]);
    expect(findSelectionMatches(s, { ...exact, caseSensitive: false }).map(match => match.text)).toEqual(['C++', 'c++', 'C++']);
    expect(findSelectionMatches(snapshot('K K k', 'K'), wholeWord).map(match => match.text)).toEqual(['K', 'K', 'k']);
  });

  it('uses Unicode word boundaries while preserving a partial-word original selection', () => {
    const s = snapshot('bobcat Cat CAT caté écat cat𐐀 𐐀cat cat７ ７cat cat́ ́cat cat‿ ‿cat 猫cat cat猫 (cat)', 'cat');
    const matches = findSelectionMatches(s, wholeWord);
    expect(matches.map(match => match.text)).toEqual(['cat', 'Cat', 'CAT', 'cat']);
    expect(matches[0]).toMatchObject({ from: 3, selected: true });
    expect(matches.slice(1).every(match => !match.selected)).toBe(true);
    expect(findSelectionMatches(s, { ...wholeWord, wholeWord: false })).toHaveLength(16);
  });

  it('finds Chinese phrases within adjacent characters when whole-word matching is off', () => {
    const s = snapshot('场景、在场景中、另一个场景。', '场景');
    expect(findSelectionMatches(s, exact).map(match => match.from)).toEqual([0, 4, 11]);
    expect(findSelectionMatches(s, { ...exact, wholeWord: true })).toHaveLength(1);
  });

  it('skips all protected Markdown structures while allowing text inside emphasis and headings', () => {
    const text = [
      '---', 'title: Term', '---', '', 'Plain Term.', '',
      '[[Term|Term]] ![[Term]] [Term](https://a.example/Term) `Term` %%Term%% $Term$ https://a.example/Term',
      '', '<div>Term</div>', '', '```', 'Term', '```', '', '| Term |', '| --- |', '', '**Term**', '', '# Term'
    ].join('\n');
    const matches = findSelectionMatches(snapshot(text, 'Term', text.indexOf('Term.')), exact);
    expect(matches.map(({ line }) => line)).toEqual([5, 18, 20]);
  });

  it('leaves Obsidian syntax, entities, and contexts that would turn the generated link into an embed or escaped text untouched', () => {
    const text = ['Portable plain.', '#portable #topic/portable', 'Unchanged ^portable',
      '[^portable] \\[[portable]] !portable \\portable &portable;', '> [!portable] Callout', '### Portable heading'].join('\n');
    expect(findSelectionMatches(snapshot(text, 'Portable'), wholeWord).map(({ line }) => line)).toEqual([1, 6]);
  });

  it('matches long one-line selections without exceeding the regular expression size limit', () => {
    const selected = 'A😀'.repeat(40_000) + 'End';
    const text = `${selected}\n${selected.slice(0, 1_030)} other\n${selected.toLowerCase()}`;
    const matches = findSelectionMatches(snapshot(text, selected), wholeWord);
    expect(matches.map(({ line, text: label }) => [line, label])).toEqual([[1, selected], [3, selected.toLowerCase()]]);
  });

  it('reserves the original span before picking other non-overlapping matches', () => {
    const matches = findSelectionMatches(snapshot('aaaaaa  aaaaaa', 'aa', 1), exact);
    expect(matches.map(({ from, to, selected }) => ({ from, to, selected }))).toEqual([
      { from: 1, to: 3, selected: true },
      { from: 3, to: 5, selected: false },
      { from: 8, to: 10, selected: false },
      { from: 10, to: 12, selected: false },
      { from: 12, to: 14, selected: false }
    ]);
  });

  it('adds line numbers and bounded same-line context without clipping a Unicode character', () => {
    const text = 'Heading\r\n' + '😀'.repeat(25) + 'target' + '🌱'.repeat(25) + '\r\nshort target later';
    const matches = findSelectionMatches(snapshot(text, 'target'), exact);
    expect(matches.map(({ line, before, after }) => ({ line, before, after }))).toEqual([
      { line: 2, before: '…' + '😀'.repeat(24), after: '🌱'.repeat(24) + '…' },
      { line: 3, before: 'short ', after: ' later' }
    ]);
  });

  it('rejects an unsafe or stale anchor even when text elsewhere could be linked', () => {
    const text = 'Plain word. Then `word`.';
    expect(findSelectionMatches(snapshot(text, 'word', text.lastIndexOf('word')), exact)).toEqual([]);
    expect(findSelectionMatches({ ...snapshot(text, 'word'), selected: 'else' }, exact)).toEqual([]);
    expect(findSelectionMatches(snapshot('😀', '\uD83D'), exact)).toEqual([]);
  });
});
