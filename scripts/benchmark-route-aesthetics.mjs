// Compare intentional route geometry changes without conflating them with
// shared-search policy changes. Geometry checks run outside the timing pass.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = argument('baseline') ?? '5482c0c';
assert(/^[\w./-]+$/.test(baseline), 'Expected an explicit Git revision');
const only = argument('only'), output = argument('output'), frames = Number(argument('frames') ?? 24);
assert(!only || ['baseline', 'current'].includes(only));
assert(Number.isInteger(frames) && frames > 0 && frames <= 240);
const body = { left: 220, right: 820, top: 0, bottom: 440 };
const obstacles = [120, 150, 180].map(top => ({ left: 220, right: 820, top, bottom: top + 20 }))
  .concat([{ left: 220, right: 820, top: 230, bottom: 255 }]);
const inputs = [
  ['Early Access', 300, 120, 60, 158], ['dives', 600, 120, 920, 48], ['Verse', 320, 150, 60, 268],
  ['Scene Graph', 440, 150, 60, 48], ['model-assisted', 600, 150, 920, 158], ['ship', 720, 180, 920, 268]
].map(([key, x, y, cx, cy]) => ({ key, fragments: [{ left: x, right: x + 40, top: y, bottom: y + 20 }], card: { x: cx, y: cy, width: 84, height: 84 } }));
const bounds = { left: 0, right: 1100, top: -200, bottom: 650 };
const options = { body, obstacles, lineWidth: 2, bounds, minimumClearance: .5 };
const shared = process.argv.includes('--shared');
const scenarios = ['cold-independent-batch', 'one-card-drag', 'unchanged-scroll', 'virtual-section-translation', 'empty-and-return',
  ...(shared ? ['cold-shared-batch', 'settle-shared-after-drag'] : [])];
const sourceFiles = ['src/view/connector-renderer.ts', 'src/view/connector-batch.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const currentSourceSHA256 = await sourceHashes();
const cardBox = card => ({ left: card.x, right: card.x + card.width, top: card.y, bottom: card.y + card.height });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p, box) => p.x > box.left + .001 && p.x < box.right - .001 && p.y > box.top + .001 && p.y < box.bottom - .001;

