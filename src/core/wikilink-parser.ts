import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import type { Range, WikilinkOccurrence } from '../types';

export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}
function escaped(source: string, at: number): boolean {
  let count = 0;
  while (at > 0 && source[--at] === '\\') count++;
  return count % 2 === 1;
}
export interface ParsedDocument {
  links: WikilinkOccurrence[];
  protected: Range[];
  // Reading-mode mapping includes ordinary Markdown links to disambiguate identical hrefs.
  markdownLinks: { start: number; end: number; target: string }[];
  textRanges: Range[];
  tableRanges: Range[];
}
export function parseDocument(source: string): ParsedDocument {
  const protectedRanges: Range[] = [];
  const markdownLinks: ParsedDocument['markdownLinks'] = [];
  const textRanges: Range[] = [];
  const tableRanges: Range[] = [];
  const lines = source.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '');
    if (!lines[i].includes('|') || !lines[i - 1].includes('|') || !row.split('|').every(cell => /^\s*:?-+:?\s*$/.test(cell))) continue;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() && lines[end].includes('|')) end++;
    tableRanges.push({ start: offsets[i - 1], end: end < offsets.length ? offsets[end] : source.length });
  }
  // Preserve offsets but stop CommonMark reference definitions from consuming [[Note]].
  // The original source remains the only input used for actual Wikilink extraction.
  const markdownSource = source.replace(/!?\[\[([^[\]\r\n]+)\]\]/g, raw => raw.replace(/[[\]]/g, '\uE000'));
  const tree = fromMarkdown(markdownSource);
  const definitions = new Map<string, string>();
  function collectDefinitions(node: Nodes): void {
    if (node.type === 'definition') definitions.set(node.identifier, node.url);
    if ('children' in node) for (const child of node.children) collectDefinitions(child as Nodes);
  }
  collectDefinitions(tree);
  function visit(node: Nodes): void {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (['code', 'inlineCode', 'html', 'link', 'image', 'definition', 'linkReference', 'imageReference'].includes(node.type)) {
        protectedRanges.push({ start, end });
        if (node.type === 'link') markdownLinks.push({ start, end, target: node.url });
        if (node.type === 'linkReference') {
          const target = definitions.get(node.identifier);
          if (target) markdownLinks.push({ start, end, target });
        }
        return;
      }
      if (node.type === 'text') textRanges.push({ start, end });
    }
    if ('children' in node) for (const child of node.children) visit(child as Nodes);
  }
  visit(tree);
  const yaml = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?(?:\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)|$)/.exec(source);
  if (yaml) protectedRanges.push({ start: 0, end: yaml[0].length });
  // Obsidian comments and math are not CommonMark constructs.
  for (const regex of [/%%[\s\S]*?(?:%%|$)/g, /\$\$[\s\S]*?(?:\$\$|$)/g, /(?<![\\$])\$(?!\s|\$)[^\n$]+?\$(?!\$)/g, /(?:https?|ftp):\/\/[^\s<>]+/g]) {
    for (const match of source.matchAll(regex)) {
      if (!protectedRanges.some(r => r.start <= match.index && r.end > match.index)) {
        protectedRanges.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }
  const links: WikilinkOccurrence[] = [];
  const excluded = protectedRanges.slice();
  const regex = /!?\[\[([^[\]\r\n]+)\]\]/g;
  for (const match of source.matchAll(regex)) {
    const start = match.index;
    const end = start + match[0].length;
    const range = { start, end };
    if (escaped(source, start) || excluded.some(r => overlaps(r, range))) continue;
    protectedRanges.push(range);
    if (match[0].startsWith('!')) continue;
    const body = match[1];
    const separator = body.indexOf('|');
    const target = (separator < 0 ? body : body.slice(0, separator)).trim();
    const alias = separator < 0 ? undefined : body.slice(separator + 1);
    if (!target || /[|<>\\]/.test(target) || [...target].some(c => c.charCodeAt(0) < 32) || /[|\\]/.test(alias ?? '')) continue;
    links.push({ raw: match[0], start, end, target, alias, label: alias ?? target });
  }
  return { links, protected: protectedRanges, markdownLinks, textRanges, tableRanges };
}
export function parseWikilinks(source: string): WikilinkOccurrence[] {
  return parseDocument(source).links;
}
