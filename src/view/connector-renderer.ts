import type { Placement } from './layout-engine';
import type { LineStyle } from '../types';
export function connectorPath(x: number, y: number, placement: Placement, style: LineStyle = 'curve'): string {
  const endX = placement.side === 'left' ? placement.x + placement.width : placement.x;
  const endY = placement.y + placement.height / 2;
  if (![x, y, endX, endY].every(Number.isFinite)) return '';
  if (style === 'straight') return `M ${x} ${y} L ${endX} ${endY}`;
  if (style === 'elbow') {
    const middle = (x + endX) / 2;
    return `M ${x} ${y} H ${middle} V ${endY} H ${endX}`;
  }
  const bend = Math.max(18, Math.abs(endX - x) * 0.5);
  const direction = placement.side === 'left' ? -1 : 1;
  return `M ${x} ${y} C ${x + direction * bend} ${y}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`;
}
