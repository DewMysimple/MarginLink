import { describe, expect, it } from 'vitest';
import { NativeScrollLayer } from '../src/view/native-scroll-layer';

class ElementStub {
  className = '';
  children: ElementStub[] = [];
  parent?: ElementStub;
  clientHeight = 1600;
  clientWidth = 900;
  clientLeft = 0;
  clientTop = 0;
  x = 40;
  y = 20;
  computedPosition = 'static';
  writes = 0;
  style = { position: '', getPropertyValue: (key: string) => this.values[key] ?? '',
    setProperty: (key: string, value: string) => { this.writes++; this.values[key] = value; } };
  values: Record<string, string> = {};
  ownerDocument = doc;
  closest() { return this.parent; }
  getBoundingClientRect() { return { left: this.x, top: this.y }; }
  appendChild(node: ElementStub) { node.remove(); this.children.push(node); node.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
  contains(node: ElementStub): boolean { return node === this || this.children.some(child => child.contains(node)); }
}
const doc = { createElement: () => new ElementStub(), defaultView: { getComputedStyle: (node: ElementStub) => ({ position: node.computedPosition }) } };
const host = { left: 40, top: 20, width: 900 } as DOMRect;
const element = (value: ElementStub) => value as unknown as HTMLElement;

describe('native note decoration layer', () => {
  it('mounts beside editable content and keeps the same document origin during a native scroll', () => {
    const sizer = new ElementStub(), body = new ElementStub(), scroller = new ElementStub();
    sizer.appendChild(body);
    const layer = new NativeScrollLayer(doc as unknown as Document);
    layer.mount(element(scroller), element(body), host, 0);
    const plane = layer.element as unknown as ElementStub, canvas = layer.canvas as unknown as ElementStub;
    expect(sizer.children).toEqual([body, plane]); expect(body.children).toEqual([]);
    expect(sizer.style.position).toBe('relative'); expect(plane.values.width).toBe('900px');
    const writes = [plane.writes, canvas.writes];
    sizer.y -= 75;
    layer.mount(element(scroller), element(body), host, 75);
    expect([plane.writes, canvas.writes]).toEqual(writes);
    expect(canvas.values.transform).toBe('translate(0px, 0px)');
    layer.detach(); expect(sizer.children).toEqual([body]); expect(sizer.style.position).toBe('');
  });
  it('moves between pane content roots and restores only positioning it owns', () => {
    const first = new ElementStub(), second = new ElementStub(), body = new ElementStub(), scroller = new ElementStub();
    first.appendChild(body);
    const layer = new NativeScrollLayer(doc as unknown as Document);
    layer.mount(element(scroller), element(body), host, 0);
    first.style.position = 'sticky'; second.computedPosition = 'relative'; second.style.position = 'relative';
    second.appendChild(body);
    layer.mount(element(scroller), element(body), host, 0);
    expect(first.style.position).toBe('sticky'); expect(first.children).toEqual([]);
    expect(second.children).toHaveLength(2);
    layer.detach(); expect(second.style.position).toBe('relative'); expect(second.children).toEqual([body]);
  });
});
