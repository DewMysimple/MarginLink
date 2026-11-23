import type { MarkdownView, WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { Anchor, GroupMode, WikilinkOccurrence } from '../types';
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
  editorScroll?: ReturnType<EditorView['scrollSnapshot']>;
  reference?: string;
  referenceOffset?: number;
  formattedLinks?: readonly WikilinkOccurrence[];
  groups?: { mode: GroupMode; folded: string[] };
  anchors: Map<string, Anchor>;
  layout: StableLayout;
}
type LeafView = WorkspaceLeaf['view'];
interface OpeningVisit { destination: string; visit: CardVisit; origin: LeafView; target?: LeafView }
interface DirectVisit { destination: string; visit: CardVisit; target: LeafView; returning?: LeafView }
interface LeafVisits {
  visits: Map<string, CardVisit>;
  view: LeafView;
  path?: string;
  epoch: number;
  opening?: OpeningVisit;
  pending?: { view: LeafView; visit: CardVisit };
  direct?: DirectVisit;
  dispose(): void;
}
const filePath = (view: LeafView): string | undefined => {
  const path = view.getState().file;
  return typeof path === 'string' ? path : undefined;
};

/** Associate geometry with the exact native history entry. A normal link to
 * the same file (especially a heading) must keep its own navigation target. */
export class CardNavigation {
  // The host's in-app history can outlive a plugin disable/re-enable.
  private session = globalThis.crypto.getRandomValues(new Uint32Array(4)).join('-');
  private serial = 0;
  private leaves = new Map<WorkspaceLeaf, LeafVisits>();

  async open(view: MarkdownView, destination: string, visit: CardVisit, navigate: () => Promise<void>): Promise<void> {
    const leaf = view.leaf;
    if (leaf.view !== view || view.file?.path !== visit.path) return;
    const state = this.leaves.get(leaf) ?? this.watch(leaf);
    this.observe(leaf, state);
    state.epoch++;
    state.pending = undefined; state.direct = undefined;
    const intent: OpeningVisit = { destination, visit, origin: view };
    state.opening = intent;
    const id = `${this.session}:${++this.serial}`;
    state.visits.set(id, visit);
    if (state.visits.size > 8) state.visits.delete(state.visits.keys().next().value!);
    const original = view.getEphemeralState;
    const capture = () => ({ ...original.call(view), scroll: visit.line, marginLinkVisit: id });
    view.getEphemeralState = capture;
    // openFile captures outgoing history synchronously before switching views.
    try {
      let opening: Promise<void>;
      try { opening = navigate(); }
      finally { if (view.getEphemeralState === capture) view.getEphemeralState = original; }
      await opening;
    } catch (error) {
      state.visits.delete(id);
      if (state.opening === intent) state.opening = undefined;
      throw error;
    }
    if (this.leaves.get(leaf) !== state) return;
    this.observe(leaf, state);
    if (state.opening !== intent) return;
    state.opening = undefined;
    if (state.path === destination && intent.target === state.view) state.direct = { destination, visit, target: state.view };
  }

  private watch(leaf: WorkspaceLeaf): LeafVisits {
    const original = leaf.setEphemeralState;
    const state: LeafVisits = { visits: new Map(), view: leaf.view, path: filePath(leaf.view), epoch: 0, dispose: () => {
      if (leaf.setEphemeralState === receive) leaf.setEphemeralState = original;
      state.visits.clear(); state.pending = undefined; state.direct = undefined; state.opening = undefined;
    } };
    const onReceive = (incoming: unknown) => {
      if (this.leaves.get(leaf) === state) this.receive(leaf, state, incoming);
    };
    const receive = function(this: WorkspaceLeaf, incoming: unknown) {
      if (this === leaf) onReceive(incoming);
      original.call(this, incoming);
    };
    leaf.setEphemeralState = receive;
    this.leaves.set(leaf, state);
    return state;
  }

