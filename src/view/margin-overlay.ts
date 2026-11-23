import { MarkdownView, Menu, Notice, type App } from 'obsidian';
import type { Anchor, Preferences, RelativePosition, WikilinkOccurrence } from '../types';
import { EditorView } from '@codemirror/view';
import { ReferenceList } from './reference-list';
import { groupOccurrencesByResolvedTarget, referenceCardAnchors, type ReferenceGroup } from './reference-groups';
import { GroupControls } from './group-controls';
import type { EditorBridge } from '../editor/editor-extension';
import type { ReadingAnchors } from '../reading/reading-anchors';
import type { SelectionAction } from '../editor/selection-action';
import type { LayoutStore } from '../core/layout-store';
import { DragController } from '../editor/drag-controller';
import { CardDragController, type CardDragContext } from './card-drag-controller';
import { resolveLink } from '../core/link-resolver';
import { originalLinkText } from '../core/relink';
import type { FileRecognition } from '../core/file-recognition';
import { canOpenInObsidian } from '../core/file-capabilities';
import { dimensions, lane, positionFromDrop, positionRelative, type Box, type LayoutInput, type Placement } from './layout-engine';
import { renderCard } from './card-renderer';
import { cardTooltip } from './card-tooltip';
import { TargetPreview, previewSpace, type PreviewTarget } from './target-preview';
import { type PortChoice } from './connector-renderer';
import { connectorBatch, ConnectorRouteCache, type ConnectorBatch, type BatchRelationInput } from './connector-batch';
import { applyAppearance } from './appearance';
import { parseWikilinks } from '../core/wikilink-parser';
import { StableLayout } from './stable-layout';
import type { CardNavigation, CardVisit } from './card-navigation';
import { TextObstacles } from './text-obstacles';
import { relationNumberPair, containsBox } from './continuation';
import { NativeScrollLayer } from './native-scroll-layer';

