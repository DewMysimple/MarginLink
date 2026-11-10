import { MarkdownRenderChild, parseLinktext, type App, type MarkdownPostProcessorContext, type MarkdownView } from 'obsidian';
import { parseDocument, type ParsedDocument } from '../core/wikilink-parser';
import type { Anchor, WikilinkOccurrence } from '../types';
import { mapReadingLinks } from './source-mapping';

interface Entry { sourcePath: string; element: HTMLElement; links: { element: HTMLElement; occurrence: WikilinkOccurrence }[] }
export class ReadingAnchors {
  private entries = new Map<HTMLElement, Entry>();
  private children = new Set<MarkdownRenderChild>();
  // One current full source per rendered document, only in memory.
  private documents = new Map<string, { text: string; parsed: ParsedDocument; users: number }>();
  constructor(private app: App, private changed: () => void) {}
  process(element: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const info = ctx.getSectionInfo(element);
    if (!info) return;
    const existing = this.documents.get(ctx.docId);
    const document = existing?.text === info.text ? existing : { text: info.text, parsed: parseDocument(info.text), users: 0 };
    this.documents.set(ctx.docId, document);
    const lines = info.text.split('\n');
    const start = lines.slice(0, info.lineStart).reduce((n, line) => n + line.length + 1, 0);
    const end = lines.slice(0, info.lineEnd + 1).reduce((n, line) => n + line.length + 1, 0);
    const events = [
      ...document.parsed.links.filter(l => l.start >= start && l.start < end).map(l => ({ start: l.start, target: l.target, occurrence: l as WikilinkOccurrence | undefined })),
      ...document.parsed.markdownLinks.filter(l => l.start >= start && l.start < end).map(l => ({ start: l.start, target: l.target, occurrence: undefined as WikilinkOccurrence | undefined }))
    ].sort((a, b) => a.start - b.start);
    const anchors = [...element.querySelectorAll<HTMLElement>('a.internal-link, a.external-link')]
      .filter(a => !a.closest('.internal-embed, .markdown-embed, pre, code'));
    const normalize = (value: string) => {
      let decoded = value;
      try { decoded = decodeURI(value); } catch { /* Preserve malformed URI text verbatim. */ }
      const { path, subpath } = parseLinktext(decoded);
      const file = path ? this.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath) : this.app.vault.getFileByPath(ctx.sourcePath);
      return (file?.path ?? path.replace(/^\.\//, '')) + subpath;
    };
    const links = mapReadingLinks(events, anchors.map(anchor => ({ element: anchor, target: anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '' })), normalize)
      .filter(link => link.element.classList.contains('internal-link'));
    this.entries.set(element, { sourcePath: ctx.sourcePath, element, links });
    document.users++;
    const child = new MarkdownRenderChild(element);
    this.children.add(child);
    child.register(() => {
      this.children.delete(child);
      const current = this.entries.get(element);
      if (current?.links === links) this.entries.delete(element);
      document.users--;
      if (document.users <= 0 && this.documents.get(ctx.docId) === document) this.documents.delete(ctx.docId);
      this.changed();
    });
    ctx.addChild(child);
    this.changed();
  }
  anchors(view: MarkdownView): Anchor[] {
    const result: Anchor[] = [];
    const seen = new Set<HTMLElement>();
    for (const entry of this.entries.values()) {
      if (entry.sourcePath !== view.file?.path || !view.previewMode.containerEl.contains(entry.element) || entry.element.closest('.internal-embed')) continue;
      for (const { element, occurrence } of entry.links) {
        if (!element.isConnected || seen.has(element)) continue;
        seen.add(element);
        const rects = Array.from(element.getClientRects());
        const rect = rects.at(-1);
        if (rect) result.push({ key: String(occurrence.start), occurrence, rect, element });
      }
    }
    return result;
  }
  clear(): void {
    for (const child of this.children) child.unload();
    this.children.clear(); this.entries.clear(); this.documents.clear();
  }
}
