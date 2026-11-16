import { layoutCards, type LayoutInput, type Placement } from './layout-engine';

interface Entry { placement: Placement; offset: number; manual: string }
// One instance per MarkdownView. Coordinates and automatic decisions live only
// in memory; a scroll neither changes persisted positions nor solves old cards.
export class StableLayout {
  private entries = new Map<string, Entry>();
  private geometry = '';
  private mode?: string;
  private automatic = new Map<string, Placement>();
  private automaticOffsets = new Map<string, number>();
  clear(): void { this.entries.clear(); this.automatic.clear(); this.automaticOffsets.clear(); this.geometry = ''; this.mode = undefined; }
  update(input: LayoutInput, scrollTop: number, geometry: string): Placement[] {
    if (this.geometry !== geometry || this.mode !== input.preferences?.placementMode) {
      this.clear(); this.geometry = geometry; this.mode = input.preferences?.placementMode;
    }
    const manualMode = !!input.preferences && input.preferences.placementMode !== 'auto';
    const manualKey = (a: LayoutInput['anchors'][number]) => JSON.stringify(manualMode ? a.manual ?? null : null);
    // A drop/reset changes one occurrence, not the entire note. Keep every
    // other automatic and manual slot, side and text-relative offset intact.
    for (const a of input.anchors) {
      const entry = this.entries.get(a.key);
      if (entry && entry.manual !== manualKey(a)) this.entries.delete(a.key);
    }
    const anchors = input.anchors.map(a => ({ ...a, y: a.y + scrollTop }));
    for (const a of anchors) {
      const old = this.entries.get(a.key);
      if (old) old.placement.y = a.y + old.offset;
      const automatic = this.automatic.get(a.key);
      if (automatic) automatic.y = a.y + this.automaticOffsets.get(a.key)!;
    }
    if (input.preferences?.placementMode === 'manual') {
      // Fully manual placement has no invisible automatic base or neighbour
      // reservation. Only this occurrence's saved record changes its slot.
      const pending = anchors.filter(a => !this.entries.has(a.key));
      const byKey = new Map(anchors.map(a => [a.key, a]));
      for (const placement of layoutCards({ ...input, anchors: pending })) {
        const anchor = byKey.get(placement.key)!;
        this.entries.set(placement.key, { placement, offset: placement.y - anchor.y, manual: manualKey(anchor) });
      }
      return [...this.entries.values()].map(e => ({ ...e.placement, y: e.placement.y - scrollTop }));
    }
    // The invisible canonical slots reserve their original places even after a
    // card is dragged. Newly measured sections must not balance against its new
    // user placement, and re-opening the note derives the same automatic base.
    const pending = anchors.filter(a => !this.automatic.has(a.key));
    const placements = layoutCards({ ...input, anchors: pending,
      preferences: input.preferences ? { ...input.preferences, placementMode: 'auto' } : undefined
    }, [...this.automatic.values()]);
    const byKey = new Map(anchors.map(a => [a.key, a]));
    for (const placement of placements) {
      this.automatic.set(placement.key, placement);
      this.automaticOffsets.set(placement.key, placement.y - byKey.get(placement.key)!.y);
    }
    for (const a of anchors) {
      if (this.entries.has(a.key)) continue;
      const base = this.automatic.get(a.key);
      if (!base) continue;
      const placement = manualMode && a.manual ? layoutCards({ ...input, anchors: [a] })[0] : { ...base };
      if (placement) this.entries.set(a.key, { placement, offset: placement.y - a.y, manual: manualKey(a) });
    }
    return [...this.entries.values()].map(e => ({ ...e.placement, y: e.placement.y - scrollTop }));
  }
}
