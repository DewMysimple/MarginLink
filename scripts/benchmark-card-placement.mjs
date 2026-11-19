import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { transform } from 'esbuild';

const base = 'efa1c913f246593ae6ba682ab9815a67cbab963a';
const file = 'src/view/layout-engine.ts';
async function load(source) {
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const old = await load(execFileSync('git', ['show', base + ':' + file], { encoding: 'utf8' }));
const current = await load(await readFile(file, 'utf8'));
const results = [];
for (const count of [72, 200, 500]) {
  const input = { width: 1576, height: 920, body: { left: 432, right: 1132, top: 0, bottom: 920 },
    viewport: { left: 0, right: 1564, top: 0, bottom: 920 }, density: 'auto', layout: 'balanced',
    preferences: { placementMode: 'auto', cardShape: 'square' },
    anchors: Array.from({ length: count }, (_, i) => ({ key: String(i), x: 440 + i % 680, y: 100 + Math.floor(i / 4) * 18 })) };
  const expected = old.layoutCards(input), actual = current.layoutCards(input);
  assert.deepEqual(actual, expected);
  const before = [], after = [];
  for (let i = 0; i < 11; i++) {
    for (const [engine, samples] of i % 2 ? [[current, after], [old, before]] : [[old, before], [current, after]]) {
      const start = performance.now();
      engine.layoutCards(input);
      if (i >= 2) samples.push(performance.now() - start);
    }
  }
  const median = values => +values.sort((a,b) => a-b)[Math.floor(values.length/2)].toFixed(3);
  results.push({ count, baselineMs: median(before), candidateMs: median(after), identicalRectangles: actual.length });
}
console.table(results);
await writeFile('artifacts/card-placement-performance.json', JSON.stringify({ base, node: process.version, samples: 9, results }, null, 2) + '\n');
