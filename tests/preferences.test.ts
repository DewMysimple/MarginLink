import { it, expect } from 'vitest';
import { readPreferences } from '../src/types';
it('only permits UI preferences into persistent data', () => {
  const saved = readPreferences({ enabled: false, lines: 'always', relations: [{ path: 'secret.md' }], sourcePath: 'A.md', x: 123, layout: 'right' });
  expect(saved).toEqual({ enabled: false, lines: 'always', density: 'auto', layout: 'right' });
});