interface Relation {
  shell: HTMLDivElement;
  button: HTMLButtonElement;
  path: SVGPathElement;
  anchor: Anchor;
  placement: Placement;
  ports?: PortChoice;
  routeBounds?: Box;
  continuation?: [HTMLButtonElement, HTMLButtonElement];
  targetFraction?: number;
  routeData?: DOMStringMap;
}
interface Card extends Relation {
  group?: ReferenceGroup;
  badge?: HTMLButtonElement;
  signature: string;
  placementStyle?: string;
  generation: number;
}
const MAX_COLLAPSED_CARDS = 128;
const RETURN_PIXEL_TOLERANCE = 0.51;
interface ReturningVisit {
  visit: CardVisit;
  scroller: HTMLElement;
  until: number;
  firstLayoutDeadline: number;
  positioned: boolean;
  rendered: boolean;
  waitedForPreview: boolean;
  reusedLayout: boolean;
  layoutShift: number;
}
export interface OverlayHost {
  cardNavigation: CardNavigation;
  fileRecognition: FileRecognition;
  app: App; preferences: Preferences; bridges: Set<EditorBridge>;
  reading: ReadingAnchors; selection: SelectionAction; layouts: LayoutStore;
}
export class MarginOverlay {
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private cardLayer: HTMLDivElement;
  private decorations: NativeScrollLayer;
  private drag: DragController;
  private cardDrag: CardDragController;
  private cards = new Map<string, Card>();
  private collapsedCards = new Map<string, Card>();
  private referenceIndex?: ReturnType<typeof groupOccurrencesByResolvedTarget>;
  private visibleRelations?: Map<string, Relation>;
  private referenceList?: ReferenceList;
  private located?: string;
  private pendingReadingLocate?: WikilinkOccurrence;
  private locateTimer?: number;
  private continuationNumbers = new Map<string, number>();
  private routePlacements: Placement[] = [];
  private batch?: ConnectorBatch;
  private routeCache = new ConnectorRouteCache();
  private batchSignature = '';
  private sharedPaths = new Map<string, SVGPathElement>();
  private menus = new Set<Menu>();
  private anchors: Anchor[] = [];
  private resize: ResizeObserver;
  private mutation: MutationObserver;
  private frame = 0;
  private stopped = false;
  private path = '';
  private mode = '';
  private revision = -1;
  private observedSource?: string;
  private confirmedSource = '';
  private confirmedText = '';
  private sourceGeneration = 0;
  private checkingSource = false;
  private sourceRetries = 0;
  private sourceRetryTimer?: number;
  private legacyLayoutStore?: LayoutStore;
  private legacyLayoutKeys = new Map<string, string>();
  private layoutInput?: LayoutInput;
  private stableLayout = new StableLayout();
  private contentAnchors = new Map<string, Anchor>();
  private layoutGeometry = '';
  private layoutSource = '';
  private validOccurrences = new Map<string, string>();
  private textObstacles = new TextObstacles();
  private obstacles: readonly Box[] = [];
  private scrollTop = 0;
  private scroller?: HTMLElement;
  private scrolling = false;
  private scrollIdleTimer?: number;
  private resizing = false;
  private demandHoverRoutes = false;
  private resizeIdleTimer?: number;
  private resizePointer?: number;
  private paneWidth?: number;
  private returning?: ReturningVisit;
  private previewReturnTimer?: number;
  private cancelReturn(): void {
    this.returning = undefined;
    this.clearPreviewReturnTimer();
  }
  private onReturnInput = (): void => {
    if (this.returning) this.schedule();
    this.cancelReturn();
    this.host.cardNavigation.cancel(this.view);
  };
  private geometrySignature = '';
  private textGeometry = '';
  private bodyTop?: number;
  private bodyHeight?: number;
  private hostRect?: DOMRect;
  private preview?: TargetPreview;
  private appearance = '';
  private groups?: GroupControls;
  private occurrences: readonly WikilinkOccurrence[] = [];
  private highlighted?: string;
  private pinned?: string;
  private hovered?: string;
  private focused?: string;
  private anchorInk: HTMLSpanElement[] = [];
  private highlightedElements: HTMLElement[] = [];
  private observedBody?: HTMLElement;
  private measurementsDirty = true;
  private measuredTop = Infinity;
  private measuredBottom = -Infinity;
  private geometryRevision = 0;
  private markerSignature = '';
  /** Enabled only by an explicit development probe; no persistent telemetry. */
  diagnostics?: { routeSearches?: number; groupRecomputes?: number; renders: number; measurements: number; routes: number; svgWrites: number; markerWrites: number; work: number[] };
  private win: Window;
  constructor(readonly view: MarkdownView, private host: OverlayHost) {
    const container = view.contentEl;
    this.win = container.ownerDocument.defaultView!;
    container.classList.add('margin-link-host');
    this.root = container.createDiv({ cls: 'margin-link-overlay' });
    this.decorations = new NativeScrollLayer(container.ownerDocument);
    this.svg = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('margin-link-connectors'); this.svg.setAttribute('aria-hidden', 'true');
    this.decorations.canvas.appendChild(this.svg);
    this.cardLayer = this.decorations.canvas.createDiv();
    this.drag = new DragController(this.root, view, host.selection);
    this.cardDrag = new CardDragController(this.root, key => this.dragContext(key), (key, p) => {
      const card = this.cards.get(key);
      if (card && p) {
        this.routePlacements = this.routePlacements.map(c => c.key === key ? p : c);
        this.place(card, p);
        for (const [id, other] of this.cards) if (id !== key) this.place(other, other.placement);
        const scope = this.hoverRouteScope(this.highlighted);
        this.paintConnectors(scope);
        this.updateContinuations(scope);
      }
      else this.schedule();
    }, (key, relative) => this.savePosition(key, relative));
    this.mutation = new MutationObserver(records => {
      const removedLayer = !this.decorations.element.isConnected && records.find(r =>
        r.type === 'childList' && [...r.removedNodes].includes(this.decorations.element));
      // A reading section refresh can remove the layer after the frame already
      // ran. Restore the same live parent before paint; still refresh geometry.
      if (removedLayer && this.mode === 'preview' && this.view.getMode() === 'preview' &&
        this.path === this.view.file?.path && this.confirmedSource === this.path && !this.root.hidden &&
        this.host.preferences.enabled && container.contains(removedLayer.target)) this.decorations.reattachAfterRemoval(removedLayer.target);
      const measurementsChanged = records.some(r => {
        // Style records for transient ink or a dismissed panel can be delivered
        // after removal. Detached targets cannot change this pane's geometry.
        if (!container.contains(r.target) || this.root.contains(r.target) || this.decorations.contains(r.target)) return false;
        if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(node => this.decorations.contains(node))) return false;
        if (r.type === 'attributes' && r.attributeName === 'class') {
          const strip = (v: string) => v.replace(/\bmargin-link-[\w-]+\b/g, '').trim();
          if (strip(r.oldValue ?? '') === strip((r.target as Element).getAttribute('class') ?? '')) return false;
        }
        return true;
      });
      if (measurementsChanged) { this.measurementsDirty = true; this.textObstacles.invalidate(); }
      if (removedLayer || measurementsChanged) this.schedule();
    });
    this.mutation.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
    // A shrinking lane must be corrected before paint. Skip an observer pass
    // when rAF already rendered its geometry, but still draw actual changes here.
    this.resize = new ResizeObserver(() => this.flushFrame(true)); this.resize.observe(container);
    container.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    container.addEventListener('pointermove', this.onPointerMove); container.addEventListener('pointerleave', this.onLeave);
    container.addEventListener('focusin', this.onAnchorFocus);
    container.addEventListener('focusout', this.onAnchorBlur);
    container.addEventListener('keydown', this.onEscape);
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) container.addEventListener(event, this.onReturnInput, { capture: true, passive: true });
    this.win.addEventListener('resize', this.schedule);
    this.win.addEventListener('pointerdown', this.onResizePointerDown, true);
    this.win.addEventListener('pointerup', this.onResizePointerEnd, true);
    this.win.addEventListener('pointercancel', this.onResizePointerEnd, true);
    this.win.addEventListener('blur', this.releaseResizePointer);
    container.ownerDocument.fonts?.addEventListener('loadingdone', this.onFontsLoaded); this.schedule();
  }
  bridge(): EditorBridge | undefined { return [...this.host.bridges].find(b => b.alive && this.view.contentEl.contains(b.cm.dom)); }
  schedule = (): void => {
    if (!this.stopped && !this.frame) this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.flushFrame(); });
  };
  private trackPaneWidth(width: number): void {
    if (this.paneWidth !== undefined && this.paneWidth !== width) {
      if (this.host.preferences.lines === 'hover') this.demandHoverRoutes = true;
      this.resizing = true; this.scheduleResizeSettlement();
    }
    this.paneWidth = width;
  }
  private scheduleResizeSettlement(): void {
    this.win.clearTimeout(this.resizeIdleTimer); this.resizeIdleTimer = undefined;
    // Real divider holds can pause for much longer than the quiet interval.
    // Programmatic resizes and unidentified handles fall back to width activity.
    if (this.resizePointer !== undefined) return;
    this.resizeIdleTimer = this.win.setTimeout(() => {
      this.resizeIdleTimer = undefined; this.resizing = false; this.clearCollapsedCards(); this.schedule();
    }, 160);
  }
  private onResizePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.resizePointer !== undefined) return;
    const target = event.target as Element | null;
    if (!target?.closest?.('.workspace-leaf-resize-handle, .workspace-resize-handle')) return;
    this.resizePointer = event.pointerId;
    if (this.resizing) this.scheduleResizeSettlement();
  };
  private onResizePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.resizePointer) this.releaseResizePointer();
  };
  private releaseResizePointer = (): void => {
    if (this.resizePointer === undefined) return;
    this.resizePointer = undefined;
    if (this.resizing) this.scheduleResizeSettlement();
  };
  private resetResize(): void {
    this.win.clearTimeout(this.resizeIdleTimer); this.resizeIdleTimer = undefined;
    this.clearCollapsedCards();
    this.resizing = false; this.demandHoverRoutes = false; this.resizePointer = undefined; this.paneWidth = undefined;
  }
  private onScroll = (event: Event): void => {
    if (event.target === this.scroller) {
      this.preview?.close();
      this.scrolling = true; this.win.clearTimeout(this.scrollIdleTimer);
      // A wheel packet can emit scrollend in the very same event turn. Wait
      // for a short quiet interval before optional corridor exploration instead.
      this.scrollIdleTimer = this.win.setTimeout(() => {
        this.scrollIdleTimer = undefined; this.scrolling = false; this.schedule();
      }, 160);
    }
    this.schedule();
  };
  private onFontsLoaded = (): void => {
    this.layoutGeometry = ''; this.measurementsDirty = true; this.textObstacles.invalidate(); this.schedule();
  };
  invalidateReadingAnchors(): void {
    this.measurementsDirty = true; this.textObstacles.invalidate(); this.schedule();
  }
  observeSource(): void {
    const source = this.view.file?.path ?? '';
    if (this.observedSource === source) return;
    this.observedSource = source;
    this.confirmedSource = ''; this.confirmedText = ''; this.sourceGeneration++;
    this.checkingSource = false; this.sourceRetries = 0;
    this.legacyLayoutStore = undefined; this.legacyLayoutKeys.clear();
    this.win.clearTimeout(this.sourceRetryTimer); this.sourceRetryTimer = undefined;
    this.cancelReturn();
  }
  private flushFrame = (fromResize = false): void => {
    if (this.stopped) return;
    const start = this.diagnostics ? performance.now() : 0;
    const rendered = this.render(fromResize);
    if (rendered !== false && this.diagnostics) { this.diagnostics.renders++; this.diagnostics.work.push(performance.now() - start); }
  };
  invalidatePreview(path: string): void { this.preview?.invalidate(path); }
  invalidateGroups(): void { this.groups?.invalidate(); this.referenceIndex = undefined; this.referenceList?.close(); }
  openGroups(): void { this.groups?.open(); }
  cancelInteractions(): void { this.referenceList?.close(); this.preview?.close(); cardTooltip.hideWithin(this.root); this.cardDrag.cancel(); this.drag.cancel(); }
  resetLayout(): void {
    this.cancelReturn(); this.cancelInteractions(); this.stableLayout.clear(); this.schedule();
  }
  /** Snapshot only this confirmed note's measured coordinates. Relative UI
   * records survive navigation; no unmeasured or ambiguous link is invented. */
  freezeLayout(overwrite = true, claimed?: Set<string>): boolean {
    const input = this.layoutInput;
    if (this.visibleRelations || input?.preferences?.mergeReferences || !input || this.cardDrag.dragging || this.confirmedSource !== this.path || this.view.file?.path !== this.path || this.view.getMode() !== this.mode) return false;
    const source = this.mode === 'source' ? this.bridge()?.text : this.view.data;
    if (source === undefined || source !== this.layoutSource) return false;
    const byKey = new Map(input.anchors.map(anchor => [anchor.key, anchor]));
    const positions = [...this.cards.values()].flatMap(card => {
      const key = card.anchor.layoutKey, anchor = byKey.get(card.placement.key);
      if (!key || !anchor || claimed?.has(key) || (!overwrite && anchor.manual)) return [];
      const fixed = input.preferences?.placementMode === 'manual' || (input.preferences?.placementMode !== 'auto' && anchor.manual && !anchor.manual.initial);
      const origin: 'manual' | 'initial' = fixed ? 'manual' : 'initial';
      // Store the requested automatic slot on first sight. Baking a temporary
      // collision adjustment into one new record would apply it again on restore.
      const offset = !overwrite && !fixed ? this.stableLayout.initialOffset(anchor.key) : undefined;
      const position = positionRelative(input, anchor, offset === undefined ? card.placement : { ...card.placement, y: anchor.y + offset });
      return position && Math.abs(position.yOffset) <= 80 ? [{ key, position, origin, legacyKey: this.legacyLayoutKeys.get(key) }] : [];
    });
    if (!positions.length) return false;
    this.host.layouts.setMany(this.path, positions, overwrite);
    for (const position of positions) claimed?.add(position.key);
    return true;
  }
  private render(fromResize = false): false | void {
    const container = this.view.contentEl;
    const mode = this.view.getMode();
    this.observeSource();
    if (this.path !== this.observedSource || this.mode !== mode) {
      this.path = this.observedSource ?? ''; this.mode = mode; this.revision = -1;
      this.cancelInteractions(); this.clearCards();
    }
    const prefs = this.host.preferences, hostRect = container.getBoundingClientRect();
    this.hostRect = hostRect;
    const hidden = !prefs.enabled || !this.path || hostRect.width < 1 || hostRect.height < 1;
    if (this.root.hidden !== hidden) this.root.hidden = hidden;
    if (this.decorations.element.hidden !== hidden) this.decorations.element.hidden = hidden;
    if (this.root.hidden) {
      this.resetResize();
      this.cancelInteractions();
      if (!prefs.enabled || !this.path) this.clearCards();
      return;
    }
    if (!!this.visibleRelations !== prefs.mergeReferences) {
      this.cancelInteractions(); this.clearCards();
      this.visibleRelations = prefs.mergeReferences ? new Map() : undefined;
    }
    const bridge = mode === 'source' ? this.bridge() : undefined;
    // MarkdownView.file can already name the next note while CodeMirror still
    // contains the old one. Do not draw or accept a drop until that source's
    // complete loaded text has been confirmed; this never prunes UI records.
    if ((mode === 'source' && !bridge) || !this.sourceReady(bridge)) {
      this.cancelInteractions(); this.clearCards(); return;
    }
    if (bridge && this.revision !== bridge.revision) {
      this.cardDrag.cancel(); this.revision = bridge.revision;
    }
    const scroller = bridge?.cm.scrollDOM ?? this.view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-view') ?? this.view.previewMode.containerEl;
    if (this.scroller !== scroller) {
      this.win.clearTimeout(this.scrollIdleTimer); this.scrollIdleTimer = undefined;
      this.scroller = scroller; this.scrolling = false;
    }
    const bodyEl = bridge?.cm.contentDOM ?? this.view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-sizer');
    if (!bodyEl) { this.cancelInteractions(); this.clearCards(); return; }
    const replacedBody = this.observedBody !== bodyEl;
    if (replacedBody) {
      if (this.observedBody) this.resize.unobserve(this.observedBody);
      this.observedBody = bodyEl; this.resize.observe(bodyEl);
    }
    const rect = bodyEl.getBoundingClientRect(), scroll = scroller.getBoundingClientRect(), style = this.win.getComputedStyle(bodyEl);
    const scrollTop = scroller.scrollTop, scrollLeft = scroller.scrollLeft;
    const client = { left: scroll.left + scroller.clientLeft, top: scroll.top + scroller.clientTop, width: scroller.clientWidth };
    const paddingLeft = parseFloat(style.paddingLeft) || 0, paddingRight = parseFloat(style.paddingRight) || 0;
    const body: Box = {
      left: Math.max(0, rect.left - hostRect.left + paddingLeft),
      right: Math.min(hostRect.width, rect.right - hostRect.left - paddingRight), top: 0, bottom: hostRect.height
    };
    // The client area excludes native scrollbar gutters and borders. Overlay
    // buttons must never cover a scrollbar, even at xNormalized=1.
    const viewport: Box = {
      left: Math.max(0, client.left - hostRect.left),
      right: Math.min(hostRect.width, client.left + client.width - hostRect.left),
      top: Math.max(0, client.top - hostRect.top),
      bottom: Math.min(hostRect.height, client.top + scroller.clientHeight - hostRect.top)
    };
    const lineHeight = Math.max(12, Math.min(72, parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 24));
    const layoutInput: LayoutInput = {
      width: hostRect.width, height: hostRect.height, body, viewport, density: prefs.density, layout: prefs.layout,
      preferences: prefs, lineHeight, anchors: []
    };
    const leftFits = !!dimensions(layoutInput, 'left'), rightFits = !!dimensions(layoutInput, 'right');
    const hasCardLanes = leftFits || rightFits;
    const geometry = [hostRect.left, hostRect.top, hostRect.width, hostRect.height, body.left, body.right, ...Object.values(viewport)].join(':');
    const livePreview = bridge?.cm.dom.closest('.markdown-source-view')?.classList.contains('is-live-preview');
    // Pane bounds can move without changing a single text fragment. Reuse only
    // within the same body's width, content origin, typography and DOM revision.
    const bodyTop = Math.round((rect.top - hostRect.top + scrollTop) * 10000) / 10000;
    const textGeometry = [rect.left - hostRect.left, rect.width, scrollLeft, style.padding, style.font, style.lineHeight,
      style.letterSpacing, style.wordSpacing, style.whiteSpace, style.wordBreak,
      style.overflowWrap, style.textIndent, style.writingMode, style.direction, style.transform, livePreview].join(':');
    if (fromResize && !replacedBody && geometry === this.geometrySignature && textGeometry === this.textGeometry &&
      bodyTop === this.bodyTop && rect.height === this.bodyHeight && scrollTop === this.scrollTop &&
      (!this.measurementsDirty || !hasCardLanes)) return false;
    if (fromResize && this.frame) { this.win.cancelAnimationFrame(this.frame); this.frame = 0; }
    this.trackPaneWidth(hostRect.width);
    if (geometry !== this.geometrySignature) {
      this.geometrySignature = geometry; this.preview?.close(); cardTooltip.hideWithin(this.root);
    }
    const geometryKey = [hostRect.width, body.left, body.right, viewport.left, viewport.right, viewport.top, scrollLeft,
      prefs.density, prefs.layout, prefs.placementMode, prefs.cardShape, prefs.cardSize, prefs.edgePadding,
      style.font, style.lineHeight, style.letterSpacing, livePreview].join(':');
    const source = bridge?.text ?? this.view.data;
    const sourceChanged = this.layoutSource !== source;
    if (sourceChanged) {
      this.clearFocus(); this.preview?.close();
      this.clearCollapsedCards();
      const occurrences = bridge?.parsed.links ?? parseWikilinks(source);
      this.referenceList?.close(); this.clearLocated(); this.referenceIndex = undefined;
      this.occurrences = occurrences;
      this.validOccurrences = new Map(occurrences.map(a => [String(a.start), a.raw]));
      this.continuationNumbers = new Map(occurrences.map((a, index) => [String(a.start), index + 1]));
    }
    const textChanged = replacedBody || this.textGeometry !== textGeometry || sourceChanged;
    if (this.layoutGeometry !== geometryKey || textChanged) {
      this.stableLayout.clear(); this.geometryRevision++;
      this.layoutGeometry = geometryKey;
    }
    if (textChanged) {
      this.contentAnchors.clear(); this.textObstacles.invalidate(); this.measurementsDirty = true;
      this.layoutSource = source; this.textGeometry = textGeometry;
      if (sourceChanged || replacedBody) this.routeCache?.clear();
    }
    if (bodyTop !== this.bodyTop || rect.height !== this.bodyHeight) {
      this.bodyTop = bodyTop; this.bodyHeight = rect.height;
      this.textObstacles.invalidate(); this.measurementsDirty = true;
    }
    const visit = this.host.cardNavigation.take(this.view);
    if (visit && (visit.mode !== mode || (mode === 'source' && visit.sourceMode !== !!this.view.getState().source))) {
      void this.host.cardNavigation.restoreMode(this.view, visit).then(this.schedule, this.schedule);
      return;
    }
    if (visit && visit.source === source) {
      const now = performance.now();
      this.returning = { visit, scroller, positioned: false, rendered: false, waitedForPreview: false,
        reusedLayout: false, layoutShift: 0, until: now + 3000, firstLayoutDeadline: now + 250 };
      if (prefs.lines === 'hover') this.demandHoverRoutes = true;
      this.measurementsDirty = true; this.textObstacles.invalidate();
    }
    if (this.returning && (this.returning.until < performance.now() || this.returning.visit.source !== source ||
      this.returning.scroller !== scroller)) this.cancelReturn();
    const returning = this.returning;
    if (returning && bridge && !returning.rendered && !returning.visit.sourceMode && this.waitForLivePreview(returning, bridge, !!livePreview)) return;
    const deferCards = returning?.waitedForPreview;
    if (returning) returning.waitedForPreview = false;
    const layoutMatches = returning?.visit.geometry === geometryKey && returning.visit.merged === prefs.mergeReferences;
    if (returning && !layoutMatches) returning.reusedLayout = false;
    if (returning && layoutMatches && (!returning.reusedLayout || textChanged)) {
      this.contentAnchors = new Map(returning.visit.anchors); this.stableLayout = returning.visit.layout.copy();
      this.groups?.destroy(); this.groups = undefined;
      returning.reusedLayout = true; returning.layoutShift = 0;
      this.measurementsDirty = true; this.textObstacles.invalidate();
    }
    if (this.pendingReadingLocate && mode === 'preview') {
      const element = this.host.reading.elementFor(this.view, this.pendingReadingLocate);
      if (element) {
        this.pendingReadingLocate = undefined;
        element.scrollIntoView({ block: 'center' });
        this.measurementsDirty = true; this.schedule();
      }
    }
    const scrolling = !!returning || this.scrolling || this.scrollTop !== scrollTop;
    this.scrollTop = scrollTop;
    // A returning pane can still use the native text anchor with no card lanes.
    const measure = (hasCardLanes || returning) && (this.measurementsDirty || viewport.top + scrollTop < this.measuredTop || viewport.bottom + scrollTop > this.measuredBottom);
    if (measure) {
      const overscan = Math.max(160, viewport.bottom - viewport.top);
      this.measuredTop = viewport.top + scrollTop - overscan; this.measuredBottom = viewport.bottom + scrollTop + overscan;
      this.geometryRevision++; if (this.diagnostics) this.diagnostics.measurements++;
    }
    const contentBox = (r: Box): Box => ({ left: r.left - hostRect.left, right: r.right - hostRect.left,
      top: r.top - hostRect.top + scrollTop, bottom: r.bottom - hostRect.top + scrollTop });
    if (measure) {
      // A reading rerender can synchronously retire a section and request
      // another measurement. Let that invalidation survive this pass.
      this.measurementsDirty = false;
      const measured = bridge ? bridge.anchors() : this.host.reading.anchors(this.view, Math.max(80 * lineHeight + 100, viewport.bottom - viewport.top));
      // CM and Reading view may rebuild virtual spacers at different heights.
      // Restore the native text's screen position and translate every old slot
      // by that same document-origin change, including unmounted references.
      if (returning) {
        const saved = returning.visit;
        const previous = saved.reference === undefined ? undefined : saved.anchors.get(saved.reference);
        const current = previous && measured.find(a => a.key === previous.key && a.occurrence.raw === previous.occurrence.raw);
        let top = saved.top;
        if (previous && current) {
          const shift = current.rect.top - hostRect.top + scrollTop - previous.rect.top;
          const delta = shift - returning.layoutShift;
          if (returning.reusedLayout && delta) {
            const move = (box: Box) => ({ ...box, top: box.top + delta, bottom: box.bottom + delta });
            for (const [key, a] of this.contentAnchors) this.contentAnchors.set(key, { ...a, rect: move(a.rect), fragments: a.fragments.map(move) });
            this.stableLayout.translateY(delta); returning.layoutShift = shift;
          }
          top = saved.referenceOffset === undefined ? saved.top + shift
            : scrollTop + current.rect.top - client.top - saved.referenceOffset;
        }
        const maxTop = scroller.scrollHeight - scroller.clientHeight;
        if (!returning.positioned && !current && !bridge && (maxTop > 0 || saved.top === 0)) {
          // Reading can report the right scrollTop before its visible sections
          // are attached. Give the native sizer a frame before mounting cards.
          returning.positioned = true;
          scroller.scrollTo({ left: saved.left, top: saved.top, behavior: 'instant' });
          this.measurementsDirty = true; this.schedule(); return;
        }
        if (!bridge && !returning.rendered && previous && !current && this.waitForReturnLayout(returning.firstLayoutDeadline)) {
          this.measurementsDirty = true; return;
        }
        if (!returning.positioned && !current && bridge && saved.editorScroll &&
          (previous || Math.abs(scrollTop - top) > RETURN_PIXEL_TOLERANCE)) {
          returning.positioned = true;
          bridge.cm.dispatch({ effects: saved.editorScroll });
          this.measurementsDirty = true; this.schedule(); return;
        }
        if (current || (!returning.positioned && (maxTop > 0 || saved.top === 0))) {
          top = Math.max(0, Math.min(maxTop, top));
          const left = returning.positioned ? scrollLeft : saved.left;
          returning.positioned = true;
          if (Math.abs(scrollTop - top) > RETURN_PIXEL_TOLERANCE || scrollLeft !== left) {
            scroller.scrollTo({ left, top, behavior: 'instant' });
            if (scroller.scrollTop !== scrollTop || scroller.scrollLeft !== scrollLeft) {
              this.measurementsDirty = true; this.schedule(); return;
            }
          }
        }
      }
      if (returning) this.clearPreviewReturnTimer();
      if (prefs.mergeReferences) measured.sort((a, b) => a.occurrence.start - b.occurrence.start);
      for (const anchor of measured) {
        if (this.validOccurrences.get(anchor.key) !== anchor.occurrence.raw) continue;
        this.contentAnchors.set(anchor.key, { ...anchor, rect: contentBox(anchor.rect), fragments: anchor.fragments.map(contentBox) });
      }
    }
    if (deferCards) {
      // Correct the native viewport as soon as its text is formatted. Give
      // CodeMirror one more measurement before overlaying cards on that text.
      this.measurementsDirty = true;
      this.schedule(); return;
    }
    const screenBox = (r: Box): Box => ({ left: r.left + hostRect.left, right: r.right + hostRect.left,
      top: r.top + hostRect.top - scrollTop, bottom: r.bottom + hostRect.top - scrollTop });
    this.anchors = hasCardLanes ? [...this.contentAnchors.values()].map(a => ({ ...a, rect: screenBox(a.rect), fragments: a.fragments.map(screenBox) })) : [];
    // When a resize has made hover routing demand-driven, a dormant pane only
    // needs anchor geometry. Leave obstacles invalidated until a route needs
    // them. Prepare an active route before mounting or changing decoration DOM.
    if (hasCardLanes && (prefs.lines === 'always' || (prefs.lines === 'hover' && (!this.demandHoverRoutes || this.focusCandidate() !== undefined)))) {
      this.measureTextObstacles(hostRect, viewport);
    }
    const sizerHeight = this.decorations.mount(bodyEl, rect, hostRect, scrollTop, client);
    if (this.svg.getAttribute('width') !== String(hostRect.width)) this.svg.setAttribute('width', String(hostRect.width));
    if (this.svg.getAttribute('height') !== String(sizerHeight)) this.svg.setAttribute('height', String(sizerHeight));
    // Clip the complete overlay (including pointer hit testing) to this note's
    // scroll region. Offscreen text and cards have independent intersection.
    const clip = `inset(${viewport.top}px ${hostRect.width - viewport.right}px ${hostRect.height - viewport.bottom}px ${viewport.left}px)`;
    if (this.root.style.clipPath !== clip) this.root.style.clipPath = clip;
    const appearance = [prefs.lines, prefs.reduceMotion, prefs.hoverFeedback, prefs.showPath, prefs.dragHints, prefs.lineColor,
      prefs.lineWidth, prefs.lineOpacity, prefs.cardRadius, prefs.cardBorder, prefs.cardShadow].join(':');
    if (this.appearance !== appearance) {
      applyAppearance(this.root, prefs);
      applyAppearance(this.decorations.element, prefs);
      this.appearance = appearance;
    }
    if (prefs.mergeReferences && !this.referenceIndex) {
      this.referenceIndex = groupOccurrencesByResolvedTarget(this.occurrences, target => resolveLink(this.host.app, target, this.path));
      this.stableLayout.retain(this.referenceIndex.groups);
      if (this.diagnostics) this.diagnostics.groupRecomputes = (this.diagnostics.groupRecomputes ?? 0) + 1;
    }
    const visible = new Map<string, Anchor[]>();
    const anchorMap = this.referenceIndex ? referenceCardAnchors(this.anchors, this.referenceIndex.byOccurrence)
      : new Map(this.anchors.map(anchor => [anchor.key, anchor]));
    if (this.referenceIndex) {
      for (const anchor of this.anchors) {
        if (!anchor.fragments.some(f => f.bottom - hostRect.top + scrollTop > this.measuredTop && f.top - hostRect.top + scrollTop < this.measuredBottom)) continue;
        const group = this.referenceIndex.byOccurrence.get(anchor.key);
        if (!group) continue;
        const members = visible.get(group.key) ?? [];
        members.push(anchor); visible.set(group.key, members);
      }
    }
    // Keep the last-line/bottom+2 reference independently of visible fragments.
    this.layoutInput = { ...layoutInput,
      anchors: [...anchorMap].map(([key, a]) => ({ key, x: (a.rect.left + a.rect.right) / 2 - hostRect.left, y: a.rect.bottom + 2 - hostRect.top,
        preferred: bridge?.preferred(a.occurrence.start, a.occurrence.target), manual: prefs.mergeReferences ? undefined : this.host.layouts.get(this.path, a.layoutKey, this.legacyLayoutKeys.get(a.layoutKey ?? '')) }))
    };
    if (prefs.groupMode !== 'none') {
      const saved = !this.groups ? returning?.visit.groups : undefined;
      this.groups ??= new GroupControls(this.view, () => {
        this.cancelInteractions();
        if (this.highlighted && !this.groups?.visible(this.highlighted)) this.clearFocus();
        this.schedule();
      });
      this.groups.update(prefs.groupMode, this.occurrences, this.path, saved?.mode === prefs.groupMode ? saved.folded : undefined);
    } else if (this.groups) {
      this.groups.destroy(); this.groups = undefined;
    }
    const placements = this.stableLayout.update(this.layoutInput, scrollTop, geometryKey, scrolling)
      .filter(p => p.x + p.width > viewport.left && p.x < viewport.right && (!this.groups || this.groups.visible(anchorMap.get(p.key)!.key)));
    this.routePlacements = placements.map(p => this.cardDrag.placement(p.key) ?? p);
    const keep = new Set(placements.map(p => p.key));
    const collapseTogether = !hasCardLanes && this.resizing && !sourceChanged && this.cards.size > 0 &&
      this.cards.size + this.collapsedCards.size <= MAX_COLLAPSED_CARDS;
    // Both lanes crossed the same threshold. Disconnect the card subtree in
    // one change; prepare retained cards off-DOM before restoring it.
    if (collapseTogether) this.cardLayer.remove();
    for (const [key, card] of this.cards) if (!keep.has(key)) {
      const laneFits = card.placement.side === 'left' ? leftFits : rightFits;
      this.removeCard(key, card, this.resizing && !sourceChanged && !laneFits, collapseTogether);
    }
    const activeRelations = new Set<string>();
    for (const p of placements) {
      const anchor = anchorMap.get(p.key)!;
      let card = this.cards.get(p.key);
      const fileGroup = this.referenceIndex?.groups.get(p.key);
      const resolved = fileGroup?.members[0].resolved ?? resolveLink(this.host.app, anchor.occurrence.target, this.path);
      const group = this.groups?.label(anchor.key);
      const signature = JSON.stringify([fileGroup?.key ?? anchor.occurrence.raw, fileGroup?.members.length, resolved.file?.path, group]);
      if (!card) {
        card = this.collapsedCards.get(p.key);
        if (card) {
          this.collapsedCards.delete(p.key);
          if (card.shell.parentElement !== this.cardLayer) this.cardLayer.appendChild(card.shell);
          this.geometryRevision++;
        } else {
          const shell = this.cardLayer.createDiv({ cls: 'margin-link-card-shell' });
          const button = shell.createEl('button');
          const path = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.classList.add('margin-link-connector'); path.dataset.members = JSON.stringify([p.key]); path.dataset.logical = 'true'; path.style.display = 'none';
          shell.dataset.relation = p.key;
          card = { shell, button, path, signature: '', anchor, placement: p, generation: 0 };
          this.bindCard(p.key, card);
        }
        if (!fileGroup) this.svg.appendChild(card.path);
        this.cards.set(p.key, card);
      }
      card.anchor = anchor; card.placement = p; card.group = fileGroup;
      if (card.signature !== signature) {
        this.preview?.closeOwner(card.button); card.button.replaceChildren(); renderCard(card.button, fileGroup && resolved.file ? { ...anchor.occurrence, label: resolved.file.name } : anchor.occurrence, resolved);
        card.badge?.remove();
        if (fileGroup && fileGroup.members.length > 1) {
          const badge = card.badge = card.shell.createEl('button', { cls: 'margin-link-reference-count', text: String(fileGroup.members.length) });
          badge.type = 'button'; badge.setAttribute('aria-label', fileGroup.members.length + ' 处引用');
          badge.setAttribute('aria-expanded', 'false');
          badge.addEventListener('mousedown', event => event.preventDefault());
          badge.addEventListener('click', () => this.showReferences(card!));
        }
        if (group) {
          card.shell.dataset.group = group;
          card.button.querySelector('.margin-link-card-text')?.createSpan({ cls: 'margin-link-group-label', text: group });
        } else delete card.shell.dataset.group;
        card.signature = signature;
      }
      const movable = !fileGroup && prefs.placementMode !== 'auto';
      card.button.classList.toggle('margin-link-card-movable', movable);
      const description = (group ? '分组 ' + group + '。' : '') + 'Enter 打开，V 预览，P 固定或取消高亮，Escape 关闭预览和固定。' +
        (movable ? '方向键移动，Shift+左右键跨侧，Delete 重置位置。' : '');
      if (card.button.getAttribute('aria-description') !== description) card.button.setAttribute('aria-description', description);
      this.place(card, this.cardDrag.placement(p.key) ?? p);
      if (fileGroup && this.visibleRelations) {
        for (const member of visible.get(p.key) ?? []) {
          activeRelations.add(member.key);
          let relation = this.visibleRelations.get(member.key);
          if (!relation) {
            const path = card.path.cloneNode(false) as SVGPathElement;
            path.dataset.members = JSON.stringify([member.key]); this.svg.appendChild(path);
            relation = { shell: card.shell, button: card.button, anchor: member, placement: p, path, routeData: path.dataset }; this.visibleRelations.set(member.key, relation);
            this.geometryRevision++;
          }
          const index = this.referenceIndex!.ordinal.get(member.key)!;
          const fraction = (1 + index) / (1 + fileGroup.members.length);
          if (relation.shell !== card.shell || relation.targetFraction !== fraction) this.geometryRevision++;
          relation.shell = card.shell; relation.button = card.button; relation.placement = p; relation.anchor = member;
          relation.targetFraction = fraction;
        }
      }
    }
    for (const [key, relation] of this.visibleRelations ?? []) if (!activeRelations.has(key)) {
      if (key === this.highlighted) {
        relation.button.classList.remove('margin-link-active');
        relation.shell.classList.remove('margin-link-focused', 'margin-link-pinned');
      }
      relation.path.remove(); relation.continuation?.forEach(el => el.remove()); this.visibleRelations!.delete(key); this.geometryRevision++;
    }
    if (this.cards.size && this.cardLayer.parentElement !== this.decorations.canvas) {
      for (const card of this.collapsedCards.values()) card.shell.remove();
      this.decorations.canvas.appendChild(this.cardLayer);
    }
    if (this.referenceList?.owner && !this.referenceList?.owner.isConnected) this.referenceList?.close();
    this.referenceList?.position(this.hostRect, viewport);
    const focus = this.focusKey(), scope = this.hoverRouteScope(focus);
    this.paintConnectors(scope);
    this.updateContinuations(scope);
    this.highlight(focus, true);
    this.drag.update(this.cardDrag.dragging ? undefined : bridge, hostRect, viewport, body);
    if (returning) returning.rendered = true;
    // First stable display is the initial UI placement, not an invitation to
    // rebalance on the next visit. A gesture only writes on its final commit.
    if (prefs.placementMode !== 'auto' && !this.resizing) this.freezeLayout(false);
  }
  private clearLocated(): void {
    if (this.locateTimer !== undefined) this.win.clearTimeout(this.locateTimer);
    this.locateTimer = undefined; this.located = undefined; this.pendingReadingLocate = undefined;
  }
  private showReferences(card: Card): void {
    const owner = card.badge, group = card.group, previous = this.referenceList?.owner;
    this.referenceList?.close(); this.preview?.close();
    if (!owner || !group || previous === owner) return;
    const source = this.layoutSource, path = this.path, mode = this.mode, bridge = this.bridge(), revision = bridge?.revision;
    const valid = () => this.referenceList?.owner === owner && this.view.file?.path === path && this.view.getMode() === mode &&
      this.referenceIndex?.groups.get(group.key) === group && bridge?.revision === revision &&
      source === (mode === 'source' ? this.bridge()?.text : this.view.data);
    const headings = this.view.file ? this.host.app.metadataCache.getFileCache(this.view.file)?.headings : undefined;
    this.referenceList ??= new ReferenceList(this.root);
    this.referenceList.open(owner, group, source, headings, valid, (occurrence, line) => {
      this.clearLocated(); this.located = String(occurrence.start);
      if (mode === 'source' && bridge) bridge.cm.dispatch({ effects: EditorView.scrollIntoView(occurrence.start, { y: 'center' }) });
      else {
        const element = this.host.reading.elementFor(this.view, occurrence);
        if (element?.isConnected) element.scrollIntoView({ block: 'center' });
        else {
          this.pendingReadingLocate = occurrence;
          this.view.setEphemeralState({ scroll: line - 1 });
        }
      }
      this.measurementsDirty = true; this.schedule();
      this.locateTimer = this.win.setTimeout(() => { this.clearLocated(); this.refreshFocus(true); }, 1500);
    }, occurrence => this.host.selection.relink(this.view, occurrence, bridge, source),
    occurrence => void this.host.selection.unlink(this.view, occurrence, bridge, source),
    occurrence => void this.copyOriginal(occurrence));
    this.referenceList.position(this.hostRect, this.layoutInput?.viewport);
  }
  private async copyOriginal(occurrence: WikilinkOccurrence): Promise<void> {
    try {
      await this.win.navigator.clipboard.writeText(originalLinkText(occurrence));
      new Notice('已复制原文');
    } catch {
      new Notice('无法写入剪贴板，请重试。');
    }
  }
  private clearCollapsedCards(): void {
    for (const card of this.collapsedCards.values()) card.shell.remove();
    this.collapsedCards.clear();
  }
  private removeCard(key: string, card: Card, duringResize: boolean, inDetachedLayer: boolean): void {
    this.preview?.closeOwner(card.button);
    if (this.hovered === key) this.hovered = undefined;
    if (this.focused === key) this.focused = undefined;
    this.cards.delete(key);
    if (!inDetachedLayer) card.shell.remove();
    card.path.remove(); card.continuation?.forEach(button => button.remove());
    if (!duringResize || this.collapsedCards.size >= MAX_COLLAPSED_CARDS) return;
    // Keep only the detached presentation that can be restored by this resize.
    // A menu opened against the old binding cannot act on its next lifetime.
    card.generation++;
    card.button.classList.remove('margin-link-active');
    card.shell.classList.remove('margin-link-focused', 'margin-link-pinned');
    card.path.classList.remove('margin-link-active');
    card.continuation = undefined;
    card.routeBounds = undefined;
    card.ports = undefined;
    this.collapsedCards.set(key, card);
  }
  private bindCard(key: string, card: Card): void {
    const { shell, button } = card;
    button.setAttribute('aria-keyshortcuts', 'P V Escape');
    shell.addEventListener('pointerenter', event => {
      this.hover(key);
      if (!card.group && !event.buttons && !this.cardDrag.dragging) this.showPreview(key);
    });
    button.addEventListener('pointerenter', event => {
      if (card.group && !event.buttons && !this.referenceList?.owner) this.showPreview(key);
    });
    shell.addEventListener('pointerleave', () => { this.hover(undefined); this.preview?.leave(button); });
    shell.addEventListener('focusin', () => { this.focused = key; this.hover(undefined); });
    shell.addEventListener('focusout', event => {
      this.focused = undefined;
      this.refreshFocus();
      this.preview?.blurOwner(button, event.relatedTarget);
    });
    button.addEventListener('click', event => { if (!this.cardDrag.consumeClick(event, key)) void this.open(key, event); });
    button.addEventListener('pointerdown', event => {
      this.preview?.close(); this.drag.cancel(); this.cardDrag.start(event, key, button);
      if (event.button === 0 && !event.defaultPrevented) {
        event.preventDefault(); button.focus({ preventScroll: true });
      }
    });
    button.addEventListener('keydown', event => this.onCardKey(event, key));
    shell.addEventListener('contextmenu', event => {
      event.preventDefault(); this.preview?.close();
      if (card.group && card.group.members.length > 1) { this.showReferences(card); return; }
      const menu = new Menu();
      this.menus.add(menu); menu.onHide(() => this.menus.delete(menu));
      const occurrence = card.anchor.occurrence, source = this.layoutSource, generation = card.generation;
      const valid = () => this.cards.get(key) === card && card.generation === generation && card.anchor.occurrence.raw === occurrence.raw &&
        this.path === this.view.file?.path && this.layoutSource === source;
      const validSource = () => valid() && source === (this.view.getMode() === 'source' ? this.bridge()?.text : this.view.data);
      menu.addItem(item => item.setTitle(this.pinned === key ? '取消固定高亮' : '固定此处关联高亮').setIcon('pin').onClick(() => {
        if (valid()) this.togglePin(key);
      }));
      menu.addItem(item => item.setTitle('重新链接文件…').setIcon('link-2').onClick(() => {
        if (valid()) this.host.selection.relink(this.view, card.anchor.occurrence, this.bridge());
      }));
      menu.addItem(item => item.setTitle('复制原文').setIcon('copy').onClick(() => {
        if (validSource()) void this.copyOriginal(occurrence);
        else new Notice('引用已改变，请重新右键选择卡片。');
      }));
      menu.addItem(item => item.setTitle('取消链接文件').setIcon('unlink').onClick(() => {
        if (validSource()) void this.host.selection.unlink(this.view, card.anchor.occurrence, this.bridge());
      }));
      if (!card.group) menu.addItem(item => item.setTitle(this.host.preferences.placementMode === 'manual' ? '重置此卡片初始位置' : '恢复此卡片初始位置').setIcon('rotate-ccw').onClick(() => {
        const layoutKey = card.anchor.layoutKey;
        if (valid() && layoutKey) this.host.layouts.clear(this.path, layoutKey, this.legacyLayoutKeys.get(layoutKey));
      }));
      menu.showAtMouseEvent(event);
    });
  }
  private sourceReady(bridge?: EditorBridge): boolean {
    if (this.confirmedSource === this.path) {
      if (this.legacyLayoutStore !== this.host.layouts) this.migrateLegacyLayouts(this.confirmedText, bridge);
      return true;
    }
    const file = this.view.file;
    if (!file || this.checkingSource) return false;
    const source = this.path, generation = this.sourceGeneration;
    this.checkingSource = true;
    void this.host.app.vault.cachedRead(file).then(text => {
      if (this.stopped || generation !== this.sourceGeneration) return;
      this.checkingSource = false;
      const editor = this.view.getMode() === 'source' ? this.bridge() : undefined;
      const currentText = this.view.getMode() === 'source' ? editor?.text : this.view.data;
      // CodeMirror normalizes line endings even when the Vault file uses CRLF.
      const normalize = (value: string) => value.replace(/\r\n?/g, '\n');
      if (this.view.file?.path === source && currentText !== undefined && normalize(currentText) === normalize(text)) {
        this.win.clearTimeout(this.sourceRetryTimer); this.sourceRetryTimer = undefined;
        this.migrateLegacyLayouts(text, editor);
        this.confirmedText = text; this.confirmedSource = source; this.schedule();
      } else if (this.sourceRetries < 6 && this.sourceRetryTimer === undefined) {
        // The last editor update can occur while this read is pending. Retry
        // a few times without turning loading/unsaved text into an rAF read loop.
        this.sourceRetryTimer = this.win.setTimeout(() => {
          this.sourceRetryTimer = undefined; this.schedule();
        }, Math.min(50 * 2 ** this.sourceRetries++, 800));
      }
    }).catch(() => { if (generation === this.sourceGeneration) this.checkingSource = false; });
    return false;
  }
  private waitForLivePreview(returning: ReturningVisit, bridge: EditorBridge, livePreview: boolean): boolean {
    // Early Live Preview can expose raw link tokens and wrap the same
    // paragraph differently. Don't restore coordinates from that layout.
    const early = !livePreview || returning.visit.formattedLinks?.some(link => bridge.linkSyntaxVisible(link));
    if (early && this.waitForReturnLayout(returning.firstLayoutDeadline)) {
      returning.waitedForPreview = true;
      return true;
    }
    this.clearPreviewReturnTimer();
    return false;
  }
  private waitForReturnLayout(deadline: number): boolean {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    this.previewReturnTimer ??= this.win.setTimeout(() => { this.previewReturnTimer = undefined; this.schedule(); }, remaining);
    return true;
  }
  private clearPreviewReturnTimer(): void {
    if (this.previewReturnTimer !== undefined) this.win.clearTimeout(this.previewReturnTimer);
    this.previewReturnTimer = undefined;
  }
  private migrateLegacyLayouts(text: string, bridge?: EditorBridge): void {
    const store = this.host.layouts;
    this.legacyLayoutKeys = store.migrateLegacyLayouts(this.path, text, bridge);
    this.legacyLayoutStore = store;
  }
  private place(card: Card, p: Placement): void {
    const rect = this.hostRect;
    if (!rect) return;
    card.placement = p;
    const shape = p.shape ?? 'horizontal', manual = String(!!p.manual);
    if (card.shell.dataset.shape !== shape) card.shell.dataset.shape = shape;
    if (card.shell.dataset.manual !== manual) card.shell.dataset.manual = manual;
    card.button.classList.toggle('margin-link-compact', p.compact);
    const transform = `translate(${p.x}px, ${Math.round((p.y + this.scrollTop) * 10000) / 10000}px)`;
    const signature = `${transform}:${p.width}:${p.height}`;
    if (card.placementStyle !== signature) {
      Object.assign(card.shell.style, { width: `${p.width}px`, height: `${p.height}px`, transform });
      card.placementStyle = signature;
      this.geometryRevision++;
    }
  }
  private hoverRouteScope(focus?: string): ReadonlySet<string> | undefined {
    if (!this.demandHoverRoutes || this.host.preferences.lines !== 'hover') return undefined;
    if (focus === undefined) return new Set();
    if (!this.visibleRelations || !this.cards.has(focus)) return new Set([focus]);
    return new Set([...this.visibleRelations].filter(([, relation]) => relation.placement.key === focus).map(([key]) => key));
  }
  private measureTextObstacles(rect: DOMRect, viewport: Box): void {
    if (this.observedBody && !this.textObstacles.covers(viewport, this.scrollTop)) {
      this.obstacles = this.textObstacles.read(this.observedBody, rect, viewport, this.scrollTop);
      this.geometryRevision++;
    }
  }
  private paintConnectors(scope?: ReadonlySet<string>): void {
    const rect = this.hostRect, input = this.layoutInput;
    if (!rect || !input) return;
    const prefs = this.host.preferences, view = input.viewport;
    if (prefs.lines === 'numbers' || prefs.lines === 'none') {
      this.svg.style.display = 'none';
      for (const card of (this.visibleRelations ?? this.cards).values()) (card.routeData ?? card.shell.dataset).routeState = prefs.lines === 'numbers' ? 'numbered' : 'hidden';
      return;
    }
    if (scope?.size === 0) { this.svg.style.display = 'none'; return; }
    const all = this.visibleRelations ?? this.cards;
    // Hover, keyboard focus and card dragging can enter here between renders.
    if (all.size) this.measureTextObstacles(rect, view);
    this.svg.style.display = '';
    // Native scrolling already carries the ink with the note. Validate changed
    // geometry immediately, but explore optional shared corridors only once the
    // scroll becomes quiet. Existing coincident strokes remain shared throughout.
    const optimizeShared = scope === undefined && !this.cardDrag.dragging && !this.scrolling && !this.resizing;
    const signature = [this.geometryRevision, all.size, prefs.lineStyle, prefs.lineWidth, this.textObstacles.revision, optimizeShared, scope && [...scope]].join(':');
    if (signature === this.batchSignature) return;
    const coverage = this.textObstacles.bounds;
    const bounds = { ...view, top: coverage?.top ?? view.top + this.scrollTop, bottom: coverage?.bottom ?? view.bottom + this.scrollTop };
    const visible = new Map<string, boolean>();
    const included = scope ? [...scope].flatMap(key => {
      const relation = all.get(key);
      return relation ? [[key, relation] as const] : [];
    }) : [...all];
    const relations: BatchRelationInput[] = included.map(([key, card]) => {
      const p = card.placement;
      const fragments = card.anchor.fragments.map(f => ({ left: f.left - rect.left, right: f.right - rect.left,
        top: f.top - rect.top + this.scrollTop, bottom: f.bottom - rect.top + this.scrollTop }));
      const box = { left: p.x, right: p.x + p.width, top: p.y + this.scrollTop, bottom: p.y + p.height + this.scrollTop };
      const both = fragments.some(f => containsBox(bounds, f)) && containsBox(bounds, box); visible.set(key, both);
      return { key, cardKey: p.key, targetFraction: card.targetFraction, fragments, card: { ...p, y: p.y + this.scrollTop }, previous: card.ports, bounds };
    });
    // Retain every layout slot, but do not search a route whose endpoints are
    // wholly outside the measured neighbourhood. Its card still protects other
    // routes, including cards whose own source has scrolled out of coverage.
    const intersects = (box: Box) => box.left <= bounds.right && box.right >= bounds.left && box.top <= bounds.bottom && box.bottom >= bounds.top;
    const portClearance = prefs.lineWidth + 1;
    const occupiedPorts = new Map<string, number>();
    if (this.visibleRelations) relations.sort((a, b) => Number(a.key) - Number(b.key));
    const active = relations.filter(relation => {
      if (relation.targetFraction === undefined) return true;
      const span = Math.min(relation.card.width, relation.card.height);
      const offset = span * relation.targetFraction;
      const last = occupiedPorts.get(relation.cardKey!);
      if (last !== undefined && offset - last < portClearance) return false;
      occupiedPorts.set(relation.cardKey!, offset);
      return true;
    }).filter(relation => relation.fragments.some(intersects) && intersects({
      left: relation.card.x, right: relation.card.x + relation.card.width, top: relation.card.y, bottom: relation.card.y + relation.card.height
    }));
    const activeCards = new Set(active.map(relation => relation.cardKey));
    const inactiveCards = [...this.cards.values()].map(c => c.placement).filter(card => !activeCards.has(card.key)).map(card => ({
      left: card.x, right: card.x + card.width, top: card.y + this.scrollTop, bottom: card.y + this.scrollTop + card.height
    }));
    // Reserve the widest highlighted stroke as well as at least .5px of real
    // whitespace. Dense rows may use the compact budget; their full DOM text
    // rectangles remain protected throughout routing and batch validation.
    const diagnostics = this.diagnostics;
    this.batch = connectorBatch(active, prefs.lineStyle,
      { obstacles: this.obstacles, cardObstacles: inactiveCards, onRouteSearch: diagnostics ? () => { diagnostics.routeSearches = (diagnostics.routeSearches ?? 0) + 1; } : undefined, body: input.body, lineWidth: prefs.lineWidth + 0.5, minimumClearance: 0.5, optimizeShared }, this.batch, this.routeCache);
    this.routeCache?.remember(this.batch);
    this.batchSignature = signature;
    if (this.diagnostics) this.diagnostics.routes++;
    const keep = new Set(this.batch!.segments.map(s => s.id));
    for (const [id, path] of this.sharedPaths) if (!keep.has(id)) { path.remove(); this.sharedPaths.delete(id); }
    for (const stroke of this.batch!.segments) {
      let path = this.sharedPaths.get(stroke.id);
      if (!path) {
        path = this.svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('margin-link-connector'); path.dataset.segment = stroke.id;
        this.svg.appendChild(path); this.sharedPaths.set(stroke.id, path);
      }
      const members = JSON.stringify(stroke.members);
      if (path.dataset.members !== members) path.dataset.members = members;
      if (path.dataset.shared !== String(stroke.shared)) path.dataset.shared = String(stroke.shared);
      this.writePath(path, stroke.path);
      path.classList.toggle('margin-link-active', stroke.members.includes(this.highlighted ?? ''));
    }
    for (const [key, card] of included) {
      const relation = this.batch!.relations.get(key);
      card.ports = relation?.choice; this.writePath(card.path, relation?.path ?? '');
      (card.routeData ?? card.shell.dataset).routeSegments = JSON.stringify(relation?.segments ?? []);
      (card.routeData ?? card.shell.dataset).routeState = !card.anchor.fragments.length ? 'pending' : !visible.get(key) ? 'offscreen' : relation ? 'complete' : 'blocked';
      const points = relation?.connector.segments.flatMap(s => [s.from, s.to, ...(s.control ? [s.control] : []), ...(s.control2 ? [s.control2] : [])]);
      card.routeBounds = points?.length ? { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) } : undefined;
    }
  }
  private writePath(path: SVGPathElement, value: string): void {
    if (path.getAttribute('d') === value) return;
    path.setAttribute('d', value); if (this.diagnostics) this.diagnostics.svgWrites++;
  }
  private updateContinuations(scope?: ReadonlySet<string>): void {
    const input = this.layoutInput, rect = this.hostRect;
    if (!input || !rect || scope?.size === 0) return;
    const mode = this.host.preferences.lines;
    const signature = [this.geometryRevision, (this.visibleRelations ?? this.cards).size, mode === 'none' ? 'none' : 'markers', scope && [...scope]].join(':');
    const layout = this.markerSignature !== signature;
    this.markerSignature = signature;
    const used: Box[] = [];
    const obstacles = layout ? [...this.obstacles, ...this.routePlacements.map(p => ({ left: p.x, right: p.x + p.width,
      top: p.y + this.scrollTop, bottom: p.y + p.height + this.scrollTop }))] : [];
    const region = { ...input.viewport,
      top: Number.isFinite(this.measuredTop) ? this.measuredTop : input.viewport.top + this.scrollTop,
      bottom: Number.isFinite(this.measuredBottom) ? this.measuredBottom : input.viewport.bottom + this.scrollTop };
    const viewport = { ...input.viewport, top: input.viewport.top + this.scrollTop, bottom: input.viewport.bottom + this.scrollTop };
    const ordered = [...(this.visibleRelations ?? this.cards)].filter(([key]) => !scope || scope.has(key))
      .sort(([a], [b]) => (this.continuationNumbers.get(a) ?? 0) - (this.continuationNumbers.get(b) ?? 0));
    for (const [key, card] of ordered) {
      const source = card.anchor.fragments.map(b => ({ left: b.left - rect.left, right: b.right - rect.left,
        top: b.top - rect.top + this.scrollTop, bottom: b.bottom - rect.top + this.scrollTop })).at(-1);
      const p = card.placement, target = { left: p.x, right: p.x + p.width, top: p.y + this.scrollTop, bottom: p.y + p.height + this.scrollTop };
      const blocked = this.batch ? !this.batch.relations.has(key) : ['blocked', 'continuation'].includes((card.routeData ?? card.shell.dataset).routeState ?? '');
      const clippedRoute = !!source && !!card.routeBounds && containsBox(viewport, source) && containsBox(viewport, target) && !containsBox(viewport, card.routeBounds);
      const show = mode !== 'none' && !!source && (mode === 'numbers' || blocked || clippedRoute);
      if (layout && mode !== 'none' && source) {
        if (!this.continuationNumbers.has(key)) this.continuationNumbers.set(key, this.continuationNumbers.size + 1);
        const number = this.continuationNumbers.get(key)!;
        const pair = relationNumberPair(source, target, region, input.body, obstacles, used, Math.max(16, String(number).length * 7 + 4), !!this.visibleRelations);
        used.push(...pair);
        (card.routeData ?? card.shell.dataset).number = String(number);
        if (!card.continuation) card.continuation = ['source', 'target'].map(end => {
          const button = (this.decorations?.canvas ?? this.root).createEl('button', { cls: 'margin-link-continuation' });
          button.type = 'button'; button.dataset.relation = key; button.dataset.end = end;
          button.addEventListener('pointerenter', () => this.hover(key)); button.addEventListener('pointerleave', () => this.hover(undefined));
          button.addEventListener('focusin', () => { this.focused = key; this.hover(undefined); });
          button.addEventListener('focusout', () => { this.focused = undefined; this.refreshFocus(); });
          button.addEventListener('click', () => this.togglePin(key));
          return button;
        }) as [HTMLButtonElement, HTMLButtonElement];
        card.continuation.forEach((button, i) => {
          button.textContent = String(number); button.dataset.number = String(number);
          button.setAttribute('aria-label', '关联 ' + number + '：' + card.anchor.occurrence.label + (i ? '，卡片端' : '，文字端'));
          Object.assign(button.style, { left: pair[i].left + 'px', top: pair[i].top + 'px', width: pair[i].right - pair[i].left + 'px', height: '16px' });
          if (this.diagnostics) this.diagnostics.markerWrites++;
        });
      }
      card.continuation?.forEach(button => {
        if (button.hidden === show) button.hidden = !show;
        const tabIndex = show && (mode === 'always' || mode === 'numbers') ? 0 : -1;
        if (button.tabIndex !== tabIndex) button.tabIndex = tabIndex;
      });
      if (mode === 'none') (card.routeData ?? card.shell.dataset).routeState = 'hidden';
      else if (mode === 'numbers') (card.routeData ?? card.shell.dataset).routeState = 'numbered';
      else if (show) {
        (card.routeData ?? card.shell.dataset).routeState = 'continuation';
        (card.routeData ?? card.shell.dataset).routeReason = clippedRoute ? 'route-clipped-by-viewport' : 'search-exhausted';
      } else if (this.batch?.relations.has(key)) (card.routeData ?? card.shell.dataset).routeState = 'complete';
      if ((card.routeData ?? card.shell.dataset).routeState !== 'continuation' && (card.routeData ?? card.shell.dataset).routeReason) delete (card.routeData ?? card.shell.dataset).routeReason;
    }
  }
  private dragContext(key: string): CardDragContext | undefined {
    if (this.host.preferences.mergeReferences) return;
    const card = this.cards.get(key), input = this.layoutInput;
    if (!card || !input || this.host.preferences.placementMode === 'auto' || this.confirmedSource !== this.path || this.view.file?.path !== this.path || this.view.getMode() !== this.mode) return;
    const source = this.path, mode = this.mode, bridge = this.bridge(), revision = bridge?.revision;
    const layoutKey = card.anchor.layoutKey;
    return { input, anchor: input.anchors.find(a => a.key === key)!, occupied: [...this.cards].filter(([id]) => id !== key).map(([, c]) => c.placement),
      valid: () => !this.stopped && this.view.file?.path === source && this.view.getMode() === mode && (!bridge || bridge.revision === revision) && this.cards.get(key)?.anchor.layoutKey === layoutKey };
  }
  private savePosition(key: string, relative: RelativePosition): void {
    if (this.confirmedSource !== this.path || this.view.file?.path !== this.path || this.view.getMode() !== this.mode) { this.schedule(); return; }
    const card = this.cards.get(key);
    if (!card?.anchor.layoutKey) { new Notice('重复链接的上下文无法唯一辨别，未保存位置。请为它们提供不同的周围文字后重试。'); this.schedule(); return; }
    this.host.layouts.set(this.path, card.anchor.layoutKey, relative, this.legacyLayoutKeys.get(card.anchor.layoutKey)); this.schedule();
  }
  private onCardKey(event: KeyboardEvent, key: string): void {
    if (this.cardDrag.dragging && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); return;
    }
    const singleKey = !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing;
    if (singleKey && event.key.toLowerCase() === 'v') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !this.cardDrag.dragging) this.showPreview(key, true);
      return;
    }
    if (singleKey && event.key.toLowerCase() === 'p') {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !this.cardDrag.dragging) this.togglePin(key);
      return;
    }
    const card = this.cards.get(key), context = this.dragContext(key);
    if (!card || !context) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (card.anchor.layoutKey) this.host.layouts.clear(this.path, card.anchor.layoutKey, this.legacyLayoutKeys.get(card.anchor.layoutKey)); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    let x = card.placement.x + card.placement.width / 2, y = card.placement.y + card.placement.height / 2;
    if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) x = event.key === 'ArrowLeft' ? (context.input.viewport.left + context.input.body.left) / 2 : (context.input.body.right + context.input.viewport.right) / 2;
    else { x += event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0; y += event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0; }
    const result = positionFromDrop(context.input, context.anchor, x, y, context.occupied);
    if (result) this.savePosition(key, result.relative);
  }
  private showPreview(key: string, keyboard = false): void {
    const card = this.cards.get(key);
    if (!card) return;
    this.preview ??= new TargetPreview(this.root, this.host.app.vault);
    this.preview.request(card.button, (): PreviewTarget | undefined => {
      const input = this.layoutInput, path = this.path, signature = card.signature, mode = this.mode;
      const bridge = mode === 'source' ? this.bridge() : undefined, revision = bridge?.revision;
      const valid = () => !this.stopped && this.view.file?.path === path && this.view.getMode() === mode &&
        this.cards.get(key) === card && card.signature === signature && bridge?.revision === revision;
      if (!input || !valid()) return;
      const resolved = resolveLink(this.host.app, card.anchor.occurrence.target, path);
      const box = (p: Placement): Box => ({ left: p.x, right: p.x + p.width, top: p.y, bottom: p.y + p.height });
      const occupied = this.routePlacements.map(box);
      const hostRect = this.hostRect!;
      const reserve = (element?: HTMLElement | null) => {
        if (!element || element.hidden) return;
        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height) occupied.push({ left: rect.left - hostRect.left, right: rect.right - hostRect.left,
          top: rect.top - hostRect.top, bottom: rect.bottom - hostRect.top });
      };
      reserve(this.root.querySelector<HTMLElement>('.margin-link-handle'));
      for (const other of (this.visibleRelations ?? this.cards).values()) other.continuation?.forEach(reserve);
      const space = previewSpace(lane(input, card.placement.side), box(card.placement), occupied);
      return { file: resolved.file, label: card.button.dataset.tooltip!, space, valid, open: event => { void this.open(key, event); } };
    }, keyboard);
  }
  private async open(key: string, event: MouseEvent): Promise<void> {
    const anchor = this.cards.get(key)?.anchor;
    if (!anchor || !this.view.file || this.view.file.path !== this.path || this.confirmedSource !== this.path) return;
    const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.view.file.path);
    const group = this.cards.get(key)?.group;
    if (group && this.referenceIndex?.groups.get(key) !== group) return;
    if (group && (group.members[0].resolved.file !== resolved.file || (resolved.file && key !== 'file:' + resolved.file.path))) {
      this.invalidateGroups(); this.schedule(); return;
    }
    if (!resolved.file) { new Notice('未找到该文件。请核对链接路径，以及设置中的“Obsidian 能识别的文件类型”。'); return; }
    if (!this.host.fileRecognition.canOpen(resolved.file.extension) && !canOpenInObsidian(this.host.app, resolved.file.extension)) { new Notice('文件已被 Vault 识别，但无法通过公开 API 确认此类型的打开能力。请先用相应文件类型插件打开一个该类型文件并保留其标签，再点击卡片；也可使用正文原生双链。'); return; }
    try {
      const newTab = event.ctrlKey || event.metaKey, scroller = this.scroller;
      const leaf = newTab ? this.host.app.workspace.getLeaf('tab') : this.view.leaf;
      const file = resolved.file;
      const navigate = () => leaf.openFile(file, { eState: !group && resolved.subpath ? { subpath: resolved.subpath } : undefined });
      if (newTab || file === this.view.file || !scroller) await navigate();
      else {
        const viewportTop = scroller.getBoundingClientRect().top + scroller.clientTop;
        const top = scroller.scrollTop, pendingScroll = top - this.scrollTop;
        const reference = this.anchors.find(a => a.rect.top - pendingScroll >= viewportTop &&
          a.rect.bottom - pendingScroll <= viewportTop + scroller.clientHeight);
        const bridge = this.mode === 'source' ? this.bridge() : undefined;
        const sourceMode = !!this.view.getState().source;
        const formattedLinks = bridge && !sourceMode ? (reference && reference.key !== anchor.key ? [reference, anchor] : [anchor])
          .map(item => item.occurrence).filter(link => !bridge.linkSyntaxVisible(link)) : undefined;
        await this.host.cardNavigation.open(this.view, file.path, {
          path: this.path, source: this.layoutSource, mode: this.mode, geometry: this.layoutGeometry, merged: !!this.visibleRelations,
          top, left: scroller.scrollLeft, line: this.view.currentMode.getScroll(), reference: reference?.key,
          referenceOffset: reference && reference.rect.top - pendingScroll - viewportTop,
          formattedLinks, editorScroll: bridge?.cm.scrollSnapshot?.(), sourceMode, layout: this.stableLayout.copy(),
          groups: this.groups && { mode: this.host.preferences.groupMode, folded: this.groups.snapshot() },
          anchors: new Map(Array.from(this.contentAnchors, ([id, a]) => [id, { ...a, element: undefined }]))
        }, navigate);
      }
    } catch { new Notice('Obsidian 无法打开该文件类型，请先安装对应的文件类型处理插件。'); }
  }
  private onAnchorFocus = (event: FocusEvent): void => {
    if (!this.visibleRelations) return;
    const key = this.anchors.find(a => a.element?.contains(event.target as Node))?.key;
    if (key) { this.focused = key; this.refreshFocus(); }
  };
  private onAnchorBlur = (event: FocusEvent): void => {
    if (this.visibleRelations && this.anchors.some(a => a.element?.contains(event.target as Node))) {
      this.focused = undefined; this.refreshFocus();
    }
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (this.resizePointer !== undefined || this.root.contains(event.target as Node) || this.decorations?.contains(event.target as Node) || this.cardDrag.dragging) return;
    const bridge = this.view.getMode() === 'source' ? this.bridge() : undefined;
    const pos = bridge?.cm.posAtCoords({ x: event.clientX, y: event.clientY });
    this.hover(bridge && pos !== null && pos !== undefined ? this.anchors.find(a => pos >= a.occurrence.start && pos < a.occurrence.end)?.key : this.anchors.find(a => a.element?.contains(event.target as Node))?.key);
  };
  private onLeave = (): void => this.hover(undefined);
  private hover(key?: string): void {
    this.hovered = key;
    this.refreshFocus();
  }
  private togglePin(key: string): void {
    if (!this.cards.has(key) && !this.visibleRelations?.has(key)) return;
    this.pinned = this.pinned === key ? undefined : key;
    this.refreshFocus(true);
  }
  private onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.referenceList?.close(true); this.preview?.close(true);
    if (this.pinned) this.clearFocus();
  };
  private clearFocus(): void {
    this.pinned = this.hovered = this.focused = undefined;
    this.highlight(undefined);
  }
  private focusCandidate(): string | undefined {
    const interaction = this.located ?? this.pinned ?? this.hovered ?? this.focused;
    if (interaction !== undefined) return interaction;
    const selected = this.mode === 'source' ? this.bridge()?.cm.state.selection.main : undefined;
    if (selected && (selected.from !== selected.to || this.visibleRelations)) {
      return this.anchors.find(a => selected.from < a.occurrence.end &&
        (selected.to > a.occurrence.start || (selected.empty && selected.to === a.occurrence.start)))?.key;
    }
  }
  private focusKey(): string | undefined {
    const key = this.focusCandidate();
    return key !== undefined && (this.cards.has(key) || this.visibleRelations?.has(key)) ? key : undefined;
  }
  private refreshFocus(redraw = false): void {
    const key = this.focusKey();
    const scope = key === this.highlighted ? undefined : this.hoverRouteScope(key);
    if (scope) {
      if (scope.size && this.measurementsDirty) this.schedule();
      else { this.paintConnectors(scope); this.updateContinuations(scope); }
    }
    this.highlight(key, redraw);
  }
  private highlight(key?: string, redraw = false): void {
    const previous = this.highlighted;
    if (previous === key && (!redraw || key === undefined)) return;
    const feedback = this.host.preferences.hoverFeedback;
    const members = (id: string) => this.visibleRelations && this.cards.has(id)
      ? [id, ...[...this.visibleRelations].filter(([, c]) => c.placement.key === id).map(([k]) => k)] : [id];
    const mark = (id: string, on: boolean) => {
      const card = this.visibleRelations?.get(id) ?? this.cards.get(id);
      if (!card) return;
      card.button.classList.toggle('margin-link-active', on && feedback);
      card.shell.classList.toggle('margin-link-focused', on && feedback);
      card.shell.classList.toggle('margin-link-pinned', on && (id === this.pinned || card.placement.key === this.pinned));
      card.path.classList.toggle('margin-link-active', on);
      card.continuation?.forEach(el => el.classList.toggle('margin-link-active', on));
      for (const ref of this.batch?.relations.get(id)?.segments ?? []) this.sharedPaths.get(ref.id)?.classList.toggle('margin-link-active', on);
    };
    if (previous !== undefined && previous !== key) members(previous).forEach(id => mark(id, false));
    this.highlighted = key;
    this.decorations?.element.classList.toggle('margin-link-has-focus', key !== undefined && feedback);
    this.highlightedElements.forEach(el => el.classList.remove('margin-link-anchor-active'));
    this.highlightedElements = [];
    const fragments: Box[] = [];
    for (const id of key === undefined ? [] : members(key)) {
      mark(id, true);
      const card = this.visibleRelations?.get(id) ?? this.cards.get(id);
      if (this.visibleRelations && this.cards.has(id)) continue;
      const element = card?.anchor.element;
      if ((feedback || this.located) && element && this.view.contentEl.contains(element)) {
        element.classList.add('margin-link-anchor-active'); this.highlightedElements.push(element);
      } else if ((feedback || this.located) && card) fragments.push(...card.anchor.fragments);
    }
    for (const [index, box] of fragments.entries()) {
      const ink = this.anchorInk[index] ??= this.decorations.canvas.createSpan({ cls: 'margin-link-anchor-ink', attr: { 'aria-hidden': 'true' } });
      Object.assign(ink.style, { left: (box.left - this.hostRect!.left) + 'px', top: (box.top - this.hostRect!.top + this.scrollTop) + 'px',
        width: (box.right - box.left) + 'px', height: (box.bottom - box.top) + 'px' });
    }
    this.anchorInk?.splice(fragments.length).forEach(el => el.remove());
  }
  private clearCards(): void {
    this.cancelReturn();
    this.resetResize();
    this.win.clearTimeout(this.scrollIdleTimer); this.scrollIdleTimer = undefined; this.scrolling = false;
    this.referenceList?.close(); this.clearLocated(); this.referenceIndex = undefined;
    for (const relation of this.visibleRelations?.values() ?? []) { relation.path.remove(); relation.continuation?.forEach(el => el.remove()); }
    this.visibleRelations?.clear();
    this.preview?.invalidate(); this.groups?.destroy(); this.groups = undefined; this.occurrences = []; cardTooltip.hideWithin(this.root);
    this.clearFocus(); for (const card of this.cards.values()) { card.shell.remove(); card.path.remove(); card.continuation?.forEach(el => el.remove()); }
    this.sharedPaths?.forEach(path => path.remove()); this.sharedPaths?.clear(); this.batch = undefined; this.batchSignature = '';
    this.routeCache?.clear();
    this.cards.clear(); this.continuationNumbers?.clear(); this.routePlacements = []; this.anchors = []; this.layoutInput = undefined;
    this.measurementsDirty = true; this.measuredTop = Infinity; this.measuredBottom = -Infinity; this.markerSignature = ''; this.geometryRevision++;
    this.stableLayout?.clear(); this.contentAnchors?.clear(); this.layoutGeometry = ''; this.layoutSource = ''; this.textGeometry = '';
    this.bodyTop = undefined; this.bodyHeight = undefined; this.validOccurrences?.clear(); this.textObstacles?.invalidate();
  }
  destroy(): void {
    this.stopped = true; this.win.cancelAnimationFrame(this.frame); this.win.clearTimeout(this.sourceRetryTimer); this.resize.disconnect(); this.mutation.disconnect();
    for (const menu of [...this.menus]) menu.hide(); this.menus.clear();
    const container = this.view.contentEl;
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) container.removeEventListener(event, this.onReturnInput, true);
    container.removeEventListener('focusin', this.onAnchorFocus);
    container.removeEventListener('focusout', this.onAnchorBlur);
    container.removeEventListener('keydown', this.onEscape);
    container.removeEventListener('scroll', this.onScroll, true);
    container.removeEventListener('pointermove', this.onPointerMove); container.removeEventListener('pointerleave', this.onLeave);
    this.win.removeEventListener('resize', this.schedule);
    this.win.removeEventListener('pointerdown', this.onResizePointerDown, true);
    this.win.removeEventListener('pointerup', this.onResizePointerEnd, true);
    this.win.removeEventListener('pointercancel', this.onResizePointerEnd, true);
    this.win.removeEventListener('blur', this.releaseResizePointer);
    container.ownerDocument.fonts?.removeEventListener('loadingdone', this.onFontsLoaded);
    this.cardDrag.destroy(); this.drag.destroy(); this.clearCards(); this.decorations.detach(); this.root.remove(); container.classList.remove('margin-link-host');
  }
}
