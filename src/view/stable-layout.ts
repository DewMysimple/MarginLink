import { layoutCards, type LayoutInput, type Placement } from './layout-engine';

interface Entry { placement: Placement; offset: number; manual: string }
// One instance per MarkdownView. Coordinates and automatic decisions live only
// in memory; a scroll neither changes persisted positions nor solves old cards.
export class StableLayout {
  private entries = new Map<string, Entry>();
  private geometry = '';
  clear(): void { this.entries.clear(); this.geometry = ''; }
  update(input: LayoutInput, scrollTop: number, geometry: string): Placement[] {
    if (this.geometry !== geometry) { this.clear(); this.geometry = geometry; }
    const manualKey = (a: LayoutInput['anchors'][number]) => JSON.stringify(a.manual ?? null);
    if (input.anchors.some(a => this.entries.has(a.key) && this.entries.get(a.key)!.manual !== manualKey(a))) this.entries.clear();
    const anchors = input.anchors.map(a => ({ ...a, y: a.y + scrollTop }));
    for (const a of anchors) {
      const old = this.entries.get(a.key);
      if (old) old.placement.y = a.y + old.offset;
    }
    const pending = anchors.filter(a => !this.entries.has(a.key));
    const placements = layoutCards({ ...input, anchors: pending }, [...this.entries.values()].map(e => e.placement));
    const byKey = new Map(anchors.map(a => [a.key, a]));
    for (const placement of placements) {
      const a = byKey.get(placement.key)!;
      this.entries.set(placement.key, { placement, offset: placement.y - a.y, manual: manualKey(a) });
    }
    return [...this.entries.values()].map(e => ({ ...e.placement, y: e.placement.y - scrollTop }));
  }
}
