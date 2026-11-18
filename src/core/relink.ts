import type { WikilinkOccurrence } from '../types';
import { formatWikilink } from './link-formatter';
import { layoutIdentities } from './layout-identity';
import { parseWikilinks } from './wikilink-parser';

export function checkedOccurrence(text: string, occurrence: WikilinkOccurrence): WikilinkOccurrence {
  const current = parseWikilinks(text).find(link => link.start === occurrence.start && link.end === occurrence.end && link.raw === occurrence.raw);
  if (!current) throw new Error('原链接的位置或内容已改变，请重新右键选择要修改的卡片。');
  return current;
}

export function relinkText(occurrence: WikilinkOccurrence, path: string, subpath = ''): string {
  // Validate the new filename independently of an existing alias, whose exact
  // bytes (including an explicit empty alias) belong to the source document.
  formatWikilink(path, '关联');
  if (subpath && (!subpath.startsWith('#') || /[|[\]\\<>\r\n]/.test(subpath))) throw new Error('原子路径不能安全保留，请移除后重试。');
  const separator = occurrence.raw.indexOf('|');
  const alias = separator < 0 ? '' : occurrence.raw.slice(separator, -2);
  const link = `[[${path}${subpath}${alias}]]`;
  if (parseWikilinks(link)[0]?.raw !== link) throw new Error('无法安全生成原生双链，原文未修改。');
  return link;
}

// A single checked splice proves the correspondence of both the changed link
// and every untouched occurrence. Hashes alone never establish correspondence.
export function relinkLayoutAliases(before: string, after: string, from: number, to: number, replacement: string, edit: 'relink' | 'unlink' = 'relink'): Map<string, string> {
  if (before.slice(0, from) + replacement + before.slice(to) !== after) throw new Error('链接事务的实际结果不符，无法迁移卡片位置。');
  const oldLinks = parseWikilinks(before), newLinks = parseWikilinks(after);
  const changed = oldLinks.find(link => link.start === from && link.end === to);
  if (!changed || newLinks.length !== oldLinks.length - (edit === 'unlink' ? 1 : 0)) throw new Error('链接事务改变了其他出现位置。');
  const oldKeys = layoutIdentities(before, oldLinks), newKeys = layoutIdentities(after, newLinks);
  const byStart = new Map(newLinks.map(link => [link.start, link]));
  const delta = replacement.length - (to - from), aliases = new Map<string, string>();
  for (const link of oldLinks) {
    if (edit === 'unlink' && link === changed) continue;
    const start = link.start >= to ? link.start + delta : link.start;
    const raw = link === changed ? replacement : link.raw;
    const next = byStart.get(start);
    if (next?.raw !== raw) throw new Error('链接事务改变了其他出现位置。');
    const oldKey = oldKeys.get(link.start), newKey = newKeys.get(next.start);
    if (oldKey && newKey && oldKey !== newKey) aliases.set(newKey, oldKey);
  }
  return aliases;
}
