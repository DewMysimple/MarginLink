import type { Range } from '../types';
import { parseDocument, type ParsedDocument } from '../core/wikilink-parser';
import { validateSelection, type SelectionSnapshot } from './selection-validation';

export interface SelectionSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SelectionMatch {
  from: number;
  to: number;
  text: string;
  line: number;
  before: string;
  after: string;
  selected: boolean;
}

const wordBefore = /[\p{L}\p{M}\p{N}\p{Pc}]$/u;
const wordAfter = /^[\p{L}\p{M}\p{N}\p{Pc}]/u;
const contextLength = 24;

function inlineSyntaxRanges(text: string): Range[] {
  // Some Obsidian syntax is parsed as a CommonMark text node. Keep it intact
  // when matching occurrences the user did not directly select in the editor.
  const expressions = [
    /#[\p{L}\p{M}\p{N}\p{S}_/-]+/gu, // Tags, including nested tags.
    /(?<!\S)\^[a-z\d-]+(?=[ \t]*\r?$)/gim, // Block IDs at line ends.
    /\[(?:\^[^\]\r\n]+|![\w-]+)\]/g, // Footnote labels and callout types.
    /&(?:#\d{1,7}|#x[a-f\d]{1,6}|[a-z][a-z\d]{1,31});/gi,
    /\\!?\[\[[^[\]\r\n]+\]\]/g
  ];
  return expressions.flatMap(expression => Array.from(text.matchAll(expression), ({ 0: value, index }) => ({ start: index, end: index + value.length })));
}

// Candidates arrive in offset order. For overlap tests the first range still
// ending after the candidate start suffices, and parsed text nodes are disjoint.
function relevantRange(ranges: readonly Range[]): (offset: number) => Range[] {
  const ordered = [...ranges].sort((a, b) => a.start - b.start);
  let cursor = 0;
  return offset => {
    while (cursor < ordered.length && ordered[cursor].end <= offset) cursor++;
    return cursor < ordered.length ? [ordered[cursor]] : [];
  };
}

function addContext(text: string, ranges: Range[], selectedOffset: number): SelectionMatch[] {
  const newlines = /\r\n?|\n/g;
  let nextBreak = newlines.exec(text), lineStart = 0, line = 1;
  return ranges.map(({ start: from, end: to }) => {
    while (nextBreak && nextBreak.index < from) {
      lineStart = newlines.lastIndex;
      nextBreak = newlines.exec(text);
      line++;
    }
    const lineEnd = nextBreak?.index ?? text.length;
    const before = Array.from(text.slice(Math.max(lineStart, from - contextLength * 2), from)).slice(-contextLength).join('');
    const after = Array.from(text.slice(to, Math.min(lineEnd, to + contextLength * 2))).slice(0, contextLength).join('');
    return {
      from, to, text: text.slice(from, to), line, selected: from === selectedOffset,
      before: (from - before.length > lineStart ? '…' : '') + before,
      after: after + (to + after.length < lineEnd ? '…' : '')
    };
  });
}

export function findSelectionMatches(snapshot: SelectionSnapshot, options: SelectionSearchOptions, document?: ParsedDocument): SelectionMatch[] {
  const { text, selected, from, to } = snapshot;
  if (!selected || text.slice(from, to) !== selected) return [];
  const parsed = document ?? parseDocument(text);
  if (validateSelection(text, from, to, 1, parsed)) return [];

  // A single literal RegExp can exceed the engine's size limit for long
  // one-line selections. Find the prefix, then verify adjacent literal chunks.
  const literals = Array.from(selected.matchAll(/.{1,1024}/gsu), ([part]) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const flags = options.caseSensitive ? 'u' : 'iu';
  const matcher = new RegExp(literals[0], flags + 'g');
  const remaining = literals.slice(1).map(literal => new RegExp(literal, flags + 'y'));
  const protectedRange = relevantRange([...parsed.protected, ...inlineSyntaxRanges(text)]);
  const tableRange = relevantRange(parsed.tableRanges);
  const textRange = relevantRange(parsed.textRanges);
  const ranges: Range[] = [{ start: from, end: to }];
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    const start = match.index;
    let end = matcher.lastIndex;
    const complete = remaining.every(part => {
      part.lastIndex = end;
      if (!part.test(text)) return false;
      end = part.lastIndex;
      return true;
    });
    if (complete && start < to && end > from) {
      matcher.lastIndex = to;
      continue;
    }
    const partial = options.wholeWord && (wordBefore.test(text.slice(Math.max(0, start - 2), start))
      || wordAfter.test(text.slice(end, end + 2)));
    if (complete && !partial && !validateSelection(text, start, end, 1, {
      ...parsed, protected: protectedRange(start), tableRanges: tableRange(start), textRanges: textRange(start)
    })) {
      ranges.push({ start, end });
      matcher.lastIndex = end;
    } else {
      // A rejected candidate may overlap a later valid match. Advance one
      // complete character so the Unicode RegExp never rewinds into a pair.
      matcher.lastIndex = start + (match[0].codePointAt(0)! > 0xffff ? 2 : 1);
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  return addContext(text, ranges, from);
}
