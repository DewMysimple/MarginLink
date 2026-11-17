// Isolate routing work caused by a scrolling text neighbourhood. This does not
// measure DOM layout or compositor frames; use the desktop probe for those.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = argument('baseline') ?? 'HEAD';
assert(/^[\w./-]+$/.test(baseline), 'Expected an explicit Git revision');
const output = argument('output'), only = argument('only');
assert(!only || ['baseline', 'current'].includes(only), 'Expected --only=baseline or --only=current');
const count = Number(argument('frames') ?? 24);
assert(Number.isInteger(count) && count > 0 && count <= 240);
const body = { left: 220, right: 820, top: 0, bottom: 440 };
const obstacles = [120, 150, 180].map(top => ({ left: 220, right: 820, top, bottom: top + 20 }))
  .concat([{ left: 220, right: 820, top: 230, bottom: 255 }]);
const inputs = [
  ['Early Access', 300, 120, 60, 158], ['dives', 600, 120, 920, 48], ['Verse', 320, 150, 60, 268],
  ['Scene Graph', 440, 150, 60, 48], ['model-assisted', 600, 150, 920, 158], ['ship', 720, 180, 920, 268]
].map(([key, x, y, cx, cy]) => ({ key, fragments: [{ left: x, right: x + 40, top: y, bottom: y + 20 }], card: { x: cx, y: cy, width: 84, height: 84 } }));
const bounds = { left: 0, right: 1100, top: -200, bottom: 650 };
const options = { body, obstacles, lineWidth: 2, bounds, minimumClearance: .5 };
const scenarios = [
  { name: 'unchanged-neighbourhood', frame: () => ({ inputs, options }) },
  { name: 'far-text-added-and-removed', frame: i => ({ inputs, options: { ...options,
    obstacles: i % 2 ? obstacles : [...obstacles, { left: 220, right: 820, top: 500 + i, bottom: 520 + i }] } }) },
  { name: 'same-text-boxes-reordered', frame: i => ({ inputs, options: { ...options, obstacles: i % 2 ? [...obstacles].reverse() : obstacles } }) },
  { name: 'coverage-window-moves', frame: i => ({ inputs: inputs.map(input => ({ ...input,
    bounds: { ...bounds, top: bounds.top + i, bottom: bounds.bottom + i } })), options }) },
  { name: 'remote-text-and-window-move', frame: i => ({ inputs: inputs.map(input => ({ ...input,
    bounds: { ...bounds, top: bounds.top + i, bottom: bounds.bottom + i } })), options: { ...options,
      obstacles: [...obstacles, { left: 220, right: 820, top: 500 + i, bottom: 520 + i }] } }) },
  { name: 'virtual-section-translation', frame: i => {
    // Exact CSS subpixels emulate a section's vertical geometry correction;
    // endpoint distances and horizontal body geometry remain unchanged.
    const dy = [0, .3125, -.1875, .625, -.5, .125][i % 6];
    const translatedBox = box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy });
    return { inputs: inputs.map(input => ({ ...input, fragments: input.fragments.map(translatedBox),
      card: { ...input.card, y: input.card.y + dy } })),
    options: { ...options, obstacles: obstacles.map(translatedBox) } };
  } },
  { name: 'retained-offscreen-relations', frame: i => ({ inputs: [...inputs, ...Array.from({ length: 24 }, (_, index) => ({
    key: `offscreen-${index}`, fragments: [{ left: 300, right: 340, top: 1000 + index * 100, bottom: 1020 + index * 100 }],
    card: { x: index % 2 ? 60 : 920, y: 1000 + index * 100, width: 84, height: 84 }
  }))], options: { ...options, obstacles: [...obstacles, { left: 220, right: 820, top: 500 + i, bottom: 520 + i }] } }) }
];

