import type { Preferences } from '../types';
const colors = { theme: 'var(--interactive-accent)', purple: 'var(--color-purple)', blue: 'var(--color-blue)', green: 'var(--color-green)', gray: 'var(--text-muted)' };
export function applyAppearance(root: HTMLElement, p: Preferences): void {
  root.classList.toggle('margin-link-lines-always', p.lines === 'always');
  root.classList.toggle('margin-link-lines-none', p.lines === 'none');
  root.classList.toggle('margin-link-reduce-motion', p.reduceMotion);
  root.classList.toggle('margin-link-no-hover', !p.hoverFeedback);
  root.classList.toggle('margin-link-no-path', !p.showPath);
  root.classList.toggle('margin-link-hide-drag-hints', !p.dragHints);
  root.style.setProperty('--margin-link-color', colors[p.lineColor]);
  root.style.setProperty('--margin-link-line-width', String(p.lineWidth));
  root.style.setProperty('--margin-link-opacity', String(p.lineOpacity));
  root.style.setProperty('--margin-link-radius', `${p.cardRadius}px`);
  root.style.setProperty('--margin-link-border', p.cardBorder ? '1px' : '0px');
  root.style.setProperty('--margin-link-shadow', p.cardShadow === 'none' ? 'none' : p.cardShadow === 'strong' ? 'var(--shadow-s)' : '0 2px 7px var(--background-modifier-box-shadow)');
}
