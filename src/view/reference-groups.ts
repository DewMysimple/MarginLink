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

/** Anchors arrive in measurement order. Re-measuring a Map entry preserves its
 * insertion order, so later virtualized sections cannot take over a file card. */
export function referenceCardAnchors(measured: Anchor[], byOccurrence: ReadonlyMap<string, ReferenceGroup>) {
  const cards = new Map<string, Anchor>();
  for (const anchor of measured) {
    const group = byOccurrence.get(anchor.key);
    if (group && !cards.has(group.key)) cards.set(group.key, anchor);
  }
  return cards;
}

export function buildReferenceListItems(group: ReferenceGroup, source: string) {
  let line = 1, offset = 0;
  return group.members.map(({ occurrence, resolved }) => {
    while (offset < occurrence.start) if (source.charCodeAt(offset++) === 10) line++;
    return { occurrence, label: occurrence.alias || resolved.file?.name || occurrence.target, line, subpath: resolved.subpath };
  });
}
