import { describe, it, expect, vi } from 'vitest';
import { groupOccurrences } from '../src/view/card-groups';
import { readStoredData } from '../src/core/layout-store';

function links(targets: string[]) {
  return targets.map((target, start) => ({ target, start, end: start + 1, raw: '[[' + target + ']]', label: target }));
}
const resolve = (path: string) => path === 'missing' ? null : { path, extension: path.split('.').pop()! };
it('keeps each occurrence in a stable full-directory group, including ambiguous basenames, root and missing', () => {
  const targets = ['B/p.md', 'A/p.md', 'B/p.md', 'p.md', '未解析目标/p.md', 'missing'];
  const grouped = groupOccurrences('folder', links(targets), resolve);
  expect([...grouped.byOccurrence.keys()]).toEqual(['0', '1', '2', '3', '4', '5']);
  expect(grouped.groups.map(g => g.label)).toEqual(['/', 'A/', 'B/', '未解析目标', '未解析目标/']);
  expect(grouped.byOccurrence.get('0')).toBe(grouped.byOccurrence.get('2'));
  expect(grouped.byOccurrence.get('0')?.count).toBe(2);
  expect(groupOccurrences('folder', links(targets.reverse()), resolve).groups).toEqual(grouped.groups);
});
it('classifies by type without scanning other files and resolves each distinct target once', () => {
  const targets = ['a.md', 'a.markdown', 'a.HTM', 'a.html', 'a.PNG', 'a.svg', 'a.PDF', 'a.xmind', 'missing'];
  const resolver = vi.fn(resolve);
  const group = groupOccurrences('type', links(Array.from({ length: 9000 }, (_, i) => targets[i % 9])), resolver);
  expect(group.byOccurrence.size).toBe(9000);
  expect(resolver).toHaveBeenCalledTimes(9);
  expect(Object.fromEntries(group.groups.map(g => [g.label, g.count]))).toEqual({
    Markdown: 2000, HTML: 2000, 图片: 2000, PDF: 1000, XMind: 1000, 未解析目标: 1000
  });
});
describe('group preference migration', () => {
  const corrupt = { schemaVersion: 2, preferences: { groupMode: { relation: 'x' } } };
  it.each([null, 'bad', {}, { groupMode: 'tag' }, corrupt])('defaults missing and corrupt preferences to none', input => {
    expect(readStoredData(input).preferences.groupMode).toBe('none');
  });
  it.each(['folder', 'type'] as const)('preserves valid %s choice and existing layout records', groupMode => {
    const record = { source: 'a.md', key: 'f'.repeat(64), updated: Date.now(), side: 'left', xNormalized: 0.5, yOffset: 2 };
    const data = { schemaVersion: 2, preferences: { groupMode, placementMode: 'manual' }, layouts: [record] };
    expect(readStoredData(data)).toMatchObject(data);
    expect(readStoredData({ ...data, preferences: {} }).layouts).toEqual([record]);
  });
});
