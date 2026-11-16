import { describe, expect, it, vi } from 'vitest';
import { renderCard } from '../src/view/card-renderer';
import type { ResolvedLink, WikilinkOccurrence } from '../src/types';

const setIcon = vi.hoisted(() => vi.fn());
vi.mock('obsidian', () => ({ setIcon }));

// Exercise the host DOM construction contract without a simulated layout engine.
// Real card bounds and text clipping are checked in scripts/check-html-icon.mjs.
class Element {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  id = '';
  type = '';
  ownerDocument = { createElementNS: (_namespace: string, tag: string) => new Element(tag) };
  classList = {
    add: (name: string) => { this.className = `${this.className} ${name}`.trim(); },
    toggle: (name: string, on: boolean) => {
      this.className = this.className.split(' ').filter(value => value !== name).join(' ');
      if (on) this.classList.add(name);
    }
  };
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  removeAttribute(name: string) { delete this.attrs[name]; }
  appendChild(child: Element) { this.children.push(child); return child; }
  createSpan({ cls, text }: { cls: string; text?: string }) {
    const span = new Element('span'); span.className = cls; span.textContent = text ?? '';
    return this.appendChild(span);
  }
  descendants(): Element[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
}
const occurrence: WikilinkOccurrence = { raw: '[[References/stages.html|Early Access]]', target: 'References/stages.html', alias: 'Early Access', label: 'Early Access', start: 0, end: 39 };
const resolved = (extension: string): ResolvedLink => ({ file: { name: `stages.${extension}`, path: `References/stages.${extension}`, extension } as ResolvedLink['file'], target: occurrence.target, subpath: '' });

describe('HTML card artwork and native card semantics', () => {
  it.each(['html', 'htm', 'HTML', 'HTM', 'HtMl'])('recognizes .%s and keeps one text-only accessible description', extension => {
    const button = new Element('button'); button.attrs.title = 'old tooltip'; button.attrs['aria-label'] = 'old tooltip';
    renderCard(button as unknown as HTMLButtonElement, occurrence, resolved(extension));
    const all = button.descendants(), icon = all.find(node => node.className.includes('margin-link-html-icon'))!;
    expect(icon.attrs['aria-hidden']).toBe('true');
    const svg = icon.children.find(node => node.tag === 'svg')!;
    expect(svg.attrs.viewBox).toBe('0 0 24 24');
    expect(svg.attrs.focusable).toBe('false');
    expect(svg.children.length).toBeGreaterThan(1);
    expect(svg.children.every(path => path.tag === 'path' && path.attrs.fill === 'currentColor')).toBe(true);
    expect(icon.children.find(node => node.className === 'margin-link-html-label')?.textContent).toBe('HTML');
    expect(all.find(node => node.id === button.attrs['aria-labelledby'])?.textContent).toBe(`stages.${extension} · HTML 文件`);
    expect(button.dataset.tooltip).toBe(`stages.${extension} · HTML 文件`);
    expect(button.attrs.title).toBeUndefined(); expect(button.attrs['aria-label']).toBeUndefined();
    expect(all.find(node => node.className === 'margin-link-card-label')?.textContent).toBe('Early Access');
  });
  it('continues to show unresolved-file feedback for a missing HTML target', () => {
    const button = new Element('button');
    renderCard(button as unknown as HTMLButtonElement, occurrence, { file: null, target: occurrence.target, subpath: '' });
    expect(button.className).toContain('margin-link-unresolved');
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), 'file-question');
    expect(button.descendants().some(node => node.tag === 'svg')).toBe(false);
  });
  it.each([['md', 'file-text'], ['XMIND', 'git-fork']])('preserves the existing .%s icon', (extension, expected) => {
    const button = new Element('button'); renderCard(button as unknown as HTMLButtonElement, occurrence, resolved(extension));
    expect(setIcon).toHaveBeenLastCalledWith(expect.anything(), expected);
    expect(button.descendants().some(node => node.className.includes('margin-link-html-icon'))).toBe(false);
  });
});
