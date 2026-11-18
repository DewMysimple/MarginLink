import { MarkdownView, Menu, Notice, type App } from 'obsidian';
import type { Anchor, Preferences, RelativePosition, WikilinkOccurrence } from '../types';
import { GroupControls } from './group-controls';
import type { EditorBridge } from '../editor/editor-extension';
import type { ReadingAnchors } from '../reading/reading-anchors';
import type { SelectionAction } from '../editor/selection-action';
import type { LayoutStore } from '../core/layout-store';
import { DragController } from '../editor/drag-controller';
import { CardDragController, type CardDragContext } from './card-drag-controller';
import { resolveLink } from '../core/link-resolver';
import type { FileRecognition } from '../core/file-recognition';
import { canOpenInObsidian } from '../core/file-capabilities';
import { lane, positionFromDrop, positionRelative, type Box, type LayoutInput, type Placement } from './layout-engine';
import { renderCard } from './card-renderer';
import { cardTooltip } from './card-tooltip';
import { TargetPreview, previewSpace, type PreviewTarget } from './target-preview';
import { type PortChoice } from './connector-renderer';
import { connectorBatch, ConnectorRouteCache, type ConnectorBatch, type BatchRelationInput } from './connector-batch';
import { applyAppearance } from './appearance';
import { legacyLayoutAliases } from '../core/layout-identity';
import { parseWikilinks } from '../core/wikilink-parser';
import { StableLayout } from './stable-layout';
import { TextObstacles } from './text-obstacles';
import { relationNumberPair, containsBox } from './continuation';
import { NativeScrollLayer } from './native-scroll-layer';

