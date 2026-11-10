import { MarkdownView, Menu, Notice, setIcon, type App } from 'obsidian';
import type { Anchor, Preferences, RelativePosition } from '../types';
import type { EditorBridge } from '../editor/editor-extension';
import type { ReadingAnchors } from '../reading/reading-anchors';
import type { SelectionAction } from '../editor/selection-action';
import type { LayoutStore } from '../core/layout-store';
import { DragController } from '../editor/drag-controller';
import { CardDragController, type CardDragContext } from './card-drag-controller';
import { resolveLink } from '../core/link-resolver';
import { canOpenInObsidian } from '../core/file-capabilities';
import { layoutCards, positionFromDrop, type Box, type LayoutInput, type Placement } from './layout-engine';
import { renderCard } from './card-renderer';
import { connectorPath } from './connector-renderer';
import { applyAppearance } from './appearance';

interface Card { shell: HTMLDivElement; button: HTMLButtonElement; grip: HTMLButtonElement; path: SVGPathElement; signature: string; anchor: Anchor; placement: Placement }
export interface OverlayHost {
  app: App; preferences: Preferences; bridges: Set<EditorBridge>;
  reading: ReadingAnchors; selection: SelectionAction; layouts: LayoutStore;
}
export class MarginOverlay {
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private drag: DragController;
  private cardDrag: CardDragController;
  private cards = new Map<string, Card>();
  private menus = new Set<Menu>();
  private anchors: Anchor[] = [];
  private resize: ResizeObserver;
  private mutation: MutationObserver;
  private frame = 0;
  private stopped = false;
  private path = '';
  private mode = '';
  private revision = -1;
  private layoutInput?: LayoutInput;
  private geometrySignature = '';
  private highlighted?: string;
  private highlightedElements: HTMLElement[] = [];
  private observedBody?: Element;
  private win: Window;
  constructor(readonly view: MarkdownView, private host: OverlayHost) {
    const container = view.contentEl;
    this.win = container.ownerDocument.defaultView!;
    container.classList.add('margin-link-host');
    this.root = container.createDiv({ cls: 'margin-link-overlay', attr: { 'aria-label': '正文边缘双链' } });
    this.svg = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('margin-link-connectors'); this.svg.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.svg);
    this.drag = new DragController(this.root, view, host.selection);
    this.cardDrag = new CardDragController(this.root, key => this.dragContext(key), (key, p) => {
      const card = this.cards.get(key);
      if (card && p) this.place(card, p);
      else this.schedule();
    }, (key, relative) => this.savePosition(key, relative));
    this.mutation = new MutationObserver(records => {
      if (records.some(r => {
        if (this.root.contains(r.target)) return false;
        if (r.type === 'attributes' && r.attributeName === 'class') {
          const strip = (v: string) => v.replace(/\bmargin-link-[\w-]+\b/g, '').trim();
          if (strip(r.oldValue ?? '') === strip((r.target as Element).getAttribute('class') ?? '')) return false;
        }
        return true;
      })) this.schedule();
    });
    this.mutation.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
    this.resize = new ResizeObserver(() => { this.root.style.visibility = 'hidden'; this.schedule(); }); this.resize.observe(container);
    container.addEventListener('scroll', this.schedule, true);
    container.addEventListener('pointermove', this.onPointerMove); container.addEventListener('pointerleave', this.onLeave);
    this.win.addEventListener('resize', this.schedule);
    container.ownerDocument.fonts?.addEventListener('loadingdone', this.schedule); this.schedule();
  }
  bridge(): EditorBridge | undefined { return [...this.host.bridges].find(b => b.alive && this.view.contentEl.contains(b.cm.dom)); }
  schedule = (): void => {
    if (!this.stopped && !this.frame) this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.render(); });
  };
  cancelInteractions(): void { this.cardDrag.cancel(); this.drag.cancel(); }
  private render(): void {
    const container = this.view.contentEl;
    const mode = this.view.getMode();
    if (this.path !== this.view.file?.path || this.mode !== mode) {
      this.path = this.view.file?.path ?? ''; this.mode = mode; this.revision = -1;
      this.cancelInteractions(); this.clearCards();
    }
    const prefs = this.host.preferences, hostRect = container.getBoundingClientRect();
    this.root.hidden = !prefs.enabled || !this.path || hostRect.width < 1 || hostRect.height < 1;
    if (this.root.hidden) { this.cancelInteractions(); this.clearCards(); return; }
    const bridge = mode === 'source' ? this.bridge() : undefined;
    if (bridge && this.revision !== bridge.revision) {
      this.cardDrag.cancel(); this.revision = bridge.revision;
      this.host.layouts.reconcile(this.path, new Set(bridge.identities.values()));
    }
    const scroller = bridge?.cm.scrollDOM ?? this.view.previewMode.containerEl;
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
    const viewport: Box = { left: Math.max(0, scroll.left - hostRect.left), right: Math.min(hostRect.width, scroll.right - hostRect.left), top: Math.max(0, scroll.top - hostRect.top), bottom: Math.min(hostRect.height, scroll.bottom - hostRect.top) };
    // Native sidebars animate. Hide during changing geometry rather than painting
    // yesterday's margin over today's text; show again after one stable frame.
    const geometry = [hostRect.left, hostRect.top, hostRect.width, hostRect.height, body.left, body.right, ...Object.values(viewport)].map(v => v.toFixed(1)).join(':');
    if (geometry !== this.geometrySignature) {
      this.geometrySignature = geometry; this.root.style.visibility = 'hidden'; this.cardDrag.cancel(); this.schedule();
    } else this.root.style.visibility = '';
    this.anchors = (bridge ? bridge.anchors() : this.host.reading.anchors(this.view)).filter(a => a.rect.width > 0 && a.rect.top >= hostRect.top + viewport.top && a.rect.bottom <= hostRect.top + viewport.bottom);
    this.svg.setAttribute('width', String(hostRect.width)); this.svg.setAttribute('height', String(hostRect.height));
    this.svg.style.clipPath = `inset(${viewport.top}px ${hostRect.width - viewport.right}px ${hostRect.height - viewport.bottom}px ${viewport.left}px)`;
    applyAppearance(this.root, prefs);
    this.layoutInput = {
      width: hostRect.width, height: hostRect.height, body, viewport, density: prefs.density, layout: prefs.layout, preferences: prefs,
      lineHeight: Math.max(12, Math.min(72, parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 24)),
      anchors: this.anchors.map(a => ({ key: a.key, x: (a.rect.left + a.rect.right) / 2 - hostRect.left, y: a.rect.bottom + 2 - hostRect.top,
        preferred: bridge?.preferred(a.occurrence.start, a.occurrence.target), manual: this.host.layouts.get(this.path, a.layoutKey) }))
    };
    const placements = layoutCards(this.layoutInput), keep = new Set(placements.map(p => p.key));
    for (const [key, card] of this.cards) if (!keep.has(key)) { card.shell.remove(); card.path.remove(); this.cards.delete(key); }
    const anchorMap = new Map(this.anchors.map(a => [a.key, a]));
    for (const p of placements) {
      const anchor = anchorMap.get(p.key)!;
      let card = this.cards.get(p.key);
      const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.path);
      const signature = `${anchor.occurrence.raw}\n${resolved.file?.path ?? '?'}`;
      if (!card) {
        const shell = this.root.createDiv({ cls: 'margin-link-card-shell' });
        const button = shell.createEl('button');
        const grip = shell.createEl('button', { cls: 'margin-link-card-grip', attr: { type: 'button', 'aria-label': '移动卡片：方向键调整，Shift 加方向键跨侧，Delete 恢复自动位置', title: '拖动调整位置 · 方向键移动 · Shift+左右键跨侧 · Delete 恢复自动' } });
        setIcon(grip, 'grip-vertical');
        const path = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('margin-link-connector'); this.svg.appendChild(path);
        card = { shell, button, grip, path, signature: '', anchor, placement: p }; this.cards.set(p.key, card);
        shell.addEventListener('pointerenter', () => this.highlight(p.key)); shell.addEventListener('pointerleave', () => this.highlight(undefined));
        shell.addEventListener('focusin', () => this.highlight(p.key)); shell.addEventListener('focusout', () => this.highlight(undefined));
        button.addEventListener('click', event => { void this.open(p.key, event); });
        grip.addEventListener('pointerdown', e => { this.drag.cancel(); this.cardDrag.start(e, p.key, grip); });
        grip.addEventListener('keydown', e => this.onGripKey(e, p.key));
        shell.addEventListener('contextmenu', e => {
          e.preventDefault(); const menu = new Menu(); this.menus.add(menu); menu.onHide(() => this.menus.delete(menu));
          menu.addItem(item => item.setTitle('恢复此卡片自动位置').setIcon('rotate-ccw').onClick(() => {
            const key = this.cards.get(p.key)?.anchor.layoutKey; if (key) this.host.layouts.clear(this.path, key);
          })); menu.showAtMouseEvent(e);
        });
      }
      card.anchor = anchor; card.placement = p;
      if (card.signature !== signature) { card.button.replaceChildren(); renderCard(card.button, anchor.occurrence, resolved); card.signature = signature; }
      card.grip.hidden = prefs.placementMode === 'auto';
      this.place(card, this.cardDrag.placement(p.key) ?? p);
    }
    const selected = bridge?.cm.state.selection.main;
    this.highlight(this.highlighted ?? (selected ? this.anchors.find(a => selected.from < a.occurrence.end && selected.to > a.occurrence.start)?.key : undefined));
    this.drag.update(this.cardDrag.dragging ? undefined : bridge, hostRect, viewport, body);
  }
  private place(card: Card, p: Placement): void {
    const rect = this.view.contentEl.getBoundingClientRect();
    card.shell.dataset.shape = p.shape ?? 'horizontal'; card.button.classList.toggle('margin-link-compact', p.compact);
    card.shell.dataset.manual = String(!!p.manual);
    Object.assign(card.shell.style, { width: `${p.width}px`, height: `${p.height}px`, transform: `translate(${p.x}px, ${p.y}px)` });
    const x = (p.side === 'left' ? card.anchor.rect.left : card.anchor.rect.right) - rect.left;
    card.path.setAttribute('d', connectorPath(x, card.anchor.rect.bottom + 2 - rect.top, p, this.host.preferences.lineStyle));
  }
  private dragContext(key: string): CardDragContext | undefined {
    const card = this.cards.get(key), input = this.layoutInput;
    if (!card || !input || this.host.preferences.placementMode === 'auto') return;
    const source = this.path, mode = this.mode, bridge = this.bridge(), revision = bridge?.revision;
    const layoutKey = card.anchor.layoutKey;
    return { input, anchor: input.anchors.find(a => a.key === key)!, occupied: [...this.cards].filter(([id]) => id !== key).map(([, c]) => c.placement),
      valid: () => !this.stopped && this.view.file?.path === source && this.view.getMode() === mode && (!bridge || bridge.revision === revision) && this.cards.get(key)?.anchor.layoutKey === layoutKey };
  }
  private savePosition(key: string, relative: RelativePosition): void {
    const card = this.cards.get(key);
    if (!card?.anchor.layoutKey) { new Notice('重复链接的上下文无法唯一辨别，未保存位置。请为它们提供不同的周围文字后重试。'); this.schedule(); return; }
    this.host.layouts.set(this.path, card.anchor.layoutKey, relative); this.schedule();
  }
  private onGripKey(event: KeyboardEvent, key: string): void {
    const card = this.cards.get(key), context = this.dragContext(key);
    if (!card || !context) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (card.anchor.layoutKey) this.host.layouts.clear(this.path, card.anchor.layoutKey); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    let x = card.placement.x + card.placement.width / 2, y = card.placement.y + card.placement.height / 2;
    if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) x = event.key === 'ArrowLeft' ? (context.input.viewport.left + context.input.body.left) / 2 : (context.input.body.right + context.input.viewport.right) / 2;
    else { x += event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0; y += event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0; }
    const result = positionFromDrop(context.input, context.anchor, x, y, context.occupied);
    if (result) this.savePosition(key, result.relative);
  }
  private async open(key: string, event: MouseEvent): Promise<void> {
    const anchor = this.cards.get(key)?.anchor;
    if (!anchor || !this.view.file) return;
    const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.view.file.path);
    if (!resolved.file) { new Notice('未解析目标：原生 Vault/链接解析器未找到文件。HTML 等格式可能需要文件类型插件；不会创建新笔记。'); return; }
    if (!canOpenInObsidian(this.host.app, resolved.file.extension)) { new Notice('文件已被 Vault 识别，但无法通过公开 API 确认此类型的打开能力。请先用相应文件类型插件打开一个该类型文件并保留其标签，再点击卡片；也可使用正文原生双链。'); return; }
    try {
      const leaf = event.ctrlKey || event.metaKey ? this.host.app.workspace.getLeaf('tab') : this.view.leaf;
      await leaf.openFile(resolved.file, { eState: resolved.subpath ? { subpath: resolved.subpath } : undefined });
    } catch { new Notice('Obsidian 无法打开该文件类型，请先安装对应的文件类型处理插件。'); }
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (this.root.contains(event.target as Node) || this.cardDrag.dragging) return;
    const bridge = this.view.getMode() === 'source' ? this.bridge() : undefined;
    const pos = bridge?.cm.posAtCoords({ x: event.clientX, y: event.clientY });
    this.highlight(bridge && pos !== null && pos !== undefined ? this.anchors.find(a => pos >= a.occurrence.start && pos < a.occurrence.end)?.key : this.anchors.find(a => a.element?.contains(event.target as Node))?.key);
  };
  private onLeave = (): void => this.highlight(undefined);
  private highlight(key: string | undefined): void {
    this.highlighted = key;
    this.highlightedElements.forEach(el => el.classList.remove('margin-link-anchor-active')); this.highlightedElements = [];
    for (const [id, card] of this.cards) {
      card.button.classList.toggle('margin-link-active', id === key && this.host.preferences.hoverFeedback);
      card.path.classList.toggle('margin-link-active', id === key);
      if (id !== key || !this.host.preferences.hoverFeedback) continue;
      let element = card.anchor.element;
      if (!element) {
        const bridge = this.bridge(), occurrence = card.anchor.occurrence;
        if (this.view.file?.path !== this.path) continue;
        try {
          const dom = bridge?.cm.domAtPos(occurrence.start + Math.max(2, occurrence.raw.indexOf('|') + 1));
          element = dom?.node.nodeType === 1 ? dom.node as HTMLElement : dom?.node.parentElement ?? undefined;
        } catch { /* Focus can leave a card while CM replaces the document/viewport. */ }
      }
      if (element && this.view.contentEl.contains(element)) { element.classList.add('margin-link-anchor-active'); this.highlightedElements.push(element); }
    }
  }
  private clearCards(): void {
    this.highlight(undefined); for (const card of this.cards.values()) { card.shell.remove(); card.path.remove(); }
    this.cards.clear(); this.anchors = []; this.layoutInput = undefined;
  }
  destroy(): void {
    this.stopped = true; this.win.cancelAnimationFrame(this.frame); this.resize.disconnect(); this.mutation.disconnect();
    for (const menu of [...this.menus]) menu.hide(); this.menus.clear();
    const container = this.view.contentEl;
    container.removeEventListener('scroll', this.schedule, true); container.removeEventListener('pointermove', this.onPointerMove); container.removeEventListener('pointerleave', this.onLeave);
    this.win.removeEventListener('resize', this.schedule); container.ownerDocument.fonts?.removeEventListener('loadingdone', this.schedule);
    this.cardDrag.destroy(); this.drag.destroy(); this.clearCards(); this.root.remove(); container.classList.remove('margin-link-host');
  }
}
