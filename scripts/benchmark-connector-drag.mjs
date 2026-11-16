// Reproduce routing CPU work without the desktop compositor. Timings are local
// measurements; operation counts and baseline geometry comparisons are exact.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseline = argument('baseline') ?? 'HEAD';
assert(/^[\w./-]+$/.test(baseline), 'Expected an explicit Git revision');
const output = argument('output');
const body = { left: 220, right: 820, top: 0, bottom: 440 };
const obstacles = [120, 150, 180].map(top => ({ left: 220, right: 820, top, bottom: top + 20 }))
  .concat([{ left: 220, right: 820, top: 230, bottom: 255 }]);
const inputs = [
  ['Early Access', 300, 120, 60, 158], ['dives', 600, 120, 920, 48], ['Verse', 320, 150, 60, 268],
  ['Scene Graph', 440, 150, 60, 48], ['model-assisted', 600, 150, 920, 158], ['ship', 720, 180, 920, 268]
].map(([key, x, y, cx, cy]) => ({ key, fragments: [{ left: x, right: x + 40, top: y, bottom: y + 20 }], card: { x: cx, y: cy, width: 84, height: 84 } }));
const options = { body, obstacles, lineWidth: 2, bounds: { left: 0, right: 1100, top: 0, bottom: 440 }, minimumClearance: .5 };

