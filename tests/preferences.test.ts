import { it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, readPreferences } from '../src/types';
it('only permits UI preferences into persistent data', () => {
  const saved = readPreferences({ enabled: false, lines: 'always', relations: [{ path: 'secret.md' }], sourcePath: 'A.md', x: 123, layout: 'right' });
  expect(saved).toEqual({ ...DEFAULT_PREFERENCES, enabled: false, lines: 'always', layout: 'right' });
});