async function implementation(version, instrument = false) {
  const result = await build({
    stdin: { contents: "export { connectorBatch } from './src/view/connector-batch'; export { clearConnectorSegments } from './src/view/connector-renderer'; export { svgSamples } from './tests/svg-path';", resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'benchmark-scroll-implementation', setup(builder) {
      builder.onLoad({ filter: /connector-(?:renderer|batch)\.ts$/ }, async args => {
        const relative = `src/${args.path.replaceAll('\\', '/').split('/src/')[1]}`;
        let contents = version === 'baseline' ? execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8' }) : await readFile(args.path, 'utf8');
        if (instrument) for (const name of ['connectorRoute', 'routeAtClearance', 'searchRoute', 'safe', 'clearCurve', 'clearCubic']) {
          const pattern = new RegExp(`(function ${name}\\([^]*?\\)\\s*:\\s*[^\\{]+\\{)`);
          if (relative.endsWith('/connector-renderer.ts')) assert(pattern.test(contents), `Cannot instrument ${name}`);
          contents = contents.replace(pattern, `$1 globalThis.__marginLinkScrollCounts.${name} = (globalThis.__marginLinkScrollCounts.${name} ?? 0) + 1;`);
        }
        return { contents, loader: 'ts' };
      });
    } }]
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${version}-${instrument}`);
}

const inside = (p, box) => p.x > box.left + .001 && p.x < box.right - .001 && p.y > box.top + .001 && p.y < box.bottom - .001;
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function verify(api, batch, frame) {
  assert.equal(batch.relations.size, inputs.length, 'All six in-coverage relations remain connected');
  for (const input of inputs) {
    const actual = frame.inputs.find(item => item.key === input.key), relation = batch.relations.get(input.key);
    assert(relation, input.key);
    const own = { ...frame.options, bounds: actual.bounds ?? frame.options.bounds, clearance: relation.connector.clearance,
      cardObstacles: frame.inputs.filter(other => other.key !== input.key).map(other => ({ left: other.card.x, right: other.card.x + other.card.width, top: other.card.y, bottom: other.card.y + other.card.height })) };
    assert(api.clearConnectorSegments(relation.connector.segments, actual.fragments, actual.card, own), `${input.key}: stroke safety`);
    const points = api.svgSamples(relation.path);
    assert(!points.some(p => frame.options.obstacles.some(box => inside(p, box))), `${input.key}: glyph intersection`);
    assert(!points.some(p => own.cardObstacles.some(box => inside(p, box))), `${input.key}: other-card intersection`);
    assert(!points.some(p => p.x < own.bounds.left - .001 || p.x > own.bounds.right + .001 || p.y < own.bounds.top - .001 || p.y > own.bounds.bottom + .001), `${input.key}: coverage clipping`);
    let last;
    for (const reference of relation.segments) {
      const stroke = batch.segments.find(stroke => stroke.id === reference.id);
      assert(stroke?.members.includes(input.key), `${input.key}: ordered membership`);
      const part = api.svgSamples(stroke.path);
      if (reference.reversed) part.reverse();
      assert(gap(last ?? points[0], part[0]) < .001, `${input.key}: shared seam`);
      last = part.at(-1);
    }
    assert(last && gap(last, points.at(-1)) < .001, `${input.key}: complete target end`);
  }
}

function sequence(api, style, scenario, frames, validate, deferShared) {
  const first = scenario.frame(0);
  let previous = api.connectorBatch(first.inputs, style, first.options);
  const times = [];
  globalThis.__marginLinkScrollCounts = {};
  let last;
  for (let i = 1; i <= frames; i++) {
    const frame = scenario.frame(i), started = performance.now();
    previous = api.connectorBatch(frame.inputs, style, { ...frame.options, optimizeShared: !deferShared }, previous);
    times.push(performance.now() - started);
    if (validate) verify(api, previous, frame);
    last = frame;
  }
  const counts = globalThis.__marginLinkScrollCounts;
  globalThis.__marginLinkScrollCounts = {};
  const settledAt = performance.now();
  const settled = api.connectorBatch(last.inputs, style, { ...last.options, optimizeShared: true }, previous);
  const settledMs = performance.now() - settledAt;
  if (validate) verify(api, settled, last);
  times.sort((a, b) => a - b);
  return { p50Ms: times[Math.floor(frames * .5)], p95Ms: times[Math.floor(frames * .95)], maxMs: times.at(-1),
    counts, submittedRelations: scenario.frame(1).inputs.length,
    settledMs, settledCounts: globalThis.__marginLinkScrollCounts };
}

const report = { baseline, framesPerScenario: count,
  fixture: 'Synthetic six-relation geometry from tests/six-connectors.test.ts; no note text or saved user positions.',
  scope: 'Routing CPU only. Neighbourhood events are deliberate batch submissions, not a claim that every desktop scroll renders or routes. Current policy defers shared exploration during the sequence and restores it once after the last frame. Offscreen scenario deliberately submits all 30 relations to both implementations and does not simulate the overlay culling layer.', measurements: [] };
for (const version of ['baseline', 'current'].filter(version => !only || version === only)) {
  const api = await implementation(version), counted = await implementation(version, true);
  for (const style of ['straight', 'elbow', 'curve']) for (const scenario of scenarios) {
    const deferShared = version === 'current';
    sequence(api, style, scenario, 3, false, deferShared);
    const timing = sequence(api, style, scenario, count, false, deferShared);
    const { counts, settledCounts } = sequence(counted, style, scenario, count, false, deferShared);
    sequence(api, style, scenario, count, true, deferShared);
    const measurement = { version, style, scenario: scenario.name, ...timing, counts,
      settledCounts, sharedExplorationDuringScroll: !deferShared,
      geometryFramesChecked: count, connectedRelationsPerFrame: inputs.length };
    report.measurements.push(measurement);
    console.log(JSON.stringify(measurement));
  }
}
if (output) await writeFile(output, JSON.stringify(report, null, 2));
