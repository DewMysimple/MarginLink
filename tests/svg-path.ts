/** Independent evaluator for emitted absolute SVG paths, including cubics. */
export interface SvgSample { x: number; y: number; dx: number; dy: number; command: number; t: number }
export function svgSamples(path: string, resolution = 0.2): SvgSample[] {
  const commands = [...path.matchAll(/([MLQC])\s+([^MLQC]+)/g)];
  let current = { x: 0, y: 0 };
  const points: SvgSample[] = [];
  commands.forEach(([, command, numbers], index) => {
    const v = numbers.trim().split(/[\s,]+/).map(Number);
    if (v.some(n => !Number.isFinite(n))) throw new Error('Invalid SVG coordinate');
    if (command === 'M') { current = { x: v[0], y: v[1] }; points.push({ ...current, dx: 0, dy: 0, command: index, t: 0 }); return; }
    const end = command === 'C' ? { x: v[4], y: v[5] } : command === 'Q' ? { x: v[2], y: v[3] } : { x: v[0], y: v[1] };
    const controls = command === 'L' ? [] : command === 'Q' ? [{ x: v[0], y: v[1] }] : [{ x: v[0], y: v[1] }, { x: v[2], y: v[3] }];
    const polygon = [current, ...controls, end];
    const length = polygon.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - polygon[i].x, p.y - polygon[i].y), 0);
    const count = Math.max(2, Math.ceil(length / resolution));
    for (let step = 1; step <= count; step++) {
      const t = step / count, u = 1 - t;
      let x: number, y: number, dx: number, dy: number;
      if (command === 'C') {
        const [a, b] = controls;
        x = u ** 3 * current.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t ** 3 * end.x;
        y = u ** 3 * current.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * end.y;
        dx = 3 * u * u * (a.x - current.x) + 6 * u * t * (b.x - a.x) + 3 * t * t * (end.x - b.x);
        dy = 3 * u * u * (a.y - current.y) + 6 * u * t * (b.y - a.y) + 3 * t * t * (end.y - b.y);
      } else if (command === 'Q') {
        const [a] = controls;
        x = u * u * current.x + 2 * u * t * a.x + t * t * end.x; y = u * u * current.y + 2 * u * t * a.y + t * t * end.y;
        dx = 2 * (u * (a.x - current.x) + t * (end.x - a.x)); dy = 2 * (u * (a.y - current.y) + t * (end.y - a.y));
      } else { x = current.x + (end.x - current.x) * t; y = current.y + (end.y - current.y) * t; dx = end.x - current.x; dy = end.y - current.y; }
      points.push({ x, y, dx, dy, command: index, t });
    }
    current = end;
  });
  return points;
}