async function implementation(version, instrument = false) {
  const result = await build({
    stdin: { contents: "export { connectorBatch } from './src/view/connector-batch'; export { connectorRoute } from './src/view/connector-renderer';", resolveDir: process.cwd() },
    bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'benchmark-implementation', setup(builder) {
      builder.onLoad({ filter: /connector-(?:renderer|batch)\.ts$/ }, async args => {
        const relative = `src/${args.path.replaceAll('\\', '/').split('/src/')[1]}`;
        const fromBaseline = version === 'baseline' || version === 'renderer-only' && relative.endsWith('/connector-batch.ts');
        let contents = fromBaseline ? execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8' }) : await readFile(args.path, 'utf8');
        if (instrument) for (const name of ['safe', 'clearCurve', 'clearCubic', 'routeAtClearance', 'searchRoute']) {
          contents = contents.replace(new RegExp(`(function ${name}\\([^]*?\\)\\s*:\\s*[^\\{]+\\{)`),
            `$1 globalThis.__marginLinkBenchmarkCounts.${name} = (globalThis.__marginLinkBenchmarkCounts.${name} ?? 0) + 1;`);
        }
        return { contents, loader: 'ts' };
      });
    } }]
  });
  // Distinct query suffixes prevent Node from reusing an earlier generated module.
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${version}-${instrument}`);
}

function motion(api, style, dragOnly, count) {
  const routing = { ...options, ...(dragOnly ? { optimizeShared: false } : {}) };
  let previous = api.connectorBatch(inputs, style, options);
  const times = [];
  globalThis.__marginLinkBenchmarkCounts = {};
  for (let i = 0; i < count; i++) {
    const moved = inputs.map((relation, index) => index ? relation : { ...relation,
      card: { ...relation.card, x: relation.card.x + i * 1.3, y: relation.card.y + Math.sin(i * .5) * 15 } });
    const started = performance.now();
    previous = api.connectorBatch(moved, style, routing, previous);
    times.push(performance.now() - started);
    assert.equal(previous.relations.size, inputs.length, 'Every moved frame retains all six connections');
  }
  times.sort((a, b) => a - b);
  return { p50Ms: times[Math.floor(count * .5)], p95Ms: times[Math.floor(count * .95)], maxMs: times.at(-1),
    counts: globalThis.__marginLinkBenchmarkCounts };
}

const report = { baseline, fixture: 'tests/six-connectors.test.ts; 30 deterministic frames moving one of six cards', measurements: [], geometry: {} };
const original = await implementation('baseline'), current = await implementation('final');
for (const version of ['baseline', 'renderer-only', 'final']) {
  const api = version === 'baseline' ? original : version === 'final' ? current : await implementation(version);
  const counted = await implementation(version, true);
  globalThis.__marginLinkBenchmarkCounts = {};
  for (const style of ['straight', 'elbow', 'curve']) {
    motion(api, style, version === 'final', 3);
    const timing = motion(api, style, version === 'final', 30);
    const { counts } = motion(counted, style, version === 'final', 30);
    const measurement = { version, style, ...timing, counts };
    report.measurements.push(measurement);
    console.log(JSON.stringify(measurement));
  }
}

// Deterministic differential geometry covers both sides, closed/dense lanes,
// bounds, card obstacles, explicit corridor preferences and thick strokes.
let seed = 0x221022;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
let compared = 0, available = 0, preExistingExceptions = 0;
const outcome = call => {
  try { return { route: call() }; }
  catch (error) { return { error: `${error.name}: ${error.message}` }; }
};
const compare = (source, card, own, previous, description) => {
  for (const style of ['straight', 'elbow', 'curve']) {
    const before = outcome(() => original.connectorRoute([source], card, style, previous, own));
    const after = outcome(() => current.connectorRoute([source], card, style, previous, own));
    assert.deepEqual(after, before, `Changed ${style} geometry in ${description}`);
    compared++; if (after.route) available++; if (after.error) preExistingExceptions++;
  }
};
for (let i = 0; i < 240; i++) {
  const source = { left: 260 + Math.floor(random() * 360), right: 0, top: 70 + Math.floor(random() * 190), bottom: 0 };
  source.right = source.left + 20 + Math.floor(random() * 80); source.bottom = source.top + 14 + Math.floor(random() * 10);
  const card = { x: i % 2 ? 40 : 930, y: 30 + Math.floor(random() * 300), width: 84, height: 84 };
  const gap = [0, 1, 3.5, 6, 20][i % 5];
  const text = [{ left: 220, right: 820, top: source.top - gap - 20, bottom: source.top - gap }, source,
    { left: 220, right: 820, top: source.bottom + gap, bottom: source.bottom + gap + 20 }];
  if (i % 3 === 0) text.push({ left: 350 + random() * 180, right: 650 + random() * 120, top: 350, bottom: 380 });
  const own = { ...options, obstacles: text, lineWidth: [1, 2, 5.5, 8][i % 4],
    preferCorridor: i % 4 === 0, corridorX: i % 2 ? 200 : 840,
    bounds: i % 7 === 0 ? { left: 0, right: 1100, top: 80, bottom: 250 } : options.bounds,
    cardObstacles: i % 6 === 0 ? [{ left: 840, right: 924, top: 100, bottom: 220 }] : [] };
  const previous = i % 3 ? undefined : { fragment: 0, source: i % 2 ? 'top' : 'bottom', target: i % 2 ? 'left' : 'right' };
  compare(source, card, own, previous, `deterministic case ${i}`);
}
const farCompared = compared;
// Exercise the short collinear exception and clean()'s immediate reversals at
// both sides of a precise normal-lead boundary, rather than only far-away cards.
const closeSource = { left: 100, right: 140, top: 100, bottom: 116 };
for (const x of [90, 100, 110, 120, 140]) for (const y of [50, 97.4, 97.5, 97.6, 99.95, 115.9, 116.05]) for (const width of [20, 84]) {
  compare(closeSource, { x, y, width, height: 20 }, { lineWidth: 2, minimumClearance: .5 }, undefined, `near-card ${x}/${y}/${width}`);
}
compare({ left: 400, right: 440, top: 100, bottom: 116 }, { x: 900, y: 80, width: 84, height: 84 }, {
  body: { left: 180, right: 820, top: 0, bottom: 300 }, lineWidth: 2, clearance: .5,
  obstacles: [{ left: 300, right: 418.5001, top: 80, bottom: 96.85 }, { left: 180, right: 820, top: 116, bottom: 160 }]
}, undefined, 'rounding before a blocked nominal escape');
report.geometry = { compared, farCompared, nearCompared: compared - farCompared, available, preExistingExceptions, exactMatches: compared, seed: '0x221022' };
console.log(JSON.stringify({ geometry: report.geometry }));
if (output) await writeFile(output, JSON.stringify(report, null, 2));
