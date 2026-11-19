import type { MarkdownView, WorkspaceLeaf } from 'obsidian';
import type { Anchor, GroupMode } from '../types';
import type { StableLayout } from './stable-layout';

export interface CardVisit {
  path: string;
  source: string;
  mode: string;
  sourceMode: boolean;
  geometry: string;
  merged: boolean;
  top: number;
  left: number;
  line: number;
  reference?: string;
  groups?: { mode: GroupMode; folded: string[] };
  anchors: Map<string, Anchor>;
  layout: StableLayout;
}
interface LeafVisits {
  visits: Map<number, CardVisit>;
  pending?: CardVisit;
  direct?: { destination: string; visit: CardVisit };
  dispose(): void;
}

/** Associate geometry with the exact native history entry. A normal link to
 * the same file (especially a heading) must keep its own navigation target. */
export class CardNavigation {
  private serial = 0;
  private leaves = new Map<WorkspaceLeaf, LeafVisits>();

  async open(view: MarkdownView, destination: string, visit: CardVisit, navigate: () => Promise<void>): Promise<void> {
    const leaf = view.leaf;
    let state = this.leaves.get(leaf);
    if (!state) {
      const original = leaf.setEphemeralState;
      const visits = new Map<number, CardVisit>();
      const entry: LeafVisits = { visits, dispose: () => {
        if (leaf.setEphemeralState === receive) leaf.setEphemeralState = original;
      } };
      const receive = function(this: WorkspaceLeaf, incoming: Record<string, unknown> | undefined) {
        entry.pending = visits.get(Number(incoming?.marginLinkVisit));
        if (entry.direct && incoming && ('subpath' in incoming || 'line' in incoming || 'scroll' in incoming || 'cursor' in incoming)
          && this.view.getState().file === entry.direct.visit.path) entry.direct = undefined;
        original.call(this, incoming);
      };
      leaf.setEphemeralState = receive;
      this.leaves.set(leaf, state = entry);
    }
    const id = ++this.serial;
    state.visits.set(id, visit);
    if (state.visits.size > 8) state.visits.delete(state.visits.keys().next().value!);
    const original = view.getEphemeralState;
    const capture = () => ({ ...original.call(view), scroll: visit.line, marginLinkVisit: id });
    view.getEphemeralState = capture;
    // openFile captures outgoing history synchronously before switching views.
    let opening: Promise<void>;
    try { opening = navigate(); }
    finally { if (view.getEphemeralState === capture) view.getEphemeralState = original; }
    await opening;
    if (leaf.view.getState().file === destination) state.direct = { destination, visit };
  }

  take(view: MarkdownView): CardVisit | undefined {
    const state = this.leaves.get(view.leaf);
    if (!state) return;
    const path = view.file?.path;
    const visit = state.pending ?? state.direct?.visit;
    if (state.direct?.destination !== path) state.direct = undefined;
    state.pending = undefined;
    return visit?.path === path ? visit : undefined;
  }
  async restoreMode(view: MarkdownView, visit: CardVisit): Promise<void> {
    const state = this.leaves.get(view.leaf);
    if (!state) return;
    await view.setState({ ...view.getState(), mode: visit.mode, source: visit.sourceMode }, { history: false });
    if (view.file?.path === visit.path && view.getMode() === visit.mode && (visit.mode !== 'source' || !!view.getState().source === visit.sourceMode))
      state.pending = visit;
  }
  forget(path?: string): void {
    for (const state of this.leaves.values()) {
      for (const [id, visit] of state.visits) if (!path || visit.path === path) state.visits.delete(id);
      if (!path || state.pending?.path === path) state.pending = undefined;
      if (!path || state.direct?.visit.path === path) state.direct = undefined;
    }
  }
  retain(live: Set<WorkspaceLeaf>): void {
    for (const [leaf, entry] of this.leaves) {
      if (!live.has(leaf)) { entry.dispose(); this.leaves.delete(leaf); continue; }
      if (entry.direct) {
        const file = leaf.view.getState().file;
        if (file && file !== entry.direct.destination && file !== entry.direct.visit.path) entry.direct = undefined;
      }
    }
  }
}
