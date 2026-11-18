import type { GroupMode, WikilinkOccurrence } from '../types';

type Target = { path: string; extension: string };
export type ActiveGrouping = Exclude<GroupMode, 'none'>;
interface Group { id: string; label: string; count: number }
export interface GroupIndex { groups: Group[]; byOccurrence: Map<string, Group> }
function category(mode: ActiveGrouping, file: Target | null): [string, string] {
  if (!file) return ['missing', '未解析目标'];
  if (mode === 'folder') {
    const end = file.path.lastIndexOf('/');
    return end < 0 ? ['root', '/'] : ['folder:' + file.path.slice(0, end), file.path.slice(0, end) + '/'];
  }
  const ext = file.extension.toLowerCase();
  let label = ext.toUpperCase() || '无扩展名';
  if (ext === 'md' || ext === 'markdown') label = 'Markdown';
  else if (ext === 'htm') label = 'HTML';
  else if (ext === 'xmind') label = 'XMind';
  else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext)) label = '图片';
  return ['type:' + label, label];
}
export function groupOccurrences(mode: ActiveGrouping, links: readonly WikilinkOccurrence[], resolve: (target: string) => Target | null): GroupIndex {
  const groups = new Map<string, Group>(), byOccurrence = new Map<string, Group>(), targets = new Map<string, Group>();
  for (const link of links) {
    let group = targets.get(link.target);
    if (!group) {
      const [id, label] = category(mode, resolve(link.target));
      group = groups.get(id) ?? { id, label, count: 0 };
      groups.set(id, group); targets.set(link.target, group);
    }
    group.count++;
    byOccurrence.set(String(link.start), group);
  }
  return { groups: [...groups.values()].sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0), byOccurrence };
}
