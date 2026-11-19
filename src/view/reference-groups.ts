import type { Anchor, ResolvedLink, WikilinkOccurrence } from '../types';

export interface Reference {
  occurrence: WikilinkOccurrence;
  resolved: ResolvedLink;
}
export interface ReferenceGroup {
  key: string;
  members: Reference[];
}
export function groupOccurrencesByResolvedTarget(links: readonly WikilinkOccurrence[], resolve: (target: string) => ResolvedLink) {
  const groups = new Map<string, ReferenceGroup>();
  const ordinal = new Map<string, number>();
  const byOccurrence = new Map<string, ReferenceGroup>();
  for (const occurrence of links) {
    const resolved = resolve(occurrence.target);
    const id = String(occurrence.start);
    const key = resolved.file ? 'file:' + resolved.file.path : 'missing:' + id;
    const group = groups.get(key) ?? { key, members: [] };
    ordinal.set(id, group.members.length);
    group.members.push({ occurrence, resolved });
    groups.set(key, group);
    byOccurrence.set(id, group);
  }
  return { groups, byOccurrence, ordinal };
}

export function selectRepresentativeOccurrence(visible: Anchor[], center: number, previous?: string): Anchor {
  const distance = (a: Anchor) => Math.abs((a.rect.top + a.rect.bottom) / 2 - center);
  return visible.find(a => a.key === previous) ?? visible.reduce((a, b) =>
    distance(b) < distance(a) || (distance(b) === distance(a) && b.occurrence.start < a.occurrence.start) ? b : a);
}

export function buildReferenceListItems(group: ReferenceGroup, source: string) {
  let line = 1, offset = 0;
  return group.members.map(({ occurrence, resolved }) => {
    while (offset < occurrence.start) if (source.charCodeAt(offset++) === 10) line++;
    return { occurrence, label: occurrence.alias || resolved.file?.name || occurrence.target, line, subpath: resolved.subpath };
  });
}