interface Card { shell: HTMLDivElement; button: HTMLButtonElement; path: SVGPathElement; signature: string; anchor: Anchor; placement: Placement; placementStyle?: string; ports?: PortChoice; routeBounds?: Box; continuation?: [HTMLButtonElement, HTMLButtonElement] }
export interface OverlayHost {
  fileRecognition: FileRecognition;
  app: App; preferences: Preferences; bridges: Set<EditorBridge>;
  reading: ReadingAnchors; selection: SelectionAction; layouts: LayoutStore;
}
export class MarginOverlay {
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private decorations: NativeScrollLayer;
  private drag: DragController;
  private cardDrag: CardDragController;
  private cards = new Map<string, Card>();
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
  private confirmedSource = '';
  private sourceGeneration = 0;
  private checkingSource = false;
  private sourceRetries = 0;
  private sourceRetryTimer?: number;
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
  private geometrySignature = '';
  private hostRect?: DOMRect;
  private preview?: TargetPreview;
  private groups?: GroupControls;
  private occurrences: readonly WikilinkOccurrence[] = [];
  private highlighted?: string;
  private pinned?: string;
  private hovered?: string;
  private focused?: string;
  private anchorInk: HTMLSpanElement[] = [];
  private highlightedElements: HTMLElement[] = [];
  private observedBody?: Element;
  private measurementsDirty = true;
  private measuredTop = Infinity;
  private measuredBottom = -Infinity;
  private geometryRevision = 0;
  private markerSignature = '';
  /** Enabled only by an explicit development probe; no persistent telemetry. */
  diagnostics?: { renders: number; measurements: number; routes: number; svgWrites: number; markerWrites: number; work: number[] };
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
    this.drag = new DragController(this.root, view, host.selection);
    this.cardDrag = new CardDragController(this.root, key => this.dragContext(key), (key, p) => {
      const card = this.cards.get(key);
      if (card && p) {
        this.routePlacements = this.routePlacements.map(c => c.key === key ? p : c);
        this.place(card, p);
        for (const [id, other] of this.cards) if (id !== key) this.place(other, other.placement);
        this.paintConnectors();
        this.updateContinuations();
      }
      else this.schedule();
    }, (key, relative) => this.savePosition(key, relative));
    this.mutation = new MutationObserver(records => {
      if (records.some(r => {
        // Style records for transient ink or a dismissed panel can be delivered
        // after removal. Detached targets cannot change this pane's geometry.
        if (!container.contains(r.target) || this.root.contains(r.target) || this.decorations.contains(r.target)) return false;
        if (r.type === 'childList' && [...r.removedNodes].includes(this.decorations.element) && !this.decorations.element.isConnected) {
          this.schedule();
          return false;
        }
        if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(node => this.decorations.contains(node))) return false;
        if (r.type === 'attributes' && r.attributeName === 'class') {
          const strip = (v: string) => v.replace(/\bmargin-link-[\w-]+\b/g, '').trim();
          if (strip(r.oldValue ?? '') === strip((r.target as Element).getAttribute('class') ?? '')) return false;
        }
        return true;
      })) { this.measurementsDirty = true; this.textObstacles.invalidate(); this.schedule(); }
    });
    this.mutation.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
    // RO is delivered after layout, before paint. Flush this view's queued frame
    // here so a shrinking lane cannot paint yesterday's larger card for a frame.
    // The overlay is absolute and never changes the observed container/body size.
    this.resize = new ResizeObserver(() => { this.measurementsDirty = true; this.textObstacles.invalidate(); this.flushFrame(); }); this.resize.observe(container);
    container.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    container.addEventListener('pointermove', this.onPointerMove); container.addEventListener('pointerleave', this.onLeave);
    container.addEventListener('keydown', this.onEscape);
    this.win.addEventListener('resize', this.schedule);
    container.ownerDocument.fonts?.addEventListener('loadingdone', this.onFontsLoaded); this.schedule();
  }
  bridge(): EditorBridge | undefined { return [...this.host.bridges].find(b => b.alive && this.view.contentEl.contains(b.cm.dom)); }
  schedule = (): void => {
    if (!this.stopped && !this.frame) this.frame = this.win.requestAnimationFrame(this.flushFrame);
  };
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
  private flushFrame = (): void => {
    if (this.stopped) return;
    this.win.cancelAnimationFrame(this.frame); this.frame = 0;
    const start = this.diagnostics ? performance.now() : 0;
    this.render();
    if (this.diagnostics) { this.diagnostics.renders++; this.diagnostics.work.push(performance.now() - start); }
  };
  invalidatePreview(path: string): void { this.preview?.invalidate(path); }
  invalidateGroups(): void { this.groups?.invalidate(); }
  openGroups(): void { this.groups?.open(); }
  cancelInteractions(): void { this.preview?.close(); cardTooltip.hideWithin(this.root); this.cardDrag.cancel(); this.drag.cancel(); }
  resetLayout(): void {
    this.cancelInteractions(); this.stableLayout.clear(); this.schedule();
  }
  /** Snapshot only this confirmed note's measured coordinates. Relative UI
   * records survive navigation; no unmeasured or ambiguous link is invented. */
  freezeLayout(overwrite = true, claimed?: Set<string>): boolean {
    const input = this.layoutInput;
    if (!input || this.cardDrag.dragging || this.confirmedSource !== this.path || this.view.file?.path !== this.path || this.view.getMode() !== this.mode) return false;
    const source = this.mode === 'source' ? this.bridge()?.text : this.view.data;
    if (source === undefined || source !== this.layoutSource) return false;
    const positions = [...this.cards.values()].flatMap(card => {
      const key = card.anchor.layoutKey, anchor = input.anchors.find(a => a.key === card.placement.key);
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
  private render(): void {
    const container = this.view.contentEl;
    const mode = this.view.getMode();
    if (this.path !== this.view.file?.path || this.mode !== mode) {
      if (this.path !== this.view.file?.path) {
        this.confirmedSource = ''; this.sourceGeneration++; this.checkingSource = false; this.sourceRetries = 0;
        this.legacyLayoutKeys.clear();
        this.win.clearTimeout(this.sourceRetryTimer); this.sourceRetryTimer = undefined;
      }
      this.path = this.view.file?.path ?? ''; this.mode = mode; this.revision = -1;
      this.cancelInteractions(); this.clearCards();
    }
    const prefs = this.host.preferences, hostRect = container.getBoundingClientRect();
    this.hostRect = hostRect;
    this.root.hidden = !prefs.enabled || !this.path || hostRect.width < 1 || hostRect.height < 1;
    this.decorations.element.hidden = this.root.hidden;
    if (this.root.hidden) { this.cancelInteractions(); this.clearCards(); return; }
    const bridge = mode === 'source' ? this.bridge() : undefined;
    // MarkdownView.file can already name the next note while CodeMirror still
    // contains the old one. Do not draw or accept a drop until that source's
    // complete loaded text has been confirmed; this never prunes UI records.
    if ((mode === 'source' && !bridge) || !this.sourceReady()) {
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
    if (this.observedBody !== bodyEl) {
      if (this.observedBody) this.resize.unobserve(this.observedBody);
      this.observedBody = bodyEl; this.resize.observe(bodyEl);
    }
    const rect = bodyEl.getBoundingClientRect(), scroll = scroller.getBoundingClientRect(), style = this.win.getComputedStyle(bodyEl);
    const body: Box = {
      left: Math.max(0, rect.left - hostRect.left + (parseFloat(style.paddingLeft) || 0)),
      right: Math.min(hostRect.width, rect.right - hostRect.left - (parseFloat(style.paddingRight) || 0)), top: 0, bottom: hostRect.height
    };
    // The client area excludes native scrollbar gutters and borders. Overlay
    // buttons must never cover a scrollbar, even at xNormalized=1.
    const viewport: Box = {
      left: Math.max(0, scroll.left + scroller.clientLeft - hostRect.left),
      right: Math.min(hostRect.width, scroll.left + scroller.clientLeft + scroller.clientWidth - hostRect.left),
      top: Math.max(0, scroll.top + scroller.clientTop - hostRect.top),
      bottom: Math.min(hostRect.height, scroll.top + scroller.clientTop + scroller.clientHeight - hostRect.top)
    };
    // Read one view's geometry together, then paint its cards and connectors in
    // the same frame. Keep following native sidebar animation until it settles.
    const geometry = [hostRect.left, hostRect.top, hostRect.width, hostRect.height, body.left, body.right, ...Object.values(viewport)].map(v => v.toFixed(1)).join(':');
    if (geometry !== this.geometrySignature) {
      this.geometrySignature = geometry; this.preview?.close(); cardTooltip.hideWithin(this.root); this.schedule();
    }
    // Keep the historical last-line/bottom+2 reference, independent of which
    // fragment currently intersects the viewport or is used by a connector.
    const scrollTop = scroller.scrollTop;
    this.decorations.mount(scroller, bodyEl, hostRect, scrollTop);
    const lineHeight = Math.max(12, Math.min(72, parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 24));
    const geometryKey = [hostRect.width, body.left, body.right, viewport.left, viewport.right, viewport.top, scroller.scrollLeft,
      prefs.density, prefs.layout, prefs.placementMode, prefs.cardShape, prefs.cardSize, prefs.edgePadding,
      style.font, style.lineHeight, style.letterSpacing,
      bridge?.cm.dom.closest('.markdown-source-view')?.classList.contains('is-live-preview')].join(':');
    const source = bridge?.text ?? this.view.data;
    if (this.layoutSource !== source) {
      this.clearFocus(); this.preview?.close();
      const occurrences = bridge?.parsed.links ?? parseWikilinks(source);
      this.occurrences = occurrences;
      this.validOccurrences = new Map(occurrences.map(a => [String(a.start), a.raw]));
      this.continuationNumbers = new Map(occurrences.map((a, index) => [String(a.start), index + 1]));
    }
    if (this.layoutGeometry !== geometryKey || this.layoutSource !== source) {
      this.preview?.close();
      this.stableLayout.clear(); this.contentAnchors.clear(); this.textObstacles.invalidate();
      this.routeCache?.clear();
      this.measurementsDirty = true;
      this.layoutGeometry = geometryKey; this.layoutSource = source;
    }
    this.scrollTop = scrollTop;
    const measure = this.measurementsDirty || viewport.top + scrollTop < this.measuredTop || viewport.bottom + scrollTop > this.measuredBottom;
    const needsRoutes = prefs.lines !== 'numbers' && prefs.lines !== 'none';
    if (needsRoutes && !this.textObstacles.covers(viewport, scrollTop)) {
      this.obstacles = this.textObstacles.read(bodyEl, hostRect, viewport, scrollTop);
      this.geometryRevision++;
    }
    if (measure) {
      const overscan = Math.max(160, viewport.bottom - viewport.top);
      this.measuredTop = viewport.top + scrollTop - overscan; this.measuredBottom = viewport.bottom + scrollTop + overscan;
      this.geometryRevision++; if (this.diagnostics) this.diagnostics.measurements++;
    }
    const contentBox = (r: Box): Box => ({ left: r.left - hostRect.left, right: r.right - hostRect.left,
      top: r.top - hostRect.top + scrollTop, bottom: r.bottom - hostRect.top + scrollTop });
    if (measure) {
      for (const anchor of bridge ? bridge.anchors() : this.host.reading.anchors(this.view, 80 * lineHeight + 100)) {
        if (this.validOccurrences.get(anchor.key) !== anchor.occurrence.raw) continue;
        this.contentAnchors.set(anchor.key, { ...anchor, rect: contentBox(anchor.rect), fragments: anchor.fragments.map(contentBox) });
      }
      this.measurementsDirty = false;
    }
    const screenBox = (r: Box): Box => ({ left: r.left + hostRect.left, right: r.right + hostRect.left,
      top: r.top + hostRect.top - scrollTop, bottom: r.bottom + hostRect.top - scrollTop });
    this.anchors = [...this.contentAnchors.values()].map(a => ({ ...a, rect: screenBox(a.rect), fragments: a.fragments.map(screenBox) }));
    this.svg.setAttribute('width', String(hostRect.width)); this.svg.setAttribute('height', String(bodyEl.closest<HTMLElement>('.cm-sizer')?.clientHeight ?? bodyEl.clientHeight));
    // Clip the complete overlay (including pointer hit testing) to this note's
    // scroll region. Offscreen text and cards have independent intersection.
    this.root.style.clipPath = `inset(${viewport.top}px ${hostRect.width - viewport.right}px ${hostRect.height - viewport.bottom}px ${viewport.left}px)`;
    applyAppearance(this.root, prefs);
    applyAppearance(this.decorations.element, prefs);
    this.layoutInput = {
      width: hostRect.width, height: hostRect.height, body, viewport, density: prefs.density, layout: prefs.layout, preferences: prefs,
      lineHeight,
      anchors: this.anchors.map(a => ({ key: a.key, x: (a.rect.left + a.rect.right) / 2 - hostRect.left, y: a.rect.bottom + 2 - hostRect.top,
        preferred: bridge?.preferred(a.occurrence.start, a.occurrence.target), manual: this.host.layouts.get(this.path, a.layoutKey, this.legacyLayoutKeys.get(a.layoutKey ?? '')) }))
    };
    if (prefs.groupMode !== 'none') {
      this.groups ??= new GroupControls(this.view, () => {
        this.cancelInteractions();
        if (this.highlighted && !this.groups?.visible(this.highlighted)) this.clearFocus();
        this.schedule();
      });
      this.groups.update(prefs.groupMode, this.occurrences, this.path);
    } else if (this.groups) {
      this.groups.destroy(); this.groups = undefined;
    }
    const placements = this.stableLayout.update(this.layoutInput, scrollTop, geometryKey)
      .filter(p => p.x + p.width > viewport.left && p.x < viewport.right && (!this.groups || this.groups.visible(p.key)));
    this.routePlacements = placements.map(p => this.cardDrag.placement(p.key) ?? p);
    const keep = new Set(placements.map(p => p.key));
    for (const [key, card] of this.cards) if (!keep.has(key)) { this.preview?.closeOwner(card.button); card.shell.remove(); card.path.remove(); card.continuation?.forEach(el => el.remove()); this.cards.delete(key); }
    const anchorMap = new Map(this.anchors.map(a => [a.key, a]));
    for (const p of placements) {
      const anchor = anchorMap.get(p.key)!;
      let card = this.cards.get(p.key);
      const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.path);
      const group = this.groups?.label(p.key);
      const signature = JSON.stringify([anchor.occurrence.raw, resolved.file?.path, group]);
      if (!card) {
        const shell = this.decorations.canvas.createDiv({ cls: 'margin-link-card-shell' });
        const button = shell.createEl('button');
        const path = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('margin-link-connector'); path.dataset.members = JSON.stringify([p.key]); path.dataset.logical = 'true'; path.style.display = 'none'; shell.dataset.relation = p.key; this.svg.appendChild(path);
        card = { shell, button, path, signature: '', anchor, placement: p }; this.cards.set(p.key, card);
        this.bindCard(p.key, card);
      }
      card.anchor = anchor; card.placement = p;
      if (card.signature !== signature) {
        this.preview?.closeOwner(card.button); card.button.replaceChildren(); renderCard(card.button, anchor.occurrence, resolved);
        if (group) {
          card.shell.dataset.group = group;
          card.button.querySelector('.margin-link-card-text')?.createSpan({ cls: 'margin-link-group-label', text: group });
        } else delete card.shell.dataset.group;
        card.signature = signature;
      }
      card.button.classList.toggle('margin-link-card-movable', prefs.placementMode !== 'auto');
      card.button.setAttribute('aria-description', (group ? '分组 ' + group + '。' : '') + 'Enter 打开，V 预览，P 固定或取消高亮，Escape 关闭预览和固定。' +
        (prefs.placementMode !== 'auto' ? '方向键移动，Shift+左右键跨侧，Delete 重置位置。' : ''));
      this.place(card, this.cardDrag.placement(p.key) ?? p);
    }
    this.paintConnectors();
    this.updateContinuations();
    this.refreshFocus(true);
    this.drag.update(this.cardDrag.dragging ? undefined : bridge, hostRect, viewport, body);
    // First stable display is the initial UI placement, not an invitation to
    // rebalance on the next visit. A gesture only writes on its final commit.
    if (prefs.placementMode !== 'auto') this.freezeLayout(false);
  }
  private bindCard(key: string, card: Card): void {
    const { shell, button } = card;
    button.setAttribute('aria-keyshortcuts', 'P V Escape');
    shell.addEventListener('pointerenter', event => {
      this.hover(key);
      if (!event.buttons && !this.cardDrag.dragging) this.showPreview(key);
    });
    shell.addEventListener('pointerleave', () => { this.hover(undefined); this.preview?.leave(button); });
    shell.addEventListener('focusin', () => { this.focused = key; this.hover(undefined); });
    shell.addEventListener('focusout', event => {
      this.focused = undefined;
      this.refreshFocus();
      this.preview?.blurOwner(button, event.relatedTarget);
    });
    button.addEventListener('click', event => { if (!this.cardDrag.consumeClick(event, key)) void this.open(key, event); });
    button.addEventListener('pointerdown', event => { this.preview?.close(); this.drag.cancel(); this.cardDrag.start(event, key, button); });
    button.addEventListener('keydown', event => this.onCardKey(event, key));
    shell.addEventListener('contextmenu', event => {
      event.preventDefault(); this.preview?.close();
      const menu = new Menu();
      this.menus.add(menu); menu.onHide(() => this.menus.delete(menu));
      const raw = card.anchor.occurrence.raw, source = this.layoutSource;
      const valid = () => this.cards.get(key) === card && card.anchor.occurrence.raw === raw &&
        this.path === this.view.file?.path && this.layoutSource === source;
      menu.addItem(item => item.setTitle(this.pinned === key ? '取消固定高亮' : '固定此处关联高亮').setIcon('pin').onClick(() => {
        if (valid()) this.togglePin(key);
      }));
      menu.addItem(item => item.setTitle('重新链接文件…').setIcon('link-2').onClick(() => {
        if (valid()) this.host.selection.relink(this.view, card.anchor.occurrence, this.bridge());
      }));
      menu.addItem(item => item.setTitle('取消链接文件').setIcon('unlink').onClick(() => {
        if (valid() && source === (this.view.getMode() === 'source' ? this.bridge()?.text : this.view.data)) {
          void this.host.selection.unlink(this.view, card.anchor.occurrence, this.bridge());
        }
      }));
      menu.addItem(item => item.setTitle(this.host.preferences.placementMode === 'manual' ? '重置此卡片初始位置' : '恢复此卡片初始位置').setIcon('rotate-ccw').onClick(() => {
        const layoutKey = card.anchor.layoutKey;
        if (valid() && layoutKey) this.host.layouts.clear(this.path, layoutKey, this.legacyLayoutKeys.get(layoutKey));
      }));
      menu.showAtMouseEvent(event);
    });
  }
  private sourceReady(): boolean {
    if (this.confirmedSource === this.path) return true;
    const file = this.view.file;
    if (!file || this.checkingSource) return false;
    const source = this.path, generation = this.sourceGeneration;
    this.checkingSource = true;
    void this.host.app.vault.cachedRead(file).then(text => {
      if (this.stopped || generation !== this.sourceGeneration) return;
      this.checkingSource = false;
      const currentText = this.view.getMode() === 'source' ? this.bridge()?.text : this.view.data;
      // CodeMirror normalizes line endings even when the Vault file uses CRLF.
      const normalize = (value: string) => value.replace(/\r\n?/g, '\n');
      if (this.view.file?.path === source && currentText !== undefined && normalize(currentText) === normalize(text)) {
        this.win.clearTimeout(this.sourceRetryTimer); this.sourceRetryTimer = undefined;
        this.legacyLayoutKeys = legacyLayoutAliases(text, parseWikilinks(text));
        this.host.layouts.migrateAliases(source, this.legacyLayoutKeys);
        this.confirmedSource = source; this.schedule();
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
  private place(card: Card, p: Placement): void {
    const rect = this.hostRect;
    if (!rect) return;
    card.placement = p;
    card.shell.dataset.shape = p.shape ?? 'horizontal'; card.button.classList.toggle('margin-link-compact', p.compact);
    card.shell.dataset.manual = String(!!p.manual);
    const transform = `translate(${p.x}px, ${Math.round((p.y + this.scrollTop) * 10000) / 10000}px)`;
    const signature = `${transform}:${p.width}:${p.height}`;
    if (card.placementStyle !== signature) {
      Object.assign(card.shell.style, { width: `${p.width}px`, height: `${p.height}px`, transform });
      card.placementStyle = signature;
      this.geometryRevision++;
    }
  }
  private paintConnectors(): void {
    const rect = this.hostRect, input = this.layoutInput;
    if (!rect || !input) return;
    const prefs = this.host.preferences, view = input.viewport;
    if (prefs.lines === 'numbers' || prefs.lines === 'none') {
      this.svg.style.display = 'none';
      for (const card of this.cards.values()) card.shell.dataset.routeState = prefs.lines === 'numbers' ? 'numbered' : 'hidden';
      return;
    }
    this.svg.style.display = '';
    // Native scrolling already carries the ink with the note. Validate changed
    // geometry immediately, but explore optional shared corridors only once the
    // scroll becomes quiet. Existing coincident strokes remain shared throughout.
    const optimizeShared = !this.cardDrag.dragging && !this.scrolling;
    const signature = [this.geometryRevision, this.cards.size, prefs.lineStyle, prefs.lineWidth, this.textObstacles.revision, optimizeShared].join(':');
    if (signature === this.batchSignature) return;
    const coverage = this.textObstacles.bounds;
    const bounds = { ...view, top: coverage?.top ?? view.top + this.scrollTop, bottom: coverage?.bottom ?? view.bottom + this.scrollTop };
    const visible = new Map<string, boolean>();
    const relations: BatchRelationInput[] = [...this.cards].map(([key, card]) => {
      const p = card.placement;
      const fragments = card.anchor.fragments.map(f => ({ left: f.left - rect.left, right: f.right - rect.left,
        top: f.top - rect.top + this.scrollTop, bottom: f.bottom - rect.top + this.scrollTop }));
      const box = { left: p.x, right: p.x + p.width, top: p.y + this.scrollTop, bottom: p.y + p.height + this.scrollTop };
      const both = fragments.some(f => containsBox(bounds, f)) && containsBox(bounds, box); visible.set(key, both);
      return { key, fragments, card: { ...p, y: p.y + this.scrollTop }, previous: card.ports, bounds };
    });
    // Retain every layout slot, but do not search a route whose endpoints are
    // wholly outside the measured neighbourhood. Its card still protects other
    // routes, including cards whose own source has scrolled out of coverage.
    const intersects = (box: Box) => box.left <= bounds.right && box.right >= bounds.left && box.top <= bounds.bottom && box.bottom >= bounds.top;
    const active = relations.filter(relation => relation.fragments.some(intersects) && intersects({
      left: relation.card.x, right: relation.card.x + relation.card.width, top: relation.card.y, bottom: relation.card.y + relation.card.height
    }));
    const activeKeys = new Set(active.map(relation => relation.key));
    const inactiveCards = relations.filter(relation => !activeKeys.has(relation.key)).map(({ card }) => ({
      left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height
    }));
    // Reserve the widest highlighted stroke as well as at least .5px of real
    // whitespace. Dense rows may use the compact budget; their full DOM text
    // rectangles remain protected throughout routing and batch validation.
    this.batch = connectorBatch(active, prefs.lineStyle,
      { obstacles: this.obstacles, cardObstacles: inactiveCards, body: input.body, lineWidth: prefs.lineWidth + 0.5, minimumClearance: 0.5, optimizeShared }, this.batch, this.routeCache);
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
    for (const [key, card] of this.cards) {
      const relation = this.batch!.relations.get(key);
      card.ports = relation?.choice; this.writePath(card.path, relation?.path ?? '');
      card.shell.dataset.routeSegments = JSON.stringify(relation?.segments ?? []);
      card.shell.dataset.routeState = !card.anchor.fragments.length ? 'pending' : !visible.get(key) ? 'offscreen' : relation ? 'complete' : 'blocked';
      const points = relation?.connector.segments.flatMap(s => [s.from, s.to, ...(s.control ? [s.control] : []), ...(s.control2 ? [s.control2] : [])]);
      card.routeBounds = points?.length ? { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) } : undefined;
    }
  }
  private writePath(path: SVGPathElement, value: string): void {
    if (path.getAttribute('d') === value) return;
    path.setAttribute('d', value); if (this.diagnostics) this.diagnostics.svgWrites++;
  }
  private updateContinuations(): void {
    const input = this.layoutInput, rect = this.hostRect;
    if (!input || !rect) return;
    const mode = this.host.preferences.lines;
    const signature = [this.geometryRevision, this.cards.size, mode === 'none' ? 'none' : 'markers'].join(':');
    const layout = this.markerSignature !== signature;
    this.markerSignature = signature;
    const used: Box[] = [];
    const cards = this.routePlacements.map(p => ({ left: p.x, right: p.x + p.width,
      top: p.y + this.scrollTop, bottom: p.y + p.height + this.scrollTop }));
    const region = { ...input.viewport,
      top: Number.isFinite(this.measuredTop) ? this.measuredTop : input.viewport.top + this.scrollTop,
      bottom: Number.isFinite(this.measuredBottom) ? this.measuredBottom : input.viewport.bottom + this.scrollTop };
    const viewport = { ...input.viewport, top: input.viewport.top + this.scrollTop, bottom: input.viewport.bottom + this.scrollTop };
    const ordered = [...this.cards].sort(([a], [b]) => (this.continuationNumbers.get(a) ?? 0) - (this.continuationNumbers.get(b) ?? 0));
    for (const [key, card] of ordered) {
      const source = card.anchor.fragments.map(b => ({ left: b.left - rect.left, right: b.right - rect.left,
        top: b.top - rect.top + this.scrollTop, bottom: b.bottom - rect.top + this.scrollTop })).at(-1);
      const p = card.placement, target = { left: p.x, right: p.x + p.width, top: p.y + this.scrollTop, bottom: p.y + p.height + this.scrollTop };
      const blocked = this.batch ? !this.batch.relations.has(key) : ['blocked', 'continuation'].includes(card.shell.dataset.routeState ?? '');
      const clippedRoute = !!source && !!card.routeBounds && containsBox(viewport, source) && containsBox(viewport, target) && !containsBox(viewport, card.routeBounds);
      const show = mode !== 'none' && !!source && (mode === 'numbers' || blocked || clippedRoute);
      if (layout && mode !== 'none' && source) {
        if (!this.continuationNumbers.has(key)) this.continuationNumbers.set(key, this.continuationNumbers.size + 1);
        const number = this.continuationNumbers.get(key)!;
        const pair = relationNumberPair(source, target, region, input.body, [...this.obstacles, ...cards], used, Math.max(16, String(number).length * 7 + 4));
        used.push(...pair);
        card.shell.dataset.number = String(number);
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
      if (mode === 'none') card.shell.dataset.routeState = 'hidden';
      else if (mode === 'numbers') card.shell.dataset.routeState = 'numbered';
      else if (show) {
        card.shell.dataset.routeState = 'continuation';
        card.shell.dataset.routeReason = clippedRoute ? 'route-clipped-by-viewport' : 'search-exhausted';
      } else if (this.batch?.relations.has(key)) card.shell.dataset.routeState = 'complete';
      if (card.shell.dataset.routeState !== 'continuation' && card.shell.dataset.routeReason) delete card.shell.dataset.routeReason;
    }
  }
  private dragContext(key: string): CardDragContext | undefined {
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
      for (const other of this.cards.values()) other.continuation?.forEach(reserve);
      const space = previewSpace(lane(input, card.placement.side), box(card.placement), occupied);
      return { file: resolved.file, label: card.button.dataset.tooltip!, space, valid, open: event => { void this.open(key, event); } };
    }, keyboard);
  }
  private async open(key: string, event: MouseEvent): Promise<void> {
    const anchor = this.cards.get(key)?.anchor;
    if (!anchor || !this.view.file || this.view.file.path !== this.path || this.confirmedSource !== this.path) return;
    const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.view.file.path);
    if (!resolved.file) { new Notice('未找到该文件。请核对链接路径，以及设置中的“Obsidian 能识别的文件类型”。'); return; }
    if (!this.host.fileRecognition.canOpen(resolved.file.extension) && !canOpenInObsidian(this.host.app, resolved.file.extension)) { new Notice('文件已被 Vault 识别，但无法通过公开 API 确认此类型的打开能力。请先用相应文件类型插件打开一个该类型文件并保留其标签，再点击卡片；也可使用正文原生双链。'); return; }
    try {
      const leaf = event.ctrlKey || event.metaKey ? this.host.app.workspace.getLeaf('tab') : this.view.leaf;
      await leaf.openFile(resolved.file, { eState: resolved.subpath ? { subpath: resolved.subpath } : undefined });
    } catch { new Notice('Obsidian 无法打开该文件类型，请先安装对应的文件类型处理插件。'); }
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (this.root.contains(event.target as Node) || this.decorations?.contains(event.target as Node) || this.cardDrag.dragging) return;
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
    if (!this.cards.has(key)) return;
    this.pinned = this.pinned === key ? undefined : key;
    this.refreshFocus(true);
  }
  private onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.preview?.close(true);
    if (this.pinned) this.clearFocus();
  };
  private clearFocus(): void {
    this.pinned = this.hovered = this.focused = undefined;
    this.highlight(undefined);
  }
  private refreshFocus(redraw = false): void {
    const selected = this.layoutInput && this.mode === 'source' ? this.bridge()?.cm.state.selection.main : undefined;
    const key = this.pinned ?? this.hovered ?? this.focused ?? (selected && selected.from !== selected.to
      ? this.anchors.find(a => selected.from < a.occurrence.end && selected.to > a.occurrence.start)?.key : undefined);
    this.highlight(key !== undefined && this.cards.has(key) ? key : undefined, redraw);
  }
  private highlight(key?: string, redraw = false): void {
    const previous = this.highlighted;
    if (previous === key && (!redraw || key === undefined)) return;
    const feedback = this.host.preferences.hoverFeedback;
    const mark = (id: string, on: boolean) => {
      const card = this.cards.get(id);
      if (!card) return;
      card.button.classList.toggle('margin-link-active', on && feedback);
      card.shell.classList.toggle('margin-link-focused', on && feedback);
      card.shell.classList.toggle('margin-link-pinned', on && id === this.pinned);
      card.path.classList.toggle('margin-link-active', on);
      card.continuation?.forEach(el => el.classList.toggle('margin-link-active', on));
      for (const ref of this.batch?.relations.get(id)?.segments ?? []) this.sharedPaths.get(ref.id)?.classList.toggle('margin-link-active', on);
    };
    if (previous !== undefined && previous !== key) mark(previous, false);
    this.highlighted = key;
    this.decorations?.element.classList.toggle('margin-link-has-focus', key !== undefined && feedback);
    this.highlightedElements.forEach(el => el.classList.remove('margin-link-anchor-active'));
    this.highlightedElements = [];
    const card = key !== undefined ? this.cards.get(key) : undefined;
    if (key !== undefined) mark(key, true);
    const element = card?.anchor.element;
    if (feedback && element && this.view.contentEl.contains(element)) {
      element.classList.add('margin-link-anchor-active'); this.highlightedElements.push(element);
    }
    // Draw the measured text fragments outside CM. domAtPos may return a whole
    // line or only the alias's first syntax span; neither identifies the range.
    const fragments = feedback && card && !element ? card.anchor.fragments : [];
    for (const [index, box] of fragments.entries()) {
      const ink = this.anchorInk[index] ??= this.decorations.canvas.createSpan({ cls: 'margin-link-anchor-ink', attr: { 'aria-hidden': 'true' } });
      Object.assign(ink.style, { left: (box.left - this.hostRect!.left) + 'px', top: (box.top - this.hostRect!.top + this.scrollTop) + 'px',
        width: (box.right - box.left) + 'px', height: (box.bottom - box.top) + 'px' });
    }
    this.anchorInk?.splice(fragments.length).forEach(el => el.remove());
  }
  private clearCards(): void {
    this.win.clearTimeout(this.scrollIdleTimer); this.scrollIdleTimer = undefined; this.scrolling = false;
    this.preview?.invalidate(); this.groups?.destroy(); this.groups = undefined; this.occurrences = []; cardTooltip.hideWithin(this.root);
    this.clearFocus(); for (const card of this.cards.values()) { card.shell.remove(); card.path.remove(); card.continuation?.forEach(el => el.remove()); }
    this.sharedPaths?.forEach(path => path.remove()); this.sharedPaths?.clear(); this.batch = undefined; this.batchSignature = '';
    this.routeCache?.clear();
    this.cards.clear(); this.continuationNumbers?.clear(); this.routePlacements = []; this.anchors = []; this.layoutInput = undefined;
    this.measurementsDirty = true; this.measuredTop = Infinity; this.measuredBottom = -Infinity; this.markerSignature = ''; this.geometryRevision++;
    this.stableLayout?.clear(); this.contentAnchors?.clear(); this.layoutGeometry = ''; this.layoutSource = ''; this.validOccurrences?.clear(); this.textObstacles?.invalidate();
  }
  destroy(): void {
    this.stopped = true; this.win.cancelAnimationFrame(this.frame); this.win.clearTimeout(this.sourceRetryTimer); this.resize.disconnect(); this.mutation.disconnect();
    for (const menu of [...this.menus]) menu.hide(); this.menus.clear();
    const container = this.view.contentEl;
    container.removeEventListener('keydown', this.onEscape);
    container.removeEventListener('scroll', this.onScroll, true);
    container.removeEventListener('pointermove', this.onPointerMove); container.removeEventListener('pointerleave', this.onLeave);
    this.win.removeEventListener('resize', this.schedule); container.ownerDocument.fonts?.removeEventListener('loadingdone', this.onFontsLoaded);
    this.cardDrag.destroy(); this.drag.destroy(); this.clearCards(); this.decorations.detach(); this.root.remove(); container.classList.remove('margin-link-host');
  }
}
