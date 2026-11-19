import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import type { Anchor } from '../src/types';
import { readPreferences } from '../src/types';
import { parseWikilinks } from '../src/core/wikilink-parser';
import { buildReferenceListItems, groupOccurrencesByResolvedTarget, referenceCardAnchors } from '../src/view/reference-groups';
import { connectorBatch } from '../src/view/connector-batch';
import { clearConnectorSegments } from '../src/view/connector-renderer';

const source = '[[A/Plan#one|first]] [[Plan#^block|second]]\n[[A/Plan]] [[B/Plan]] [[missing]] [[missing]]';
const links = parseWikilinks(source);
function groups(text = source, shortPath = 'A/Plan') {
  return groupOccurrencesByResolvedTarget(parseWikilinks(text), target => {
    const [name, sub] = target.split('#');
    const path = (name === 'Plan' ? shortPath : name) + '.md';
    return { file: name === 'missing' ? null : { path, name: 'Plan.md' } as TFile, subpath: sub ? '#' + sub : '', target };
  });
}
describe('reference aggregation', () => {
  it('uses resolved paths, preserves original members and splits unresolved occurrences', () => {
    const index = groups(), all = [...index.groups.values()];
    expect(all.map(g => g.members.length)).toEqual([3, 1, 1, 1]);
    expect(buildReferenceListItems(all[0], source).map(r => [r.label, r.line, r.subpath])).toEqual([
      ['first', 1, '#one'], ['second', 1, '#^block'], ['Plan.md', 2, '']
    ]);
    expect(all[0].members.map(m => m.occurrence)).toEqual(links.slice(0, 3));
    expect([...groups(source, 'B/Plan').groups.values()].map(g => g.members.length)).toEqual([2, 2, 1, 1]);
  });
  it('rebuilds offsets and counts after reordering, insertion and deletion', () => {
    const text = links.slice(1).reverse().map(l => l.raw).join(' ') + ' [[A/Plan|added]]';
    const group = groups(text).groups.get('file:A/Plan.md')!;
    expect(group.members.map(m => text.slice(m.occurrence.start, m.occurrence.end))).toEqual(['[[A/Plan]]', '[[Plan#^block|second]]', '[[A/Plan|added]]']);
  });
  it('retains the first measured owner when a deep-opened view later measures earlier occurrences', () => {
    const index = groups(), anchors = links.map(occurrence => ({ occurrence, key: String(occurrence.start) } as Anchor));
    const order = [anchors[2], ...anchors.slice(0, 2), ...anchors.slice(3)];
    const cards = referenceCardAnchors(order, index.byOccurrence);
    expect(cards.get('file:A/Plan.md')).toBe(anchors[2]);
    expect(cards.size).toBe(4);
  });
  it.each([undefined, 1, 'true', null])('defaults off for invalid or absent preference %s', value => {
    expect(readPreferences({ mergeReferences: value }).mergeReferences).toBe(false);
    expect(readPreferences({ mergeReferences: true }).mergeReferences).toBe(true);
  });
  it.each(['straight', 'elbow', 'curve'] as const)('routes two independent %s connections to distinct ports', style => {
    const card = { x: 180, y: 36, width: 60, height: 60 };
    const inputs = [20, 100].map((top, index) => ({ key: String(index), cardKey: 'file:A', card, targetFraction: (index + 1) / 3,
      fragments: [{ left: 40, right: 70, top, bottom: top + 10 }] }));
    const options = { obstacles: inputs.flatMap(i => i.fragments), body: { left: 10, right: 120, top: 0, bottom: 150 } };
    const batch = connectorBatch(inputs, style, options);
    const ends = inputs.map(input => {
      const segments = batch.relations.get(input.key)!.connector.segments;
      expect(clearConnectorSegments(segments, input.fragments, card, options)).toBe(true);
      return segments.at(-1)!.to;
    });
    expect(ends[0]).not.toEqual(ends[1]);
  });
});
