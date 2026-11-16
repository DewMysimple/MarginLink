import type { Preferences } from '../types';

export const ATTACHMENT_VIEW_TYPE = 'margin-link-attachment';
export const FILE_TYPES = [
  { preference: 'recognizeHtml', name: 'HTML 文件', extensions: ['html', 'htm'] },
  { preference: 'recognizeXmind', name: 'XMind 文件', extensions: ['xmind'] }
] as const;

type Status = 'registered' | 'occupied' | 'failed';

// Plugin.registerExtensions is owned by the plugin lifecycle. Snapshot the
// applied state separately from the user's saved choice for the next load.
export class FileRecognition {
  private readonly results = new Map<string, Status>();

  register(preferences: Preferences, registerExtension: (extension: string) => void): void {
    for (const { preference, extensions } of FILE_TYPES) {
      if (!preferences[preference]) continue;
      for (const extension of extensions) {
        try {
          registerExtension(extension);
          this.results.set(extension, 'registered');
        } catch (error) {
          // An occupied extension already has an Obsidian handler. An unexpected
          // failure is not proof of one, and must not affect the other formats.
          const message = error instanceof Error ? error.message : String(error);
          const occupied = /already (?:been )?registered|already (?:in use|claimed|associated)|existing (?:file )?extension/i.test(message);
          this.results.set(extension, occupied ? 'occupied' : 'failed');
          if (!occupied) console.warn(`MarginLink could not register .${extension}`, error);
        }
      }
    }
  }

  status(extension: string): Status | 'disabled' { return this.results.get(extension.toLowerCase()) ?? 'disabled'; }

  canOpen(extension: string): boolean {
    const status = this.status(extension);
    return status === 'registered' || status === 'occupied';
  }
}
