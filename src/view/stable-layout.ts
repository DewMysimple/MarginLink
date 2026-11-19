import { displayPosition, layoutCards, packInitialSlots, type LayoutInput, type Placement } from './layout-engine';

interface Slot { placement: Placement; offset: number }
interface Entry extends Slot { manual: string; fixed: boolean }
// One instance per MarkdownView. Coordinates and automatic decisions live only
// in memory; a scroll neither changes persisted positions nor solves old cards.
export class StableLayout {
  private entries = new Map<string, Entry>();
  private geometry = '';
  private mode?: string;
  private automatic = new Map<string, Slot>();
  private initial = new Map<string, Slot>();
  private packed = new Map<string, { desired: number; top: number }>();
  clear(): void { this.entries.clear(); this.automatic.clear(); this.initial.clear(); this.packed.clear(); this.geometry = ''; this.mode = undefined; }
  retain(keys: { has(key: string): boolean }): void {
    for (const key of this.entries.keys()) if (!keys.has(key)) {
      this.entries.delete(key); this.automatic.delete(key); this.initial.delete(key); this.packed.delete(key);
    }
  }
  private packedTop(p: Placement): number {
    const slot = this.packed.get(p.key);
    return slot ? slot.top + (p.y - slot.desired) : p.y;
  }
  initialOffset(key: string): number | undefined { return this.automatic.get(key)?.offset; }
  update(input: LayoutInput, scrollTop: number, geometry: string, scrolling = false): Placement[] {
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
    let repack = false;
    for (const a of anchors) {
      for (const slot of [this.automatic.get(a.key), this.initial.get(a.key)]) {
        if (slot && slot.placement.y !== a.y + slot.offset) {
          slot.placement.y = a.y + slot.offset;
          if (!scrolling) repack = true;
        }
      }
      const old = this.entries.get(a.key);
      if (old) old.placement.y = a.y + old.offset;
    }
    if (input.preferences?.placementMode === 'manual') {
      // Fully manual placement has no invisible automatic base or neighbour
      // reservation. Only this occurrence's saved record changes its slot.
      const pending = anchors.filter(a => !this.entries.has(a.key));
      const byKey = new Map(anchors.map(a => [a.key, a]));
      for (const placement of layoutCards({ ...input, anchors: pending })) {
        const anchor = byKey.get(placement.key)!;
        this.entries.set(placement.key, { placement, offset: placement.y - anchor.y, manual: manualKey(anchor), fixed: true });
      }
      return [...this.entries.values()].map(e => ({ ...e.placement, y: e.placement.y - scrollTop }));
    }
    // The invisible canonical slots reserve their original places even after a
    // card is dragged. Newly measured sections must not balance against its new
    // user placement, and re-opening the note derives the same automatic base.
    const pending = anchors.filter(a => !this.automatic.has(a.key));
    if (pending.length) {
      const placements = layoutCards({ ...input, anchors: pending,
        preferences: input.preferences ? { ...input.preferences, placementMode: 'auto' } : undefined
      }, [...this.automatic.values()].map(slot => slot.placement));
      const byKey = new Map(pending.map(a => [a.key, a]));
      for (const placement of placements) {
        this.automatic.set(placement.key, { placement, offset: placement.y - byKey.get(placement.key)!.y });
        repack = true;
      }
    }
    for (const a of anchors) {
      if (this.entries.has(a.key)) continue;
      const base = this.automatic.get(a.key)?.placement;
      if (!base) continue;
      const placement = manualMode && a.manual ? layoutCards({ ...input, anchors: [a] })[0] : { ...base };
      if (placement) {
        const entry = { placement, offset: placement.y - a.y, manual: manualKey(a), fixed: !!(manualMode && a.manual && !a.manual.initial) };
        this.entries.set(a.key, entry);
        // A gesture keeps its old reservation. Only the selected card follows
        // the pointer, even if it is dropped on another card in the column.
        if (manualMode && a.manual?.initial) { this.initial.set(a.key, entry); repack = true; }
        else if (!a.manual && this.initial.delete(a.key)) repack = true;
      }
    }
    if (repack) {
      const slots = [...this.automatic].map(([key, base]) => (this.initial.get(key) ?? base).placement);
      if (scrolling && this.packed.size) {
        // Virtual spacers correct different sections in different frames.
        // Reserve settled cards at their text-relative offsets. Fit only the
        // newly discovered cards into free space during the gesture.
        const occupied = slots.filter(p => this.packed.has(p.key)).map(p => ({ ...p, y: this.packedTop(p) }));
        for (const p of slots) if (!this.packed.has(p.key)) {
          const fitted = displayPosition(p, input, occupied);
          this.packed.set(p.key, { desired: p.y, top: fitted.y }); occupied.push(fitted);
        }
      } else {
        const tops = packInitialSlots(slots);
        for (const p of slots) this.packed.set(p.key, { desired: p.y, top: tops.get(p.key) ?? p.y });
      }
    }
    return [...this.entries.values()].map(e => ({ ...e.placement,
      y: (e.fixed ? e.placement.y : this.packedTop(e.placement)) - scrollTop }));
  }
}
