export function validateAlias(alias: string): string | null {
  if (!alias.trim()) return '请先选择一段文字。';
  if (/[\r\n]/.test(alias)) return '暂不支持跨硬换行的选区。';
  if (/[|[\]\\<>]/.test(alias) || [...alias].some(c => c.charCodeAt(0) < 32)) return '选区含有不能安全写入双链别名的字符（如 |、方括号或反斜杠）。';
  return null;
}
export function formatWikilink(path: string, alias: string): string {
  const error = validateAlias(alias);
  if (error) throw new Error(error);
  if (!path || path.trim() !== path || /[#^|[\]\\<>]/.test(path) || [...path].some(c => c.charCodeAt(0) < 32)) {
    throw new Error('目标路径含有不能安全表示为原生双链的字符；未修改笔记。');
  }
  return `[[${path}|${alias}]]`;
}
