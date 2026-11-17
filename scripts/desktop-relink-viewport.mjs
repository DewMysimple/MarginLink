/* global app */
// Native right-click relink/focus/viewport regression, isolated Vault only.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const baseline = process.argv.includes("baseline"), phase = baseline ? "baseline" : "final", output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? `artifacts/relink-viewport/${phase}`;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const source = "\u8BE6\u7EC6\u5206\u6790/The road to Unreal Engine 6. Read about our plans and timeline.md", fixture = "Relink Viewport Acceptance.md", target = "Folder/Note A.md";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = await readFile(path.join("test-vault", source));
const formalStartSHA256 = hash(await readFile(path.join("E:/Obsidian\u4ED3\u5E93/AnyTime", source)));
const report = { phase, status: "running", fixtureSHA256: hash(original), formalStartSHA256, scenarios: [], errors: [] };
await mkdir(output, { recursive: true });
let browser, page, preferences, layouts, leafID;
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (count = 12) => page.evaluate((count2) => new Promise((resolve) => {
  const tick = () => --count2 ? requestAnimationFrame(tick) : resolve();
  requestAnimationFrame(tick);
}), count);
const picker = () => page.locator(".margin-link-file-picker");
const check = async (name, run) => {
  if (only && !name.includes(only)) return;
  try {
    report.scenarios.push({ name, passed: true, ...await run() });
    console.log("PASS", name);
  } catch (error) {
    report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack, evidence: error.evidence });
    console.log("FAIL", name, error.message);
  } finally {
    await page.evaluate(() => {
      window.marginDisposeRelinkTrace?.();
      app.plugins.plugins["margin-link"].selection.cancel();
    }).catch(() => {
    });
    await save();
  }
};
const reset = async (mode) => {
  leafID = await page.evaluate(async ({ fixture: fixture2, source: source2, text, mode: mode2, layouts: layouts2 }) => {
    const p = app.plugins.plugins["margin-link"];
    p.selection.cancel();
    app.setting?.close();
    for (const leaf2 of app.workspace.getLeavesOfType("margin-link-settings")) leaf2.detach();
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    Object.assign(p.preferences, { enabled: true, lines: "numbers", placementMode: "manual", cardShape: "square", cardSize: "medium", reduceMotion: true });
    p.layouts.records = layouts2.filter((record) => record.source !== fixture2).concat(layouts2.filter((record) => record.source === source2).map((record) => ({ ...record, source: fixture2 })));
    await p.savePreferences();
    const leaves = app.workspace.getLeavesOfType("markdown"), leaf = leaves[0] ?? app.workspace.getLeaf(true);
    for (const other of leaves.slice(1)) other.detach();
    let file = app.vault.getFileByPath(fixture2);
    if (file) {
      if (leaf.view.file?.path === fixture2) await leaf.view.save();
      await app.vault.modify(file, text);
    } else file = await app.vault.create(fixture2, text);
    await leaf.setViewState({ type: "markdown", state: { file: fixture2, mode: "source", source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.setValue(text);
    leaf.view.editor.setCursor({ line: 0, ch: 0 });
    await leaf.view.save();
    if (mode2 === "preview") await leaf.setViewState({ type: "markdown", state: { file: fixture2, mode: "preview", source: false } });
    return leaf.id;
  }, { fixture, source, text: original.toString("utf8"), mode, layouts });
  await frames(24);
  await page.evaluate(async ({ leafID: leafID2, mode: mode2 }) => {
    const [view, overlay] = [...app.plugins.plugins["margin-link"].overlays].find(([view2]) => view2.leaf.id === leafID2);
    if (mode2 === "source") {
      const at = view.editor.getValue().lastIndexOf("|Verse]]") + 1, pos = view.editor.offsetToPos(at);
      view.editor.scrollIntoView({ from: pos, to: pos }, true);
    } else {
      const scroll = view.previewMode.containerEl.querySelector(".markdown-preview-view") ?? view.previewMode.containerEl;
      scroll.scrollTop = scroll.scrollHeight;
      let el;
      for (let i = 0; i < 30; i++) {
        el = [...view.contentEl.querySelectorAll("a.internal-link")].find((el2) => el2.textContent === "Verse");
        if (el) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (!el) throw Error("Missing Verse reading anchor");
      scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight * 0.55;
    }
    overlay.schedule();
  }, { leafID, mode });
  await frames(24);
};
const sample = () => page.evaluate((leafID2) => window.marginRelinkProbe(leafID2), leafID);
const installProbe = () => page.evaluate(() => {
  window.marginDisposeRelinkTrace = () => {
    const state = window.marginRelinkTrace;
    if (!state) return;
    state.active = false;
    cancelAnimationFrame(state.raf);
    for (const restore of state.restores.splice(0).reverse()) restore();
  };
  window.marginRelinkProbe = (leafID2) => {
    const p = app.plugins.plugins["margin-link"], entry = [...p.overlays].find(([view2]) => view2.leaf.id === leafID2);
    if (!entry || !entry[0].file) return { missing: true };
    const [view, overlay] = entry, mode = view.getMode();
    const scroll = mode === "source" ? view.contentEl.querySelector(".cm-scroller") : view.previewMode.containerEl.querySelector(".markdown-preview-view") ?? view.previewMode.containerEl;
    let anchorTop = null;
    try {
      if (mode === "source") {
        const bridge = overlay.bridge(), a = bridge?.parsed.links.find((link) => link.label === "Verse");
        if (a) {
          const offset = a.start + a.raw.indexOf("|") + 1;
          anchorTop = bridge.cm.coordsAtPos(offset)?.top ?? null;
        }
      } else anchorTop = [...view.contentEl.querySelectorAll("a.internal-link")].find((el) => el.textContent === "Verse")?.getBoundingClientRect().top ?? null;
    } catch {
      anchorTop = null;
    }
    return { mode, scrollTop: scroll?.scrollTop ?? null, scrollHeight: scroll?.scrollHeight ?? null, clientHeight: scroll?.clientHeight ?? null, anchorTop, cursor: view.editor?.getCursor?.(), selection: view.editor?.listSelections?.(), picker: !!document.querySelector(".margin-link-file-picker"), cards: [...overlay.cards.values()].map((card) => ({ label: card.anchor.occurrence.label, raw: card.anchor.occurrence.raw, position: p.layouts.get(view.file.path, card.anchor.layoutKey), rect: card.shell.getBoundingClientRect().toJSON() })), text: view.getMode() === "source" ? view.editor.getValue() : view.data };
  };
});
const startTrace = () => page.evaluate((leafID2) => {
  window.marginDisposeRelinkTrace();
  const view = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.id === leafID2).view, state = window.marginRelinkTrace = { leafID: leafID2, frames: [], events: [], restores: [], active: true, start: performance.now() };
  const record = (event, extra = {}) => {
    const s = window.marginRelinkProbe(leafID2);
    delete s.text;
    delete s.cards;
    state.events.push({ event, t: performance.now() - state.start, ...s, ...extra });
  };
  const wrap = (object, name) => {
    const old = object?.[name];
    if (typeof old !== "function") return;
    object[name] = function(...args) {
      record(name + ":before", { args: name === "setState" ? [args[0]?.mode] : void 0 });
      const result = old.apply(this, args);
      if (result?.then) return result.then((value) => {
        record(name + ":after");
        return value;
      }, (error) => {
        record(name + ":rejected");
        throw error;
      });
      record(name + ":after");
      return result;
    };
    state.restores.push(() => object[name] = old);
  };
  wrap(view, "setState");
  wrap(view, "applyScroll");
  wrap(view.editor, "focus");
  wrap(view.editor, "transaction");
  const frame = () => {
    if (!state.active) return;
    const s = window.marginRelinkProbe(leafID2);
    delete s.text;
    delete s.cards;
    state.frames.push({ t: performance.now() - state.start, ...s });
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
  record("begin");
}, leafID);
const stopTrace = () => page.evaluate(() => {
  const state = window.marginRelinkTrace;
  window.marginDisposeRelinkTrace();
  return { frames: state.frames, events: state.events };
});
const invoke = async () => {
  const before = await sample(), card = before.cards.find((card2) => card2.label === "Verse");
  assert(card);
  assert(before.scrollTop > 500, "Bottom-of-document scenario must scroll the real container");
  await startTrace();
  await page.mouse.click(card.rect.x + card.rect.width / 2, card.rect.y + card.rect.height / 2, { button: "right" });
  await page.getByText("\u91CD\u65B0\u94FE\u63A5\u6587\u4EF6\u2026", { exact: true }).click();
  await picker().waitFor();
  const initialFocus = await page.evaluate(() => {
    const el = document.activeElement, p = app.plugins.plugins["margin-link"].selection.picker;
    let proto = Object.getPrototypeOf(p);
    while (proto && !Object.hasOwn(proto, "open")) proto = Object.getPrototypeOf(proto);
    return { tag: el?.tagName, type: el?.type, placeholder: el?.getAttribute("placeholder"), text: el?.textContent?.slice(0, 100), ariaLabel: el?.getAttribute("aria-label"), nativeOpen: proto?.open.toString() };
  });
  await page.keyboard.type(target);
  const typed = await picker().getByRole("searchbox", { name: "\u641C\u7D22\u5DF2\u6709\u6587\u4EF6" }).inputValue();
  return { before, initialFocus, directTypingValue: typed };
};
try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 1e4 });
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md/"));
  assert(page);
  page.setDefaultTimeout(15e3);
  await page.waitForFunction(() => typeof app !== "undefined" && !!app.plugins?.plugins?.["margin-link"] && app.workspace?.layoutReady);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve("test-vault").toLowerCase(), "Refuse real Vault");
  await page.route(/^https?:\/\//, (route) => route.abort());
  page.on("pageerror", (error) => report.errors.push(String(error)));
  report.host = await page.title();
  report.manifest = JSON.parse(await readFile("test-vault/.obsidian/plugins/margin-link/manifest.json", "utf8"));
  report.bundleSHA256 = hash(await readFile("test-vault/.obsidian/plugins/margin-link/main.js"));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins["margin-link"].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins["margin-link"].layouts.snapshot());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
  await installProbe();
  for (const mode of ["preview", "source"]) for (const operation of baseline ? ["success", "cancel", "missing-path"] : ["success", "keyboard-enter", "cancel", "missing-path"]) await check(`${mode}: bottom-card relink ${operation}, initial search focus and continuous native viewport`, async () => {
    await reset(mode);
    const opened = await invoke();
    if (!baseline) {
      assert.equal(opened.initialFocus.placeholder, "\u641C\u7D22\u6587\u4EF6\u540D\u6216\u8DEF\u5F84", "Search is focused as soon as picker opens");
      assert.equal(opened.directTypingValue, target, "Direct typing cannot require an extra click");
    }
    const input = picker().getByRole("searchbox", { name: "\u641C\u7D22\u5DF2\u6709\u6587\u4EF6" });
    if (operation === "success") {
      await input.fill(target);
      await picker().getByRole("button", { name: target, exact: true }).click();
      await picker().waitFor({ state: "hidden" });
    } else if (operation === "keyboard-enter") {
      await page.keyboard.press("Enter");
      await picker().waitFor({ state: "hidden" });
    } else if (operation === "cancel") {
      await page.keyboard.press("Escape");
      await picker().waitFor({ state: "hidden" });
    } else {
      await input.fill(path.resolve("test-profile/missing-relink-source.html"));
      await picker().getByText("\u6E90\u6587\u4EF6\u6216\u76EE\u6807\u76EE\u5F55\u5DF2\u4E0D\u5B58\u5728\u3002", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await picker().waitFor({ state: "hidden" });
    }
    await frames(110);
    const trace = await stopTrace(), after = await sample();
    const expected = ["success", "keyboard-enter"].includes(operation) ? opened.before.text.replace(/\[\[[^\]\n]+\|Verse\]\]/, `[[${target}|Verse]]`) : opened.before.text;
    assert.equal(after.text, expected, "Only the checked target changes; alias and surrounding source remain exact");
    const originFrames = trace.frames.filter((frame) => frame.mode === mode && frame.scrollTop !== null), maxScrollDeviation = Math.max(...originFrames.map((frame) => Math.abs(frame.scrollTop - opened.before.scrollTop))), minScroll = Math.min(...originFrames.map((frame) => frame.scrollTop)), maxAnchorDeviation = Math.max(...originFrames.filter((frame) => frame.anchorTop !== null).map((frame) => Math.abs(frame.anchorTop - opened.before.anchorTop)));
    const detail = { ...opened, after, trace, maxScrollDeviation, minScroll, maxAnchorDeviation, transientModes: trace.frames.filter((frame) => frame.mode !== mode) };
    if (!baseline) {
      try {
        assert.equal(after.mode, mode);
        assert(Math.abs(after.scrollTop - opened.before.scrollTop) <= 1, "Final native scroll position must remain unchanged");
        assert(maxScrollDeviation <= 1, "No visible rAF frame in the original mode may jump during relink");
        assert(Math.abs(after.anchorTop - opened.before.anchorTop) <= 1, "The linked visible text must retain its screen position");
        assert(maxAnchorDeviation <= 1, "The actual anchor must remain stable during original-mode frames");
      } catch (error) {
        error.evidence = detail;
        throw error;
      }
    }
    await page.screenshot({ path: `${output}/${mode}-${operation}.png` });
    return detail;
  });
  if (!baseline) {
    for (const mode of ["preview", "source"]) await check(`${mode}: picker tabs, native keyboard focus and repeated cancellation retain the document viewport`, async () => {
      await reset(mode);
      const opened = await invoke();
      assert.equal(opened.initialFocus.placeholder, "\u641C\u7D22\u6587\u4EF6\u540D\u6216\u8DEF\u5F84");
      assert.equal(opened.directTypingValue, target);
      await page.evaluate(() => {
        const state = window.marginRelinkTrace, instance = app.plugins.plugins["margin-link"].selection.picker, close = instance.close;
        instance.close = function(...args) {
          state.pickerClosedStack = new Error().stack;
          return close.apply(this, args);
        };
        state.restores.push(() => instance.close = close);
      });
      const search = picker().getByRole("searchbox", { name: "\u641C\u7D22\u5DF2\u6709\u6587\u4EF6" });
      await search.fill(path.resolve("test-profile/missing-relink-source.html"));
      // Keep the keyboard destination inside the dialog. With no result rows,
      // forward Tab exits the host WebContents and intentionally cancels on blur.
      await page.keyboard.press("Shift+Tab");
      const tabFocus = await page.evaluate(() => {
        window.marginExpectedPickerFocus = document.activeElement;
        return { tag: document.activeElement.tagName, text: document.activeElement.textContent?.slice(0, 100) };
      });
      assert.equal(tabFocus.text, "\u65B0\u5EFA\u6587\u4EF6");
      await frames(30);
      const tabState = await page.evaluate(() => ({ pickerPresent: !!document.querySelector(".margin-link-file-picker"), activeTag: document.activeElement.tagName, activeText: document.activeElement.textContent?.slice(0, 100), closedStack: window.marginRelinkTrace.pickerClosedStack }));
      if (!tabState.pickerPresent) throw Object.assign(new Error("Tab left the host dialog before tab-switch verification"), { evidence: { opened, tabFocus, tabState } });
      assert(await page.evaluate(() => document.activeElement === window.marginExpectedPickerFocus), "Async lookup must not steal focus after Tab");
      await picker().getByRole("button", { name: "\u65B0\u5EFA\u6587\u4EF6", exact: true }).click();
      const newFocus = await page.evaluate(() => ({ type: document.activeElement.type, label: document.activeElement.closest("label")?.textContent, selection: document.activeElement.selectionEnd - document.activeElement.selectionStart }));
      assert.equal(newFocus.type, "text");
      assert.equal(newFocus.label, "\u6587\u4EF6\u540D");
      await page.keyboard.type("Keyboard New File");
      assert.equal(await picker().getByLabel("\u6587\u4EF6\u540D", { exact: true }).inputValue(), "Keyboard New File");
      await picker().getByRole("button", { name: "\u5DF2\u6709\u6587\u4EF6", exact: true }).click();
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("placeholder")), "\u641C\u7D22\u6587\u4EF6\u540D\u6216\u8DEF\u5F84");
      await page.keyboard.press("Escape");
      await picker().waitFor({ state: "hidden" });
      await frames(30);
      const trace = await stopTrace(), after = await sample();
      assert.equal(after.text, opened.before.text);
      assert(Math.abs(after.scrollTop - opened.before.scrollTop) <= 1);
      for (let i = 0; i < 2; i++) {
        const again = await invoke();
        assert.equal(again.initialFocus.placeholder, "\u641C\u7D22\u6587\u4EF6\u540D\u6216\u8DEF\u5F84");
        assert.equal(again.directTypingValue, target);
        await page.keyboard.press("Escape");
        await picker().waitFor({ state: "hidden" });
        await frames(10);
        await stopTrace();
        assert.equal((await sample()).text, opened.before.text);
      }
      return { opened, tabFocus, newFocus, trace, after };
    });
    await check("source: creating a new relation through the public command focuses search immediately and Escape leaves selected text intact", async () => {
      await reset("source");
      const before = await sample();
      await page.evaluate((leafID2) => {
        const view = app.workspace.getLeafById(leafID2).view, text = view.editor.getValue(), at = text.lastIndexOf("production tools");
        if (at < 0) throw Error("Missing plain-text selection");
        view.editor.setSelection(view.editor.offsetToPos(at), view.editor.offsetToPos(at + "production".length));
        view.editor.focus();
        app.commands.executeCommandById("margin-link:link-selection");
      }, leafID);
      await picker().waitFor();
      const focus = await page.evaluate(() => ({ placeholder: document.activeElement.getAttribute("placeholder"), tag: document.activeElement.tagName }));
      assert.equal(focus.placeholder, "\u641C\u7D22\u6587\u4EF6\u540D\u6216\u8DEF\u5F84");
      await page.keyboard.type("Note A");
      assert.equal(await picker().getByRole("searchbox", { name: "\u641C\u7D22\u5DF2\u6709\u6587\u4EF6" }).inputValue(), "Note A");
      await page.keyboard.press("Escape");
      await picker().waitFor({ state: "hidden" });
      assert.equal((await sample()).text, before.text);
      return { focus };
    });
  }
  report.status = report.scenarios.every((s) => s.passed) && !report.errors.length ? "passed" : "failed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  report.stack = error.stack;
} finally {
  if (page) {
    await page.evaluate(() => {
      window.marginDisposeRelinkTrace?.();
      const p = app.plugins.plugins["margin-link"];
      p?.selection.cancel();
    }).catch(() => {
    });
    if (preferences) await page.evaluate(async ({ preferences: preferences2, layouts: layouts2 }) => {
      const p = app.plugins.plugins["margin-link"];
      Object.assign(p.preferences, preferences2);
      p.layouts.records = layouts2;
      p.refresh();
      await p.savePreferences();
    }, { preferences, layouts }).catch((error) => {
      report.restoreError = String(error);
    });
  }
  report.formalEndSHA256 = hash(await readFile(path.join("E:/Obsidian\u4ED3\u5E93/AnyTime", source)));
  report.formalUnchangedWithinRun = report.formalEndSHA256 === formalStartSHA256;
  await save();
  await browser?.close();
  console.log(`${report.status}: ${output}/results.json`);
  if (!baseline && report.status !== "passed") process.exitCode = 1;
}
