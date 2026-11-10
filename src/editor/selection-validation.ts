import { parseDocument, overlaps, type ParsedDocument } from '../core/wikilink-parser';
import { validateAlias } from '../core/link-formatter';
export interface SelectionSnapshot {
  sourcePath: string;
  text: string;
  from: number;
  to: number;
  selected: string;
  revision: number;
}
export function validateSelection(text: string, from: number, to: number, count = 1, document?: ParsedDocument): string | null {
  if (count !== 1) return '暂只支持一个连续选区。';
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > text.length || from >= to) return '请先选择一段普通行内文字。';
  const aliasError = validateAlias(text.slice(from, to));
  if (aliasError) return aliasError;
  const parsed = document ?? parseDocument(text);
  if (parsed.tableRanges.some(r => overlaps(r, { start: from, end: to }))) return '首版暂不支持表格内创建双链，避免别名分隔符破坏表格；请在普通段落中选择文字。';
  if (parsed.protected.some(r => overlaps(r, { start: from, end: to }))) {
    return '请选取普通行内文字；双链、嵌入、代码、属性、数学公式和其他链接内部不能创建嵌套双链。';
  }
  if (/[*_~`]/.test(text.slice(from, to))) return '选区包含 Markdown 格式标记，请只选择格式内的普通文字。';
  if (!parsed.textRanges.some(range => range.start <= from && range.end >= to)) return '选区包含块标记或跨越格式结构，请只选择普通行内文字。';
  // A selection may not cut a surrogate pair (emoji / other non-BMP characters).
  for (const at of [from, to]) {
    if (at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at])) return '选区截断了 Unicode 字符，请重新选择。';
  }
  return null;
}
export function validateSnapshot(snapshot: SelectionSnapshot, current: { sourcePath: string; text: string; revision: number; active: boolean }): string | null {
  if (!current.active || current.sourcePath !== snapshot.sourcePath) return '活动笔记或编辑器已改变，本次操作已取消。';
  if (current.revision !== snapshot.revision || current.text !== snapshot.text) return '选择文件期间笔记内容发生变化，请重新选择文字。';
  if (current.text.slice(snapshot.from, snapshot.to) !== snapshot.selected) return '原选区已失效，请重新选择。';
  return validateSelection(current.text, snapshot.from, snapshot.to);
}
