/** Decorations share the browser's native scroll transform with the note.
 * The layer lives beside editable content, never in CodeMirror's contentDOM.
 * Its clipped, contained box exactly spans the existing sizer, so descendants
 * cannot contribute overflow or increase the note's scrollHeight. */
export class NativeScrollLayer {
  readonly element: HTMLDivElement;
  readonly canvas: HTMLDivElement;
  private parent?: HTMLElement;
  private previousPosition = '';
  private positioned = false;
  private styles = new WeakMap<HTMLElement, Map<string, string>>();
  constructor(document: Document) {
    this.element = document.createElement('div');
    this.element.className = 'margin-link-decoration-layer';
    this.canvas = document.createElement('div');
    this.canvas.className = 'margin-link-decoration-canvas';
    this.element.appendChild(this.canvas);
  }
  mount(scroller: HTMLElement, body: HTMLElement, host: DOMRect, scrollTop: number): void {
    const parent = body.closest<HTMLElement>('.cm-sizer') ?? body;
    if (this.parent !== parent) {
      this.detach(); this.parent = parent;
      this.previousPosition = parent.style.position;
      this.positioned = parent.ownerDocument.defaultView!.getComputedStyle(parent).position === 'static';
      if (this.positioned) parent.style.position = 'relative';
    }
    // Reading mode can replace a sizer's rendered children while retaining the
    // same element. Repair that host-owned removal without resetting position
    // ownership, the canvas, cards, or cached document coordinates.
    if (this.element.parentElement !== parent) parent.appendChild(this.element);
    const origin = parent.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    const left = viewport.left + scroller.clientLeft;
    const stable = (value: number) => Math.round(value * 10000) / 10000;
    this.style(this.element, 'left', `${stable(left - origin.left - parent.clientLeft)}px`);
    this.style(this.element, 'width', `${scroller.clientWidth}px`);
    this.style(this.canvas, 'transform', `translate(${stable(host.left - left)}px, ${stable(host.top - origin.top - parent.clientTop - scrollTop)}px)`);
    this.style(this.canvas, 'width', `${host.width}px`);
    this.style(this.canvas, 'height', `${parent.clientHeight}px`);
  }
  private style(element: HTMLElement, property: string, value: string): void {
    let styles = this.styles.get(element);
    if (!styles) { styles = new Map(); this.styles.set(element, styles); }
    if (styles.get(property) !== value) { element.style.setProperty(property, value); styles.set(property, value); }
  }
  contains(node: Node): boolean { return node === this.element || this.element.contains(node); }
  detach(): void {
    this.element.remove();
    if (this.positioned && this.parent?.style.position === 'relative') this.parent.style.position = this.previousPosition;
    this.parent = undefined; this.positioned = false;
  }
}
