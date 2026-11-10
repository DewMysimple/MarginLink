import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { parseDocument, type ParsedDocument } from '../core/wikilink-parser';
import type { Anchor } from '../types';
import { layoutIdentities } from '../core/layout-identity';

export interface EditorHost {
  bridges: Set<EditorBridge>;
  refresh(): void;
}
export class EditorBridge {
  parsed: ParsedDocument;
  revision = 0;
  alive = true;
  text: string;
  identities = new Map<number, string>();
  private hint?: { from: number; target: string; side: 'left' | 'right'; revision: number };
  constructor(readonly cm: EditorView, readonly host: EditorHost) {
    this.text = cm.state.doc.toString();
    this.parsed = parseDocument(this.text);
    this.identities = layoutIdentities(this.text, this.parsed.links);
    host.bridges.add(this);
    host.refresh();
  }
  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.revision++;
      this.text = update.state.doc.toString();
      this.parsed = parseDocument(this.text);
      this.identities = layoutIdentities(this.text, this.parsed.links);
      this.hint = undefined;
    }
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || update.focusChanged) this.host.refresh();
  }
  prefer(from: number, target: string, side: 'left' | 'right'): void {
    this.hint = { from, target, side, revision: this.revision };
  }
  preferred(from: number, target: string): 'left' | 'right' | undefined {
    return this.hint?.from === from && this.hint.target === target && this.hint.revision === this.revision ? this.hint.side : undefined;
  }
  rangeRects(from: number, to: number): DOMRect[] {
    try {
      const start = this.cm.domAtPos(from);
      const end = this.cm.domAtPos(to);
      const range = this.cm.dom.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0);
      if (rects.length) return rects;
      const coord = this.cm.coordsAtPos(from);
      if (coord) return [new DOMRect(coord.left, coord.top, Math.max(1, coord.right - coord.left), coord.bottom - coord.top)];
    } catch { /* A CM viewport can be replaced between measurement requests. */ }
    return [];
  }
  anchors(): Anchor[] {
    const result: Anchor[] = [];
    for (const occurrence of this.parsed.links) {
      if (!this.cm.visibleRanges.some(r => occurrence.start < r.to && occurrence.end > r.from)) continue;
      const aliasAt = occurrence.raw.indexOf('|');
      const from = occurrence.start + (aliasAt >= 0 ? aliasAt + 1 : 2);
      const rects = this.rangeRects(from, occurrence.end - 2);
      // Last rendered line provides a real anchor for soft-wrapped aliases.
      const rect = rects.at(-1);
      if (rect) result.push({ key: String(occurrence.start), occurrence, rect, layoutKey: this.identities.get(occurrence.start) });
    }
    return result;
  }
  destroy(): void {
    this.alive = false;
    this.host.bridges.delete(this);
    this.host.refresh();
  }
}
export function editorExtension(host: EditorHost) {
  return ViewPlugin.define(view => new EditorBridge(view, host));
}
