import { beforeEach, describe, expect, it, vi } from 'vitest';
import type MarginLinkPlugin from '../src/main';
import { DEFAULT_PREFERENCES, PLACEMENT_MODE_OPTIONS, type PlacementMode } from '../src/types';
import { renderSettings } from '../src/ui/settings-tab';
import { QuickControls } from '../src/ui/quick-controls';

class ElementStub {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = { add() {}, toggle() {} };
  ownerDocument = { createElementNS: () => new ElementStub() };
  namespaceURI = 'http://www.w3.org/2000/svg';
  offsetLeft = 0; offsetTop = 0; offsetWidth = 20; offsetHeight = 16;
  children: ElementStub[] = [];
  createEl() { const child = new ElementStub(); this.children.push(child); return child; }
  createDiv() { return this.createEl(); }
  createSpan() { return this.createEl(); }
  appendChild(child: ElementStub) { this.children.push(child); }
  prepend(child: ElementStub) { this.children.unshift(child); }
  addClass() {}
  setAttribute() {}
  empty() { this.children = []; }
}
class ControlStub {
  options: Record<string, string> = {};
  value: unknown;
  disabled = false;
  text = '';
  change?: (value: unknown) => void;
  click?: () => void;
  setValue(value: unknown) { this.value = value; return this; }
  addOptions(options: Record<string, string>) { this.options = { ...options }; return this; }
  setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
  setLimits() { return this; }
  setDynamicTooltip() { return this; }
  setButtonText(text: string) { this.text = text; return this; }
  setCta() { return this; }
  onChange(callback: (value: unknown) => void) { this.change = callback; return this; }
  onClick(callback: () => void) { this.click = callback; return this; }
}
interface Row { name: string; description: string; settingEl: ElementStub; controls: ControlStub[] }
const state = vi.hoisted(() => ({ rows: [] as Row[] }));
vi.mock('obsidian', () => ({
  PluginSettingTab: class {},
  Modal: class {
    contentEl = new ElementStub();
    setTitle() {}
    open() { (this as unknown as { onOpen(): void }).onOpen(); }
    close() { (this as unknown as { onClose(): void }).onClose(); }
  },
  Setting: class implements Row {
    name = ''; description = ''; settingEl = new ElementStub(); controls: ControlStub[] = [];
    constructor() { state.rows.push(this); }
    setName(name: string) { this.name = name; return this; }
    setDesc(description: string) { this.description = description; return this; }
    addDropdown(callback: (control: ControlStub) => void) { return this.add(callback); }
    addToggle(callback: (control: ControlStub) => void) { return this.add(callback); }
    addSlider(callback: (control: ControlStub) => void) { return this.add(callback); }
    addButton(callback: (control: ControlStub) => void) { return this.add(callback); }
    private add(callback: (control: ControlStub) => void) { const control = new ControlStub(); this.controls.push(control); callback(control); return this; }
  },
  setIcon() {}
}));
vi.mock('../src/ui/file-type-settings', () => ({ renderFileTypeSettings: () => () => {} }));
vi.mock('../src/ui/new-note-folders', () => ({ renderFolderSettings: () => () => {} }));
vi.mock('../src/view/appearance', () => ({ applyAppearance() {} }));
vi.mock('../src/view/connector-renderer', () => ({ connectorRoute: () => undefined }));
vi.mock('../src/view/layout-engine', () => ({ dimensions: () => ({ width: 84, height: 84, shape: 'square' }) }));

function fixture(placementMode: PlacementMode = 'manual') {
  const listeners = new Set<() => void>();
  const plugin = {
    app: {}, dialogs: new Set(),
    preferences: { ...DEFAULT_PREFERENCES, lines: 'none', placementMode, layout: 'right', snapGrid: 24, cardRadius: 18,
      recognizeHtml: false, newNoteFolders: ['Notes', '', ''], newNoteDefault: 0 },
    subscribe: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); },
    activeSource: () => 'A.md', confirmReset: vi.fn(), openSettingsPanel: vi.fn(),
    savePreferences: vi.fn(async () => { for (const callback of listeners) callback(); }),
    setPlacementMode: vi.fn(async (mode: PlacementMode) => { plugin.preferences.placementMode = mode; await plugin.savePreferences(); })
  };
  const host = plugin as unknown as MarginLinkPlugin;
  const render = () => renderSettings(new ElementStub() as unknown as HTMLElement, host);
  const row = (key: string) => state.rows.find(row => row.settingEl.dataset.marginKey === key)!;
  const named = (name: string) => state.rows.find(row => row.name === name)!;
  return { plugin, host, render, row, named, listeners };
}
beforeEach(() => { state.rows.length = 0; });

describe('complete manual settings semantics', () => {
  it('uses one placement selector and action across the full panel and quick controls', async () => {
    const f = fixture('free'), dispose = f.render();
    const full = f.row('placementMode').controls[0];
    expect(full.options).toEqual(PLACEMENT_MODE_OPTIONS);
    await full.change!('manual');
    expect(f.plugin.setPlacementMode).toHaveBeenLastCalledWith('manual');
    expect(full.value).toBe('manual');
    const quick = new QuickControls(f.plugin.app as never, f.host); quick.onOpen();
    const compact = f.named('布局模式').controls[0];
    expect(compact.options).toEqual(full.options);
    await compact.change!('snap');
    expect(f.plugin.setPlacementMode).toHaveBeenLastCalledWith('snap');
    expect(full.value).toBe('snap'); expect(compact.value).toBe('snap');
    quick.onClose(); dispose(); expect(f.listeners.size).toBe(0);
  });

  it('disables balance in manual mode and enables the grid only for snap without discarding values', async () => {
    const f = fixture(); f.render();
    const balance = f.row('layout').controls[0], grid = f.row('snapGrid').controls[0];
    expect(balance.disabled).toBe(true); expect(grid.disabled).toBe(true);
    expect(balance.value).toBe('right'); expect(grid.value).toBe(24);
    await f.row('placementMode').controls[0].change!('snap');
    expect(balance.disabled).toBe(false); expect(grid.disabled).toBe(false);
    await f.row('placementMode').controls[0].change!('free');
    expect(balance.disabled).toBe(false); expect(grid.disabled).toBe(true);
    expect(f.plugin.preferences).toMatchObject({ layout: 'right', snapGrid: 24 });
  });

  it('keeps complete manual mode and layout settings when restoring appearance', async () => {
    const f = fixture(); f.render();
    f.named('恢复默认外观设置').controls[0].click!();
    f.named('').controls.find(control => control.text === '确认')!.click!();
    await Promise.resolve();
    expect(f.plugin.preferences).toMatchObject({ placementMode: 'manual', layout: 'right', snapGrid: 24, cardRadius: 8,
      recognizeHtml: false, newNoteFolders: ['Notes', '', ''] });
    expect(f.plugin.setPlacementMode).not.toHaveBeenCalled();
  });

  it('describes resetting positions without switching the selected layout mode', () => {
    const f = fixture(); f.render();
    const reset = f.named('重置当前笔记卡片位置');
    expect(reset.description).toContain('继续保持完全手动');
    reset.controls[0].click!();
    expect(f.plugin.confirmReset).toHaveBeenCalledExactlyOnceWith('A.md');
    expect(f.plugin.preferences.placementMode).toBe('manual');
    expect(f.named('清除所有卡片位置').description).toContain('保留布局模式');
  });
});
