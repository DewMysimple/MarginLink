import { describe, expect, it } from 'vitest';
import { connectorBatch, type BatchRelationInput } from '../src/view/connector-batch';
import { connectorRoute, type Point } from '../src/view/connector-renderer';

// Inspect the drawn polyline rather than counting partitioned SVG strokes:
// a shared straight interval may have several references and still have no turn.
function drawnTurns(path: string): number {
  const points = [...path.matchAll(/[ML]\s+([-\d.e]+)\s+([-\d.e]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
  const vectors: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const x = points[i].x - points[i - 1].x, y = points[i].y - points[i - 1].y, length = Math.hypot(x, y);
    if (length > 0.001) vectors.push({ x: x / length, y: y / length });
  }
  return vectors.slice(1).filter((v, i) => Math.abs(v.x * vectors[i].y - v.y * vectors[i].x) > 0.001 || v.x * vectors[i].x + v.y * vectors[i].y < 0).length;
}

const body = { left: 180, right: 820, top: 0, bottom: 650 };
const obstacles = [120, 150, 180, 210, 240, 270, 300, 330, 360].map(top => ({ left: 180, right: 820, top, bottom: top + 20 }));
const inputs: BatchRelationInput[] = [
  { key: 'above', fragments: [{ left: 400, right: 440, top: 300, bottom: 320 }], card: { x: 856, y: 170, width: 84, height: 84, side: 'right' } },
  { key: 'below', fragments: [{ left: 600, right: 640, top: 180, bottom: 200 }], card: { x: 856, y: 400, width: 84, height: 84, side: 'right' } }
];

describe('shared corridor visual quality', () => {
  it.each(['straight', 'elbow'] as const)('%s sharing never adds turns to an independently simple route', style => {
    const options = { body, obstacles, lineWidth: 2 };
    const independent = inputs.map(input => connectorRoute(input.fragments, input.card, style, undefined, {
      ...options,
      cardObstacles: inputs.filter(other => other !== input).map(({ card }) => ({ left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height }))
    })!);
    const batch = connectorBatch(inputs, style, options);
    expect(batch.relations.size).toBe(2);
    inputs.forEach((input, i) => expect(drawnTurns(batch.relations.get(input.key)!.path)).toBeLessThanOrEqual(drawnTurns(independent[i].path)));
    if (style === 'elbow') {
      // Previously this two-turn connection gained a third turn solely to join
      // its neighbour's trunk, despite a safe direct top/card-bottom route.
      expect(drawnTurns(independent[0].path)).toBe(2);
      expect(drawnTurns(batch.relations.get('above')!.path)).toBe(2);
    }
  });

  it('reuses a verified compact-lane route and invalidates it when that clearance is withdrawn', () => {
    const input: BatchRelationInput = { key: 'dense', fragments: [{ left: 400, right: 440, top: 100, bottom: 116 }], card: { x: 856, y: 80, width: 84, height: 84 } };
    const options = { body, lineWidth: 2, obstacles: [
      { left: 180, right: 820, top: 80, bottom: 96 },
      { left: 180, right: 820, top: 120, bottom: 136 }
    ] };
    const compact = connectorBatch([input], 'elbow', { ...options, minimumClearance: 0.5 });
    expect(compact.relations.get('dense')?.connector.clearance).toBe(0.5);
    const cached = connectorBatch([input], 'elbow', { ...options, minimumClearance: 0.5 }, compact);
    expect(cached.relations.get('dense')!.connector.points).toBe(compact.relations.get('dense')!.connector.points);
    const spacious = connectorBatch([input], 'elbow', options, cached);
    expect(spacious.relations.has('dense')).toBe(false);
  });
});
