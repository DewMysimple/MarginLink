import type { SelectionMatch, SelectionSearchOptions } from '../editor/selection-search';

export interface ReviewedSelection {
  options: SelectionSearchOptions;
  excluded: ReadonlySet<number>;
  matches: readonly SelectionMatch[];
}

const pageSize = 50;

export function showSelectionReview(
  container: HTMLElement,
  find: (options: SelectionSearchOptions) => SelectionMatch[],
  applied: ReviewedSelection | undefined,
  apply: (scope: ReviewedSelection | undefined) => void,
  back: () => void
): void {
  container.createEl('p', { text: '检索当前笔记中的普通文字。可取消勾选任何额外匹配，原选区始终包含。' });
  const options = container.createDiv({ cls: 'margin-link-selection-options' });
  const checkbox = (label: string, checked: boolean) => {
    const row = options.createEl('label');
    const input = row.createEl('input', { attr: { type: 'checkbox' } });
    input.checked = checked;
    row.createEl('span', { text: label });
    return input;
  };
  const caseSensitive = checkbox('区分大小写', applied?.options.caseSensitive ?? false);
  const wholeWord = checkbox('仅匹配整词', applied?.options.wholeWord ?? true);
  const status = container.createEl('p', { attr: { role: 'status' } });
  const list = container.createDiv({ cls: 'margin-link-selection-results', attr: { role: 'group', 'aria-label': '全文匹配结果' } });
  const pagination = container.createDiv({ cls: 'margin-link-file-actions margin-link-selection-pages' });
  const previous = pagination.createEl('button', { text: '上一页', attr: { type: 'button' } });
  const pageStatus = pagination.createEl('span', { attr: { role: 'status' } });
  const next = pagination.createEl('button', { text: '下一页', attr: { type: 'button' } });
  const actions = container.createDiv({ cls: 'margin-link-file-actions' });
  const confirm = actions.createEl('button', { text: '确认链接范围', cls: 'mod-cta', attr: { type: 'button' } });
  actions.createEl('button', { text: '仅链接当前选区', attr: { type: 'button' } }).onclick = () => apply(undefined);
  actions.createEl('button', { text: '返回', attr: { type: 'button' } }).onclick = back;

  const excluded = new Set(applied?.excluded);
  let matches: SelectionMatch[] = [];
  let page = 0;
  const searchOptions = () => ({ caseSensitive: caseSensitive.checked, wholeWord: wholeWord.checked });
  const isIncluded = (match: SelectionMatch) => !excluded.has(match.from);
  const updateCount = () => status.setText(`已选 ${matches.filter(isIncluded).length} 处，共 ${matches.length} 处匹配`);
  const renderPage = () => {
    list.empty();
    list.scrollTop = 0;
    const start = page * pageSize, end = Math.min(start + pageSize, matches.length);
    for (const match of matches.slice(start, end)) {
      const row = list.createEl('label', { cls: 'margin-link-selection-match' });
      const input = row.createEl('input', { attr: { type: 'checkbox' } });
      input.checked = isIncluded(match);
      input.disabled = match.selected;
      input.onchange = () => {
        if (input.checked) excluded.delete(match.from);
        else excluded.add(match.from);
        updateCount();
      };
      const detail = row.createEl('span');
      detail.createEl('small', { text: `第 ${match.line} 行${match.selected ? ' · 原选区' : ''}` });
      const context = detail.createEl('span', { cls: 'margin-link-selection-context' });
      context.createEl('span', { text: match.before });
      context.createEl('mark', { text: match.text });
      context.createEl('span', { text: match.after });
    }
    pagination.hidden = matches.length <= pageSize;
    previous.disabled = page === 0;
    next.disabled = end === matches.length;
    pageStatus.setText(`第 ${start + 1}–${end} 处`);
  };
  const update = () => {
    try {
      matches = find(searchOptions());
      page = 0;
      updateCount();
      renderPage();
      confirm.disabled = matches.length === 0;
    } catch (error) {
      matches = [];
      list.empty();
      pagination.hidden = true;
      confirm.disabled = true;
      status.setText(error instanceof Error ? error.message : '无法检索当前笔记。');
    }
  };
  previous.onclick = () => { page--; renderPage(); };
  next.onclick = () => { page++; renderPage(); };
  caseSensitive.onchange = wholeWord.onchange = update;
  confirm.onclick = () => apply({ options: searchOptions(), excluded, matches: matches.filter(isIncluded) });
  update();
  caseSensitive.focus({ preventScroll: true });
}
