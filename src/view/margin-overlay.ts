import { MarkdownView, Notice, type App } from 'obsidian';
import type { Anchor, Preferences } from '../types';
import type { EditorBridge } from '../editor/editor-extension';
import type { ReadingAnchors } from '../reading/reading-anchors';
import type { SelectionAction } from '../editor/selection-action';
import { DragController } from '../editor/drag-controller';
import { resolveLink } from '../core/link-resolver';
import { canOpenInObsidian } from '../core/file-capabilities';
import { layoutCards, type Box } from './layout-engine';
import { renderCard } from './card-renderer';
import { connectorPath } from './connector-renderer';

interface Card { button: HTMLButtonElement; path: SVGPathElement; signature: string; anchor: Anchor }
export interface OverlayHost {
  app: App; preferences: Preferences; bridges: Set<EditorBridge>;
  reading: ReadingAnchors; selection: SelectionAction;
}
export class MarginOverlay {
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private drag: DragController;
  private cards = new Map<string, Card>();
  private anchors: Anchor[] = [];
  private resize: ResizeObserver;
  private mutation: MutationObserver;
  private frame = 0;
  private stopped = false;
  private path = '';
  private highlighted?: string;
  private highlightedElements: HTMLElement[] = [];
  private observedBody?: Element;
  private win: Window;
  constructor(readonly view: MarkdownView, private host: OverlayHost) {
    const container = view.contentEl;
    this.win = container.ownerDocument.defaultView!;
    container.classList.add('margin-link-host');
    this.root = container.createDiv({ cls: 'margin-link-overlay' });
    this.root.setAttribute('aria-label', '正文边缘双链');
    this.svg = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('margin-link-connectors');
    this.svg.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.svg);
    this.drag = new DragController(this.root, view, host.selection);
    // Observe scoped source changes; ignore our own ephemeral overlay to avoid feedback loops.
    this.mutation = new MutationObserver(records => {
      if (records.some(r => {
        if (this.root.contains(r.target)) return false;
        if (r.type === 'attributes' && r.attributeName === 'class') {
          const strip = (value: string) => value.replace(/\bmargin-link-[\w-]+\b/g, '').trim();
          if (strip(r.oldValue ?? '') === strip((r.target as Element).getAttribute('class') ?? '')) return false;
        }
        return true;
      })) this.schedule();
    });
    this.mutation.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(container);
    container.addEventListener('scroll', this.schedule, true);
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerleave', this.onLeave);
    this.win.addEventListener('resize', this.schedule);
    container.ownerDocument.fonts?.addEventListener('loadingdone', this.schedule);
    this.schedule();
  }
  bridge(): EditorBridge | undefined {
    return [...this.host.bridges].find(b => b.alive && this.view.contentEl.contains(b.cm.dom));
  }
  schedule = (): void => {
    if (!this.stopped && !this.frame) this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.render(); });
  };
  private render(): void {
    const container = this.view.contentEl;
    if (this.path !== this.view.file?.path) {
      this.path = this.view.file?.path ?? '';
      this.clearCards(); this.drag.cancel();
    }
    const prefs = this.host.preferences;
    const hostRect = container.getBoundingClientRect();
    this.root.hidden = !prefs.enabled || !this.path || hostRect.width < 1 || hostRect.height < 1;
    if (this.root.hidden) { this.clearCards(); this.drag.cancel(); return; }
    const bridge = this.view.getMode() === 'source' ? this.bridge() : undefined;
    const scroller = bridge?.cm.scrollDOM ?? this.view.previewMode.containerEl;
    const bodyEl = bridge?.cm.contentDOM ?? this.view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-sizer');
    if (!bodyEl) { this.clearCards(); this.drag.cancel(); return; }
    if (this.observedBody !== bodyEl) {
      if (this.observedBody) this.resize.unobserve(this.observedBody);
      this.observedBody = bodyEl;
      this.resize.observe(bodyEl);
    }
    const rect = bodyEl.getBoundingClientRect();
    const scroll = scroller.getBoundingClientRect();
    const style = this.win.getComputedStyle(bodyEl);
    const body: Box = {
      left: Math.max(0, rect.left - hostRect.left + (parseFloat(style.paddingLeft) || 0)),
      right: Math.min(hostRect.width, rect.right - hostRect.left - (parseFloat(style.paddingRight) || 0)),
      top: 0, bottom: hostRect.height
    };
    const viewport: Box = { left: Math.max(0, scroll.left - hostRect.left), right: Math.min(hostRect.width, scroll.right - hostRect.left), top: Math.max(0, scroll.top - hostRect.top), bottom: Math.min(hostRect.height, scroll.bottom - hostRect.top) };
    this.anchors = (bridge ? bridge.anchors() : this.host.reading.anchors(this.view)).filter(a => a.rect.width > 0 && a.rect.top >= hostRect.top + viewport.top && a.rect.bottom <= hostRect.top + viewport.bottom);
    // Clip at the actual scrolling viewport rather than at an application-global boundary.
    this.svg.setAttribute('width', String(hostRect.width));
    this.svg.setAttribute('height', String(hostRect.height));
    this.root.classList.toggle('margin-link-lines-always', prefs.lines === 'always');
    const placements = layoutCards({
      width: hostRect.width, height: hostRect.height, body, viewport,
      density: prefs.density, layout: prefs.layout,
      anchors: this.anchors.map(a => ({ key: a.key, x: (a.rect.left + a.rect.right) / 2 - hostRect.left, y: a.rect.bottom + 2 - hostRect.top, preferred: bridge?.preferred(a.occurrence.start, a.occurrence.target) }))
    });
    const keep = new Set(placements.map(p => p.key));
    for (const [key, card] of this.cards) {
      if (!keep.has(key)) { card.button.remove(); card.path.remove(); this.cards.delete(key); }
    }
    for (const p of placements) {
      const anchor = this.anchors.find(a => a.key === p.key)!;
      let card = this.cards.get(p.key);
      const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.path);
      const signature = `${anchor.occurrence.raw}\n${resolved.file?.path ?? '?'}`;
      if (!card) {
        const button = this.root.createEl('button');
        const path = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('margin-link-connector'); this.svg.appendChild(path);
        card = { button, path, signature: '', anchor };
        this.cards.set(p.key, card);
        button.addEventListener('pointerenter', () => this.highlight(p.key));
        button.addEventListener('pointerleave', () => this.highlight(undefined));
        button.addEventListener('focus', () => this.highlight(p.key));
        button.addEventListener('blur', () => this.highlight(undefined));
        button.addEventListener('click', event => { void this.open(p.key, event); });
      }
      card.anchor = anchor;
      if (card.signature !== signature) { card.button.replaceChildren(); renderCard(card.button, anchor.occurrence, resolved); card.signature = signature; }
      card.button.classList.toggle('margin-link-compact', p.compact);
      card.button.style.width = `${p.width}px`; card.button.style.height = `${p.height}px`;
      card.button.style.transform = `translate(${p.x}px, ${p.y}px)`;
      const x = (p.side === 'left' ? anchor.rect.left : anchor.rect.right) - hostRect.left;
      card.path.setAttribute('d', connectorPath(x, anchor.rect.bottom + 2 - hostRect.top, p));
    }
    const selected = bridge?.cm.state.selection.main;
    const active = this.highlighted ?? (selected ? this.anchors.find(a => selected.from < a.occurrence.end && selected.to > a.occurrence.start)?.key : undefined);
    this.highlight(active);
    this.drag.update(bridge, hostRect, viewport, body);
  }
  private async open(key: string, event: MouseEvent): Promise<void> {
    const anchor = this.cards.get(key)?.anchor;
    if (!anchor || !this.view.file) return;
    const resolved = resolveLink(this.host.app, anchor.occurrence.target, this.view.file.path);
    if (!resolved.file) { new Notice('未解析目标：原生 Vault/链接解析器未找到文件。HTML 等格式可能需要文件类型插件；不会创建新笔记。'); return; }
    if (!canOpenInObsidian(this.host.app, resolved.file.extension)) {
      new Notice('文件已被 Vault 识别，但无法通过公开 API 确认此类型的打开能力。请先用相应文件类型插件打开一个该类型文件并保留其标签，再点击卡片；也可使用正文原生双链。');
      return;
    }
    try {
      const leaf = event.ctrlKey || event.metaKey ? this.host.app.workspace.getLeaf('tab') : this.view.leaf;
      // Open the TFile itself. Unlike unresolved openLinkText, this cannot create a note.
      await leaf.openFile(resolved.file, { eState: resolved.subpath ? { subpath: resolved.subpath } : undefined });
    } catch { new Notice('Obsidian 无法打开该文件类型，请先安装对应的文件类型处理插件。'); }
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (this.root.contains(event.target as Node)) return;
    const bridge = this.view.getMode() === 'source' ? this.bridge() : undefined;
    const pos = bridge?.cm.posAtCoords({ x: event.clientX, y: event.clientY });
    const key = bridge && pos !== null && pos !== undefined
      ? this.anchors.find(a => pos >= a.occurrence.start && pos < a.occurrence.end)?.key
      : this.anchors.find(a => a.element?.contains(event.target as Node))?.key;
    this.highlight(key);
  };
  private onLeave = (): void => this.highlight(undefined);
  private highlight(key: string | undefined): void {
    this.highlighted = key;
    this.highlightedElements.forEach(el => el.classList.remove('margin-link-anchor-active'));
    this.highlightedElements = [];
    for (const [id, card] of this.cards) {
      card.button.classList.toggle('margin-link-active', id === key);
      card.path.classList.toggle('margin-link-active', id === key);
      if (id !== key) continue;
      let element = card.anchor.element;
      if (!element) {
        const bridge = this.bridge();
        const occurrence = card.anchor.occurrence;
        const dom = bridge?.cm.domAtPos(occurrence.start + Math.max(2, occurrence.raw.indexOf('|') + 1));
        const node = dom?.node;
        element = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement ?? undefined;
      }
      if (element && this.view.contentEl.contains(element)) { element.classList.add('margin-link-anchor-active'); this.highlightedElements.push(element); }
    }
  }
  private clearCards(): void {
    this.highlight(undefined);
    for (const card of this.cards.values()) { card.button.remove(); card.path.remove(); }
    this.cards.clear(); this.anchors = [];
  }
  destroy(): void {
    this.stopped = true;
    this.win.cancelAnimationFrame(this.frame);
    this.resize.disconnect(); this.mutation.disconnect();
    const container = this.view.contentEl;
    container.removeEventListener('scroll', this.schedule, true);
    container.removeEventListener('pointermove', this.onPointerMove);
    container.removeEventListener('pointerleave', this.onLeave);
    this.win.removeEventListener('resize', this.schedule);
    container.ownerDocument.fonts?.removeEventListener('loadingdone', this.schedule);
    this.drag.destroy(); this.clearCards(); this.root.remove();
    container.classList.remove('margin-link-host');
  }
}
