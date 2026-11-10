import type { Placement } from './layout-engine';
export function connectorPath(x: number, y: number, placement: Placement): string {
  const endX = placement.side === 'left' ? placement.x + placement.width : placement.x;
  const endY = placement.y + placement.height / 2;
  const bend = Math.max(18, Math.abs(endX - x) * 0.5);
  const direction = placement.side === 'left' ? -1 : 1;
  return `M ${x} ${y} C ${x + direction * bend} ${y}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`;
}
