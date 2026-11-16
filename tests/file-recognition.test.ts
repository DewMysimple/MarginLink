import { describe, expect, it, vi } from 'vitest';
import { FileRecognition } from '../src/core/file-recognition';
import { readStoredData } from '../src/core/layout-store';
import { DEFAULT_PREFERENCES } from '../src/types';

describe('Vault file recognition', () => {
  it.each([
    [true, true, ['html', 'htm', 'xmind']],
    [false, true, ['xmind']],
    [true, false, ['html', 'htm']],
    [false, false, []]
  ] as const)('registers HTML=%s and XMind=%s individually', (recognizeHtml, recognizeXmind, expected) => {
    const register = vi.fn<(ext: string) => void>();
    const recognition = new FileRecognition();
    recognition.register({ ...DEFAULT_PREFERENCES, recognizeHtml, recognizeXmind }, register);
    expect(register.mock.calls.flat()).toEqual(expected);
    expect(recognition.canOpen('HTML')).toBe(recognizeHtml);
    expect(recognition.canOpen('XMind')).toBe(recognizeXmind);
    expect(recognition.canOpen('bin')).toBe(false);
  });

  it('leaves an occupied format to its viewer and isolates other failures', () => {
    const recognition = new FileRecognition();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      recognition.register(DEFAULT_PREFERENCES, extension => {
        if (extension === 'html') throw new Error('Attempting to register an existing file extension "html"');
        if (extension === 'xmind') throw new Error('registration unavailable');
      });
      expect(recognition.status('HTML')).toBe('occupied');
      expect(recognition.status('htm')).toBe('registered');
      expect(recognition.status('xmind')).toBe('failed');
      expect(recognition.canOpen('xmind')).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });

  it('defaults missing fields to on and preserves independent choices on reload', () => {
    const migrated = readStoredData({ schemaVersion: 2, preferences: { lines: 'hover', recognizeHtml: false }, layouts: [] });
    expect(migrated.preferences).toMatchObject({ lines: 'hover', recognizeHtml: false, recognizeXmind: true });
    expect(readStoredData(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(readStoredData({ schemaVersion: 2, preferences: { recognizeXmind: 'false' } }).preferences.recognizeXmind).toBe(true);
  });
});
