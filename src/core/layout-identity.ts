import type { WikilinkOccurrence } from '../types';
import { parseWikilinks } from './wikilink-parser';

// Two independent 32-bit accumulators: a matching hint, never a guaranteed unique ID.
export function fingerprint(value: string): string {
  let a = 2166136261, b = 3339675911;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function legacyLayoutIdentities(text: string, links: WikilinkOccurrence[]): Map<number, string> {
  const populations = new Map<string, number>();
  for (const link of links) populations.set(link.raw, (populations.get(link.raw) ?? 0) + 1);
  const candidates = links.map(link => ({ start: link.start, key:
    fingerprint(link.raw) + fingerprint(text.slice(Math.max(0, link.start - 48), link.start)) +
    fingerprint(text.slice(link.end, link.end + 48)) + fingerprint(String(populations.get(link.raw)))
  }));
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
  // An ordinal or absolute offset cannot distinguish identical contexts safely.
  return new Map(candidates.filter(c => counts.get(c.key) === 1).map(c => [c.start, c.key]));
}

export function layoutIdentities(text: string, links: WikilinkOccurrence[]): Map<number, string> {
  if (!text.includes('\r')) return legacyLayoutIdentities(text, links);
  const normalized = text.replace(/\r\n?/g, '\n');
  const removed = [...text.matchAll(/\r\n/g)].map(match => match.index);
  const offset = (raw: number) => {
    let low = 0, high = removed.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (removed[middle] < raw) low = middle + 1; else high = middle;
    }
    return raw - low;
  };
  const normalizedLinks = links.map(link => ({ ...link, start: offset(link.start), end: offset(link.end) }));
  const identities = legacyLayoutIdentities(normalized, normalizedLinks);
  // Keep source offsets for DOM mapping; only the identity's context is normalized.
  // Identity ambiguity is still checked over the complete normalized document.
  return new Map(links.flatMap((link, i) => {
    const key = identities.get(normalizedLinks[i].start);
    return key ? [[link.start, key] as const] : [];
  }));
}

export function legacyLayoutAliases(text: string, links: WikilinkOccurrence[],
  identities?: ReadonlyMap<number, string>): Map<string, string> {
  // The host can normalize a CRLF file before the first overlay confirms it.
  // Its exact CRLF equivalent is the only additional legacy document considered.
  const legacyText = text.includes('\r') ? text : text.replaceAll('\n', '\r\n');
  if (legacyText === text && !text.includes('\r')) return new Map();
  const canonical = identities ?? layoutIdentities(text, links);
  if (!canonical.size) return new Map();
  const legacyLinks = legacyText === text ? links : parseWikilinks(legacyText);
  if (legacyLinks.length !== links.length) return new Map();
  const legacy = legacyLayoutIdentities(legacyText, legacyLinks);
  return new Map(links.flatMap((link, i) => {
    const key = canonical.get(link.start);
    // This maps the same occurrence across a line-ending conversion, not two
    // occurrences inferred from their order or a saved numeric offset.
    const oldKey = legacyLinks[i].raw === link.raw ? legacy.get(legacyLinks[i].start) : undefined;
    return key && oldKey && oldKey !== key ? [[key, oldKey] as const] : [];
  }));
}
