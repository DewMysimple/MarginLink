import { describe, expect, it } from 'vitest';
import { validateSelection, validateSnapshot, type SelectionSnapshot } from '../src/editor/selection-validation';
describe('selection protection', () => {
  it('accepts only one contiguous ordinary inline selection, including soft wrapping', () => {
    expect(validateSelection('Before Early Access, after', 7, 19)).toBeNull();
    expect(validateSelection('普通中文 😀 text', 0, 7)).toBeNull();
    expect(validateSelection('Before text', 0, 6, 2)).toBeTruthy();
  });
  it.each([
    ['', 0, 0], ['line\nnext', 0, 9], ['[[Note|text]]', 7, 11],
    ['`code`', 1, 5], ['```\ncode\n```', 4, 8], ['---\nkey: value\n---', 9, 14],
    ['![[image.png]]', 3, 8], ['[alias](target)', 1, 6], ['%%comment%%', 2, 9],
    ['$math$', 1, 5], ['x | y', 0, 5], ['😀', 0, 1],
    ['# heading', 0, 9], ['- list item', 0, 11], ['**bold** plain', 2, 13], ['---\nkey: value', 9, 14],
    ['| Early Access |\n| --- |\n| Other text |', 2, 14]
  ] as const)('rejects unsafe source %s', (text, start, end) => expect(validateSelection(text, start, end)).toBeTruthy());
  const snapshot: SelectionSnapshot = { sourcePath: 'A.md', text: 'Early Access', from: 0, to: 12, selected: 'Early Access', revision: 3 };
  it('rejects changes to file, text, editor context, or history even after undo', () => {
    const good = { sourcePath: 'A.md', text: snapshot.text, revision: 3, active: true };
    expect(validateSnapshot(snapshot, good)).toBeNull();
    for (const change of [{ sourcePath: 'B.md' }, { text: 'other Access' }, { revision: 4 }, { active: false }]) expect(validateSnapshot(snapshot, { ...good, ...change })).toBeTruthy();
  });
});
