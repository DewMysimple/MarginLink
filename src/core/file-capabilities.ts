import { FileView, type App } from 'obsidian';
// Official built-in formats, verified against Obsidian's accepted-file-formats documentation.
const nativeExtensions = new Set(['md', 'canvas', 'base', 'pdf', 'avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm', '3gp', 'mkv', 'mov', 'mp4', 'ogv']);
export function canOpenInObsidian(app: App, extension: string): boolean {
  if (nativeExtensions.has(extension.toLowerCase())) return true;
  let supported = false;
  // The public API cannot enumerate unopened third-party file handlers. An already
  // open FileView can positively confirm support without touching private registries.
  app.workspace.iterateAllLeaves(leaf => {
    if (leaf.view instanceof FileView && leaf.view.canAcceptExtension(extension)) supported = true;
  });
  return supported;
}
