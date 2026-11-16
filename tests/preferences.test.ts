import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, readPreferences } from '../src/types';
import { readStoredData } from '../src/core/layout-store';
it('only permits UI preferences into persistent data', () => {
  const saved = readPreferences({ enabled: false, lines: 'always', relations: [{ path: 'secret.md' }], sourcePath: 'A.md', x: 123, layout: 'right' });
  expect(saved).toEqual({ ...DEFAULT_PREFERENCES, enabled: false, lines: 'always', layout: 'right' });
});

describe('first-enable and reset appearance defaults', () => {
  const defaults = { lines: 'always', placementMode: 'free', cardShape: 'square' };
  it('uses the same always/free/square defaults for absent input and the reset object', () => {
    expect(DEFAULT_PREFERENCES).toMatchObject(defaults);
    for (const input of [null, undefined, {}, { schemaVersion: 2 }, { schemaVersion: 2, preferences: {} }]) {
      expect(readStoredData(input).preferences).toEqual(DEFAULT_PREFERENCES);
    }
    // The reset path copies this public constant, then persists through the
    // same reader that first enable uses. Layout data is independent of it.
    expect(readStoredData({ schemaVersion: 2, preferences: { ...DEFAULT_PREFERENCES } }).preferences).toEqual(DEFAULT_PREFERENCES);
  });
  it.each(['legacy', 'nested'])('preserves valid %s values, including the former defaults, across reload', storage => {
    const saved = { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' };
    const input = storage === 'legacy' ? saved : { schemaVersion: 2, preferences: saved };
    const parsed = readStoredData(input);
    expect(parsed.preferences).toMatchObject(saved);
    expect(readStoredData(JSON.parse(JSON.stringify(parsed))).preferences).toEqual(parsed.preferences);
  });
  it.each(['lines', 'placementMode', 'cardShape'] as const)('falls back only the missing or invalid %s field', key => {
    const saved = { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' };
    for (const value of [undefined, null, 'invalid', 3, false, [], {}]) {
      const preferences: Record<string, unknown> = { ...saved, [key]: value };
      if (value === undefined) delete preferences[key];
      const expected = { ...saved, [key]: DEFAULT_PREFERENCES[key] };
      expect(readPreferences(preferences)).toMatchObject(expected);
      expect(readStoredData(preferences).preferences).toMatchObject(expected);
      expect(readStoredData({ schemaVersion: 2, preferences }).preferences).toMatchObject(expected);
    }
  });
  it.each(['lines', 'placementMode', 'cardShape'] as const)('retains all supported %s values individually', key => {
    const choices = { lines: ['none', 'hover', 'always'], placementMode: ['auto', 'free', 'snap'], cardShape: ['horizontal', 'square', 'icon'] };
    for (const value of choices[key]) expect(readPreferences({ [key]: value })[key]).toBe(value);
  });
  it('preserves saved card coordinates when appearance is reset', () => {
    const layout = { source: 'A.md', key: 'a'.repeat(64), side: 'right', xNormalized: 0.8, yOffset: 3, updated: Date.now() };
    const before = readStoredData({ schemaVersion: 2, preferences: { cardShape: 'horizontal', placementMode: 'snap', lines: 'hover' }, layouts: [layout] });
    const reset = readStoredData({ ...before, preferences: { ...DEFAULT_PREFERENCES } });
    expect(reset.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(reset.layouts).toEqual(before.layouts);
  });
});
