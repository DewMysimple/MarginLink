import type { WikilinkOccurrence } from '../types';

// Two independent 32-bit accumulators: a matching hint, never a guaranteed unique ID.
export function fingerprint(value: string): string {
  let a = 2166136261, b = 3339675911;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function layoutIdentities(text: string, links: WikilinkOccurrence[]): Map<number, string> {
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
