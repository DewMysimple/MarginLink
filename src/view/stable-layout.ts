import { CARD_GAP, clamp, displayPosition, layoutCards, packInitialSlots, type LayoutInput, type Placement } from './layout-engine';

interface Slot { placement: Placement; offset: number }
interface Entry extends Slot { manual: string; fixed: boolean }
interface DisplaySlot { desired: number; offset: number; placement: Placement }
// One instance per MarkdownView. Coordinates and automatic decisions live only
// in memory; a scroll neither changes persisted positions nor solves old cards.
export class StableLayout {
  private entries = new Map<string, Entry>();
  private geometry = '';
  private mode?: string;
  private automatic = new Map<string, Slot>();
  private initial = new Map<string, Slot>();
  private packed = new Map<string, { desired: number; top: number }>();
  private displayed = new Map<string, DisplaySlot>();
  copy(): StableLayout {
    const copy = new StableLayout();
    Object.assign(copy, structuredClone({ entries: this.entries, automatic: this.automatic, initial: this.initial,
      packed: this.packed, displayed: this.displayed, geometry: this.geometry, mode: this.mode }));
    return copy;
  }
  translateY(delta: number): void {
    // Some initial slots share their placement with an entry.
    const placements = new Set<Placement>();
    for (const slots of [this.entries, this.automatic, this.initial]) for (const slot of slots.values()) placements.add(slot.placement);
    for (const slot of this.packed.values()) { slot.desired += delta; slot.top += delta; }
    for (const slot of this.displayed.values()) { slot.desired += delta; placements.add(slot.placement); }
    for (const placement of placements) placement.y += delta;
  }
  clear(): void { this.entries.clear(); this.automatic.clear(); this.initial.clear(); this.packed.clear(); this.displayed.clear(); this.geometry = ''; this.mode = undefined; }
  retain(keys: { has(key: string): boolean }): void {
    for (const key of this.entries.keys()) if (!keys.has(key)) {
      this.entries.delete(key); this.automatic.delete(key); this.initial.delete(key); this.packed.delete(key); this.displayed.delete(key);
    }
  }
  private packedTop(p: Placement): number {
    const slot = this.packed.get(p.key);
    return slot ? slot.top + (p.y - slot.desired) : p.y;
  }
  initialOffset(key: string): number | undefined { return this.automatic.get(key)?.offset; }
  /** Reserve unchanged physical rectangles first. A corrected text measurement,
   * legacy manual overlap or new arrival only has to find space for itself. */
  private project(input: LayoutInput, scrollTop: number): Placement[] {
    const occupied: Placement[] = [], arrivals: Placement[] = [];
    const moving: { slot: DisplaySlot; target: number }[] = [];
    let changed = false;
    for (const entry of this.entries.values()) {
      const p = entry.placement, desired = entry.fixed ? p.y : this.packedTop(p);
      const slot = this.displayed.get(p.key);
      if (!slot) { arrivals.push({ ...p, y: desired }); continue; }
      // Loading an embedded image can move text past entire rows. An old
      // offscreen estimate must not fence that text's card into the old column
      // order. Refit at the new reference when it has passed a full card.
      if (Math.abs(desired + slot.offset - slot.placement.y) >= p.height + CARD_GAP) {
        arrivals.push({ ...p, y: desired }); continue;
      }
      occupied.push(slot.placement);
      if (slot.desired !== desired || slot.placement.y !== desired + slot.offset) {
        changed ||= slot.desired !== desired;
        slot.desired = desired; moving.push({ slot, target: desired + slot.offset });
      }
    }
    // Move the leading edge of a translating column first. Keep each old
    // neighbour in its own slot even when only part of the text is remeasured.
    const order = (move: typeof moving[number]) => move.target < move.slot.placement.y ? move.slot.placement.y : -move.slot.placement.y;
    if (changed || arrivals.length) moving.sort((a, b) => order(a) - order(b));
    else moving.length = 0;
    for (const { slot, target } of moving) {
      const p = slot.placement;
      let min = -Infinity, max = Infinity;
      for (const other of occupied) {
        if (p === other || p.x >= other.x + other.width + CARD_GAP || other.x >= p.x + p.width + CARD_GAP) continue;
        if (other.y < p.y) min = Math.max(min, other.y + other.height + CARD_GAP);
        else max = Math.min(max, other.y - p.height - CARD_GAP);
      }
      p.y = clamp(target, min, max);
    }
    for (const p of arrivals) {
      const placement = displayPosition(p, input, occupied);
      occupied.push(placement); this.displayed.set(p.key, { desired: p.y, offset: placement.y - p.y, placement });
    }
    return Array.from(this.entries.keys(), key => {
      const p = this.displayed.get(key)!.placement;
      return { ...p, y: p.y - scrollTop };
    });
  }
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
      if (entry && entry.manual !== manualKey(a)) { this.entries.delete(a.key); this.displayed.delete(a.key); }
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
      return this.project(input, scrollTop);
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
        // A gesture keeps its canonical reservation. The drop solver only
        // changes the selected card's position.
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
    return this.project(input, scrollTop);
  }
}