async function implementation(version, counted = false) {
  const result = await build({
    stdin: { contents: "export { connectorBatch, ConnectorRouteCache } from './src/view/connector-batch'; export { connectorRoute, clearConnectorSegments } from './src/view/connector-renderer'; export { svgSamples } from './tests/svg-path';", resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'route-aesthetics-implementation', setup(builder) {
      builder.onLoad({ filter: /connector-(?:renderer|batch)\.ts$/ }, async args => {
        const relative = `src/${args.path.replaceAll('\\', '/').split('/src/')[1]}`;
        let contents = version === 'baseline' ? execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8' }) : await readFile(args.path, 'utf8');
        if (counted && relative.endsWith('/connector-renderer.ts')) {
          const pattern = /(function connectorRoute\([^]*?\)\s*:\s*[^{]+\{)/;
          assert(pattern.test(contents), 'Cannot instrument connectorRoute');
          contents = contents.replace(pattern, '$1 globalThis.__routeAestheticsCalls++;');
        }
        return { contents, loader: 'ts' };
      });
    } }]
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${version}-${counted}`);
}

function verify(api, batch, actualInputs, ownOptions) {
  assert.equal(batch.relations.size, actualInputs.length, 'All submitted six-relation fixture members connect');
  for (const input of actualInputs) {
    const relation = batch.relations.get(input.key), cardObstacles = actualInputs.filter(other => other.key !== input.key).map(other => cardBox(other.card));
    assert(relation, input.key);
    assert(api.clearConnectorSegments(relation.connector.segments, input.fragments, input.card,
      { ...ownOptions, clearance: relation.connector.clearance, cardObstacles }), `${input.key}: stroke safety`);
    const points = api.svgSamples(relation.path, .5);
    assert(!points.some(p => ownOptions.obstacles.some(box => inside(p, box))), `${input.key}: glyph intersection`);
    assert(!points.some(p => cardObstacles.some(box => inside(p, box))), `${input.key}: other-card intersection`);
    assert(!points.some(p => p.x < ownOptions.bounds.left - .001 || p.x > ownOptions.bounds.right + .001 || p.y < ownOptions.bounds.top - .001 || p.y > ownOptions.bounds.bottom + .001), `${input.key}: coverage clipping`);
    let last;
    for (const reference of relation.segments) {
      const stroke = batch.segments.find(stroke => stroke.id === reference.id);
      assert(stroke?.members.includes(input.key), `${input.key}: ordered membership`);
      const part = api.svgSamples(stroke.path, .5);
      if (reference.reversed) part.reverse();
      assert(distance(last ?? points[0], part[0]) < .001, `${input.key}: shared seam`);
      last = part.at(-1);
    }
    assert(last && distance(last, points.at(-1)) < .001, `${input.key}: complete target end`);
  }
}

function sequence(api, style, scenario, count, validate = false) {
  const cache = new api.ConnectorRouteCache();
  let previous = api.connectorBatch(inputs, style, { ...options, optimizeShared: false });
  cache.remember(previous);
  const times = [];
  let routeCalls = 0;
  globalThis.__routeAestheticsCalls = 0;
  for (let i = 0; i < count; i++) {
    let actual = inputs, ownOptions = options;
    if (scenario === 'one-card-drag' || scenario === 'settle-shared-after-drag') actual = inputs.map((input, index) => index ? input : { ...input,
      card: { ...input.card, x: input.card.x + i * .25, y: input.card.y + Math.sin(i * .5) * 8 } });
    if (scenario === 'virtual-section-translation') {
      const dy = [0, .3125, -.1875, .625, -.5, .125][i % 6], moveBox = box => ({ ...box, top: box.top + dy, bottom: box.bottom + dy });
      actual = inputs.map(input => ({ ...input, fragments: input.fragments.map(moveBox), card: { ...input.card, y: input.card.y + dy } }));
      ownOptions = { ...options, obstacles: obstacles.map(moveBox) };
    }
    if (scenario === 'cold-independent-batch' || scenario === 'cold-shared-batch') previous = undefined;
    // Count and time only release work; gesture preparation belongs to the
    // independently measured one-card-drag scenario.
    if (scenario === 'settle-shared-after-drag') {
      previous = api.connectorBatch(actual, style, { ...ownOptions, optimizeShared: false }, previous, cache);
      cache.remember(previous);
    }
    const callsBefore = globalThis.__routeAestheticsCalls;
    const started = performance.now();
    if (scenario === 'empty-and-return') previous = api.connectorBatch([], style, { ...ownOptions, optimizeShared: false }, previous, cache);
    previous = api.connectorBatch(actual, style, { ...ownOptions, optimizeShared: scenario === 'cold-shared-batch' || scenario === 'settle-shared-after-drag' }, previous,
      scenario.startsWith('cold-') ? undefined : cache);
    if (!scenario.startsWith('cold-')) cache.remember(previous);
    times.push(performance.now() - started);
    routeCalls += globalThis.__routeAestheticsCalls - callsBefore;
    if (validate) verify(api, previous, actual, ownOptions);
  }
  times.sort((a, b) => a - b);
  return { p50Ms: times[Math.floor(count * .5)], p95Ms: times[Math.floor(count * .95)], maxMs: times.at(-1),
    routeCalls, connectedRelationsPerFrame: inputs.length, geometryFramesChecked: validate ? count : 0 };
}

const report = { baseline, baselineRevision: execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(),
  measuredAt: new Date().toISOString(), nodeVersion: process.version, currentSourceSHA256,
  framesPerScenario: frames, warmupFramesPerScenario: 3, implementationOrder: ['baseline', 'current'].filter(version => !only || version === only), sharedScenariosIncluded: shared,
  fixture: 'Synthetic six-relation geometry from tests/six-connectors.test.ts; no note text or saved user positions.',
  scope: 'Node routing CPU only; both versions use the same optimizeShared policy per scenario. Gesture scenarios defer shared exploration. Optional shared scenarios measure cold true-policy batches and release work after an untimed moved-card preparation. Cold batch includes all six routes. Empty-and-return includes one empty batch and its six-route return; it uses each version\'s own bounded cache. Geometry validation and instrumentation are separate from the timing pass. Desktop renderer/compositor behavior requires actual Obsidian acceptance.',
  measurements: [] };
for (const version of ['baseline', 'current'].filter(version => !only || version === only)) {
  const api = await implementation(version), counted = await implementation(version, true);
  for (const style of ['straight', 'elbow', 'curve']) for (const scenario of scenarios) {
    sequence(api, style, scenario, 3);
    const timing = sequence(api, style, scenario, frames);
    const counts = sequence(counted, style, scenario, frames);
    sequence(api, style, scenario, frames, true);
    const measurement = { version, style, scenario, ...timing, routeCalls: counts.routeCalls, geometryFramesChecked: frames };
    report.measurements.push(measurement);
    console.log(JSON.stringify(measurement));
  }
}
if (only !== 'baseline') assert.deepEqual(await sourceHashes(), currentSourceSHA256, 'Routing source changed during this measurement');
if (output) await writeFile(output, JSON.stringify(report, null, 2));
