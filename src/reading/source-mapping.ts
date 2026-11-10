import type { WikilinkOccurrence } from '../types';
export interface SourceLink { start: number; target: string; occurrence?: WikilinkOccurrence }
export interface RenderedLink<T> { element: T; target: string }
export function mapReadingLinks<T>(events: SourceLink[], anchors: RenderedLink<T>[], normalize: (target: string) => string): { element: T; occurrence: WikilinkOccurrence }[] {
  const sources = new Map<string, SourceLink[]>();
  const rendered = new Map<string, RenderedLink<T>[]>();
  for (const source of [...events].sort((a, b) => a.start - b.start)) {
    const target = normalize(source.target);
    const group = sources.get(target) ?? []; group.push(source); sources.set(target, group);
  }
  for (const anchor of anchors) {
    const target = normalize(anchor.target);
    const group = rendered.get(target) ?? []; group.push(anchor); rendered.set(target, group);
  }
  const result: { element: T; occurrence: WikilinkOccurrence }[] = [];
  for (const [target, sourceGroup] of sources) {
    const domGroup = rendered.get(target);
    // HTML or another postprocessor may insert/remove anchors. Refuse ambiguous groups
    // instead of attaching a Wikilink card to an ordinary link with an identical label.
    if (!domGroup || domGroup.length !== sourceGroup.length) continue;
    for (let i = 0; i < sourceGroup.length; i++) {
      const occurrence = sourceGroup[i].occurrence;
      if (occurrence) result.push({ element: domGroup[i].element, occurrence });
    }
  }
  return result.sort((a, b) => a.occurrence.start - b.occurrence.start);
}