  private receive(leaf: WorkspaceLeaf, state: LeafVisits, incoming: unknown): void {
    this.observe(leaf, state);
    if (!incoming || typeof incoming !== 'object') return;
    const marker = (incoming as { marginLinkVisit?: unknown }).marginLinkVisit;
    const visit = typeof marker === 'string' ? state.visits.get(marker) : undefined;
    if (visit && visit.path === state.path) {
      state.epoch++; state.opening = undefined; state.direct = undefined;
      state.pending = { visit, view: state.view };
    } else if ('marginLinkVisit' in incoming || 'subpath' in incoming || 'line' in incoming || 'scroll' in incoming || 'cursor' in incoming) {
      state.epoch++; state.pending = undefined;
      // The target's own subpath/scroll can be delivered before openFile
      // completes. Explicit coordinates on the way back belong to native nav.
      if ('marginLinkVisit' in incoming || state.opening?.destination !== state.path) state.opening = undefined;
      if ('marginLinkVisit' in incoming || state.direct?.destination !== state.path) state.direct = undefined;
    }
  }

  private observe(leaf: WorkspaceLeaf, state: LeafVisits): void {
    const view = leaf.view, path = filePath(view);
    if (state.view === view && state.path === path) return;
    state.view = view; state.path = path;
    state.epoch++; state.pending = undefined;
    // A new native view can be attached before the file arrives. Keep waiting
    // through that unnamed phase, but a competing named view owns navigation.
    if (!path) return;
    const opening = state.opening;
    if (opening) {
      if (path === opening.destination && (!opening.target || opening.target === view)) opening.target = view;
      else if (opening.target || path !== opening.visit.path || view !== opening.origin) state.opening = undefined;
    }
    const direct = state.direct;
    if (direct) {
      if (path === direct.visit.path && (!direct.returning || direct.returning === view)) direct.returning = view;
      else if (direct.returning || path !== direct.destination || view !== direct.target) state.direct = undefined;
    }
  }

  take(view: MarkdownView): CardVisit | undefined {
    const leaf = view.leaf, state = this.leaves.get(leaf);
    if (!state || leaf.view !== view || (!state.pending && !state.direct)) return;
    this.observe(leaf, state);
    if (state.pending?.view === view && state.pending.visit.path === view.file?.path) {
      const { visit } = state.pending;
      state.pending = undefined;
      return visit;
    }
    if (state.direct?.returning === view && state.direct.visit.path === view.file?.path) {
      const { visit } = state.direct;
      state.direct = undefined;
      return visit;
    }
  }
  cancel(view: MarkdownView): void {
    const leaf = view.leaf, state = this.leaves.get(leaf), path = view.file?.path;
    if (!state || leaf.view !== view || !path) return;
    this.observe(leaf, state);
    state.epoch++;
    if (state.pending?.view === view) state.pending = undefined;
    if (state.direct?.visit.path === path) state.direct = undefined;
  }
  async restoreMode(view: MarkdownView, visit: CardVisit): Promise<void> {
    const leaf = view.leaf, state = this.leaves.get(leaf);
    if (!state || leaf.view !== view || view.file?.path !== visit.path) return;
    this.observe(leaf, state);
    const epoch = ++state.epoch;
    await view.setState({ ...view.getState(), mode: visit.mode, source: visit.sourceMode }, { history: false });
    if (this.leaves.get(leaf) !== state || state.epoch !== epoch || leaf.view !== view) return;
    if (view.file?.path === visit.path && view.getMode() === visit.mode && (visit.mode !== 'source' || !!view.getState().source === visit.sourceMode))
      state.pending = { visit, view };
  }
  forget(path?: string): void {
    for (const state of this.leaves.values()) {
      for (const [id, visit] of state.visits) if (!path || visit.path === path) { state.visits.delete(id); state.epoch++; }
      if (!path || state.pending?.visit.path === path) state.pending = undefined;
      if (!path || state.direct?.visit.path === path) state.direct = undefined;
      if (!path || state.opening?.visit.path === path) state.opening = undefined;
    }
  }
  retain(live: Set<WorkspaceLeaf>): void {
    for (const [leaf, entry] of this.leaves) {
      if (!live.has(leaf)) { this.leaves.delete(leaf); entry.dispose(); }
      else this.observe(leaf, entry);
    }
  }
}
