/* global app */
// Isolated native navigation/layout acceptance. Never run against a real Vault.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
const baseline = process.argv.includes("baseline"), phase = baseline ? "baseline" : "final", output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? `artifacts/manual-layout/${phase}`;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const fixture = "\u8BE6\u7EC6\u5206\u6790/The road to Unreal Engine 6. Read about our plans and timeline.md";
const labels = ["Early Access", "dives", "Verse", "Scene Graph", "model-assisted", "ship"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const original = hash(await readFile(path.join("E:/Obsidian\u4ED3\u5E93/AnyTime", fixture)));
const fixtureHash = hash(await readFile(path.join("test-vault", fixture)));
await mkdir(output, { recursive: true });
const report = { phase, status: "running", fixtureSHA256: fixtureHash, formalStartSHA256: original, scenarios: [], errors: [] };
let browser, page, preferences, layouts;
let currentScenario = "initialization";
let currentStep = "initialization";
const captureError = (error) => {
  report.errors.push(String(error));
  (report.errorDetails ??= []).push({ message: String(error), stack: error.stack, scenario: currentScenario, step: currentStep, url: page?.url() });
};
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (count = 10) => page.evaluate((count2) => new Promise((resolve) => {
  const tick = () => --count2 ? requestAnimationFrame(tick) : resolve();
  requestAnimationFrame(tick);
}), count);
const check = async (name, run) => {
  if (only && !name.includes(only)) return;
  currentScenario = name;
  currentStep = "begin";
  try {
    report.scenarios.push({ name, passed: true, ...await run() });
    console.log("PASS", name);
  } catch (error) {
    report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack, evidence: error.evidence });
    console.log("FAIL", name, error.message);
  }
  await save();
};
const snapshot = () => page.evaluate(({ fixture: fixture2, labels: labels2 }) => {
  const plugin = app.plugins.plugins["margin-link"], entry = [...plugin.overlays].find(([view2]) => view2.file?.path === fixture2 && view2.leaf === app.workspace.activeLeaf) ?? [...plugin.overlays].find(([view2]) => view2.file?.path === fixture2);
  if (!entry) throw Error("Missing fixture overlay");
  const [view, overlay] = entry, host = view.contentEl.getBoundingClientRect();
  return { mode: view.getMode(), geometry: { host: { left: host.left, top: host.top, width: host.width, height: host.height }, body: overlay.layoutInput?.body, viewport: overlay.layoutInput?.viewport }, prefs: { ...plugin.preferences }, records: plugin.layouts.snapshot().filter((record) => record.source === fixture2), cards: [...overlay.cards.values()].filter((card) => labels2.includes(card.anchor.occurrence.label)).map((card) => {
    const rect = card.button.getBoundingClientRect(), p = card.placement, anchorY = card.anchor.rect.bottom + 2 - host.top;
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { label: card.anchor.occurrence.label, key: card.anchor.key, layoutKey: card.anchor.layoutKey, side: p.side, x: p.x, offset: p.y + p.height / 2 - anchorY, manual: !!p.manual, shape: p.shape, hittable: !!hit && card.button.contains(hit), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, routeState: card.shell.dataset.routeState };
  }) };
}, { fixture, labels });
const differences = (a, b) => a.cards.flatMap((card) => {
  const next = b.cards.find((other) => other.label === card.label);
  return !next || card.side !== next.side || Math.abs(card.x - next.x) > 1 || Math.abs(card.offset - next.offset) > 1 ? [{ label: card.label, before: card, after: next ?? null }] : [];
});
const settle = () => page.evaluate(() => new Promise((resolve, reject) => {
  const start = performance.now();
  let last = "", same = 0;
  const tick = () => {
    const view = app.workspace.getLeavesOfType("markdown")[0]?.view, host = view?.contentEl.getBoundingClientRect(), body = view?.contentEl.querySelector(".cm-content,.markdown-preview-sizer")?.getBoundingClientRect(), value = JSON.stringify([host && [host.left, host.top, host.width, host.height], body && [body.left, body.right, body.width]]);
    same = value === last ? same + 1 : 0;
    last = value;
    if (same >= 8 && performance.now() - start >= 320) resolve();
    else if (performance.now() - start > 4e3) reject(Error("View geometry did not settle"));
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
const closeSettings = async () => {
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    app.setting?.close();
    for (const leaf of app.workspace.getLeavesOfType("margin-link-settings")) leaf.detach();
    app.workspace.rightSplit.collapse();
  });
  await settle();
};
const focusClosing = async () => {
  await page.evaluate(async (fixture2) => {
    const plugin = app.plugins.plugins["margin-link"], [view, overlay] = [...plugin.overlays].find(([view2]) => view2.file?.path === fixture2 && view2.leaf === app.workspace.activeLeaf) ?? [...plugin.overlays].find(([view2]) => view2.file?.path === fixture2);
    if (view.getMode() === "source") {
      const at = view.editor.getValue().lastIndexOf("Early Access"), pos = view.editor.offsetToPos(at);
      view.editor.scrollIntoView({ from: pos, to: pos }, true);
    } else {
      const scroll = view.previewMode.containerEl.querySelector(".markdown-preview-view") ?? view.previewMode.containerEl;
      scroll.scrollTop = scroll.scrollHeight;
      let link;
      for (let i = 0; i < 30; i++) {
        link = [...view.contentEl.querySelectorAll("a.internal-link")].find((el) => el.textContent === "Early Access");
        if (link) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (!link) throw Error("Missing closing link");
      scroll.scrollTop += link.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight * 0.5;
    }
    overlay.schedule();
  }, fixture);
  await frames(16);
};
const open = async (mode, placementMode = "free", records = []) => {
  await closeSettings();
  await page.evaluate(async ({ fixture: fixture2, mode: mode2, placementMode: placementMode2, records: records2 }) => {
    const plugin = app.plugins.plugins["margin-link"];
    Object.assign(plugin.preferences, { enabled: true, lines: "numbers", placementMode: placementMode2, layout: "balanced", cardShape: "square", cardSize: "medium", reduceMotion: true });
    plugin.layouts.records = records2;
    await plugin.savePreferences();
    const leaves = app.workspace.getLeavesOfType("markdown"), leaf = leaves[0] ?? app.workspace.getLeaf(true);
    for (const other of leaves.slice(1)) other.detach();
    await leaf.setViewState({ type: "markdown", state: { file: fixture2, mode: mode2, source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view, overlay = plugin.overlays.get(view);
    if (overlay) {
      overlay.resetLayout();
      const scroll = view.getMode() === "source" ? overlay.bridge()?.cm.scrollDOM : view.previewMode.containerEl.querySelector(".markdown-preview-view");
      if (scroll) scroll.scrollTop = 0;
    }
    plugin.refresh();
  }, { fixture, mode, placementMode, records });
  await frames(20);
  await focusClosing();
};
const navigateBack = async () => {
  const before = await snapshot(), chosen = before.cards.find((card) => card.label === "Verse" && card.hittable) ?? before.cards.find((card) => card.hittable);
  assert(chosen, "At least one real card must be hit-testable");
  await page.mouse.click(chosen.rect.x + chosen.rect.width / 2, chosen.rect.y + chosen.rect.height / 2);
  await page.waitForFunction((fixture2) => app.workspace.activeLeaf?.view.file?.path !== fixture2, fixture);
  await frames(10);
  const target = await page.evaluate(() => app.workspace.activeLeaf.view.file?.path);
  await page.evaluate(() => app.commands.executeCommandById("app:go-back"));
  await page.waitForFunction((fixture2) => app.workspace.activeLeaf?.view.file?.path === fixture2, fixture);
  await frames(20);
  await focusClosing();
  return { before, after: await snapshot(), target };
};
const reopen = async (mode) => {
  await page.evaluate(async ({ mode: mode2, fixture: fixture2 }) => {
    const leaf = app.workspace.getLeavesOfType("markdown")[0];
    await leaf.setViewState({ type: "markdown", state: { file: fixture2, mode: mode2, source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, { mode, fixture });
  await frames(20);
  await focusClosing();
};
const processList = () => JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Obsidian.exe' -and $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId,CommandLine)"], { encoding: "utf8" }));
const restart = async () => {
  const profile = path.resolve("test-profile/manual-layout-run"), before = processList(), isolated = before.filter((process2) => process2.CommandLine.toLowerCase().includes(profile.toLowerCase()));
  assert.equal(isolated.length, 1);
  const pid = isolated[0].ProcessId, ordinary = before.filter((process2) => process2.ProcessId !== pid).map((process2) => process2.ProcessId);
  await page.evaluate(async () => {
    await app.plugins.plugins["margin-link"].flush();
    await app.workspace.requestSaveLayout().run();
  });
  await page.evaluate(() => window.close()).catch(() => {
  });
  await browser.close().catch(() => {
  });
  for (let i = 0; i < 30 && processList().some((process2) => process2.ProcessId === pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert(!processList().some((process2) => process2.ProcessId === pid), "Native window close must exit actual isolated process");
  execFileSync("powershell", ["-NoProfile", "-Command", `Start-Process -FilePath 'D:\\SoftWare\\Obsidian\\Obsidian.exe' -ArgumentList @('--user-data-dir="${profile}"','--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1','--no-first-run') -WindowStyle Hidden`]);
  for (let i = 0; i < 40; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 700 });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  page = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().startsWith("app://obsidian.md/"));
  await page.waitForFunction(() => typeof app !== "undefined" && !!app.plugins?.plugins?.["margin-link"] && !!app.workspace?.leftSplit && !!app.workspace?.rightSplit && app.workspace.layoutReady);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve("test-vault").toLowerCase());
  await page.route(/^https?:\/\//, (route) => route.abort());
  page.on("pageerror", captureError);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
  await frames(20);
  const after = processList(), next = after.find((process2) => process2.CommandLine.toLowerCase().includes(profile.toLowerCase()));
  assert(next);
  assert.notEqual(next.ProcessId, pid);
  for (const id of ordinary) assert(after.some((process2) => process2.ProcessId === id));
  return { oldPID: pid, newPID: next.ProcessId, ordinary };
};
try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 1e4 });
  page = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().startsWith("app://obsidian.md/"));
  assert(page);
  page.setDefaultTimeout(15e3);
  await page.waitForFunction(() => typeof app !== "undefined" && !!app.plugins?.plugins?.["margin-link"] && !!app.workspace?.leftSplit && !!app.workspace?.rightSplit && app.workspace.layoutReady);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve("test-vault").toLowerCase(), "Refuse real Vault");
  page.on("pageerror", captureError);
  await page.route(/^https?:\/\//, (route) => route.abort());
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins["margin-link"].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins["margin-link"].layouts.snapshot());
  report.host = await page.title();
  report.manifest = JSON.parse(await readFile("test-vault/.obsidian/plugins/margin-link/manifest.json", "utf8"));
  report.bundleSHA256 = hash(await readFile("test-vault/.obsidian/plugins/margin-link/main.js"));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
  });
  for (const mode of ["preview", "source"]) {
    await check(`${mode}/free: actual card click and native history back with no preexisting positions`, async () => {
      await open(mode);
      const result = await navigateBack(), changed = differences(result.before, result.after);
      if (!baseline) assert.deepEqual(changed, [], "Free placements must survive navigation");
      await page.screenshot({ path: `${output}/${mode}-free-return.png` });
      return { ...result, changed };
    });
    await check(`${mode}/free: one saved card cannot destabilize untouched neighbours on return`, async () => {
      await open(mode);
      const initial = await snapshot(), card = initial.cards.find((card2) => card2.label === "Verse");
      assert(card.layoutKey);
      const records = [{ source: fixture, key: card.layoutKey, side: "left", xNormalized: 0.3, yOffset: -2, updated: Date.now() }];
      await open(mode, "free", records);
      const result = await navigateBack(), changed = differences(result.before, result.after);
      if (!baseline) assert.deepEqual(changed, []);
      return { ...result, changed };
    });
  }
  if (!baseline) {
    for (const mode of ["preview", "source"]) {
      await check(`${mode}/manual: no-record initial slots survive click/back and ignore left/right auto preference`, async () => {
        await open(mode, "manual");
        const result = await navigateBack();
        assert.deepEqual(differences(result.before, result.after), []);
        assert(result.before.records.length >= 6);
        const initial = await snapshot();
        for (const layout of ["left", "right", "balanced"]) {
          await page.evaluate(async (layout2) => {
            const p = app.plugins.plugins["margin-link"];
            p.preferences.layout = layout2;
            await p.savePreferences();
          }, layout);
          await frames();
          assert.deepEqual(differences(initial, await snapshot()), []);
        }
        return result;
      });
      await check(`${mode}/manual: explicit overlap and off-grid drag moves only the selected card`, async () => {
        await open(mode, "manual", layouts);
        const before = await snapshot(), moved = before.cards.find((card) => card.label === "Verse"), target = before.cards.find((card) => card.label === "Scene Graph");
        assert(moved && target);
        await page.mouse.move(moved.rect.x + moved.rect.width / 2, moved.rect.y + moved.rect.height / 2);
        await page.mouse.down();
        const dx = target.side === "left" ? -7 : 7;
        await page.mouse.move(target.rect.x + target.rect.width / 2 + dx, target.rect.y + target.rect.height / 2 + 5, { steps: 12 });
        await page.mouse.up();
        await frames();
        const after = await snapshot(), dragged = after.cards.find((card) => card.key === moved.key);
        assert.equal(dragged.side, target.side);
        assert(Math.abs(dragged.rect.x - target.rect.x - dx) <= 1);
        assert(Math.abs(dragged.rect.y - target.rect.y - 5) <= 1);
        assert.deepEqual(differences({ cards: before.cards.filter((card) => card.key !== moved.key) }, after), []);
        const result = await navigateBack();
        assert.deepEqual(differences(result.before, result.after), []);
        return { before, after, returned: result.after };
      });
    }
    await check("manual: every settings entry exposes the mode and disables irrelevant automatic/snap controls", async () => {
      await open("preview", "free", layouts);
      const before = await snapshot();
      await page.evaluate(() => app.plugins.plugins["margin-link"].openSettingsPanel());
      await frames();
      const panel = page.locator(".margin-link-settings-view");
      const select = panel.locator('[data-margin-key="placementMode"] select:not(.is-measuring)');
      const options = await select.locator("option").evaluateAll((options2) => Object.fromEntries(options2.map((option) => [option.value, option.textContent])));
      assert.equal(options.manual, "\u5B8C\u5168\u624B\u52A8");
      await select.selectOption("manual");
      await frames();
      assert(await panel.locator('[data-margin-key="layout"] select:not(.is-measuring)').isDisabled());
      assert(await panel.locator('[data-margin-key="snapGrid"] input[type=range]').isDisabled());
      await panel.locator('[data-margin-key="placementMode"]').evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
      await frames(70);
      await page.screenshot({ path: `${output}/manual-settings.png` });
      await closeSettings();
      const after = await snapshot();
      assert.deepEqual(differences(before, after), [], "Entering manual must freeze the visible layout");
      currentStep = "native-settings-open";
      await page.evaluate(() => {
        app.setting.open();
        app.setting.openTabById("margin-link");
      });
      await page.waitForFunction(() => !!app.setting.activeTab?.containerEl.querySelector('[data-margin-key="placementMode"] select:not(.is-measuring)'));
      currentStep = "native-settings-layout-ready";
      await page.evaluate(() => new Promise((resolve) => {
        const root = app.setting.activeTab.containerEl, win = root.ownerDocument.defaultView, row = root.querySelector('[data-margin-key="placementMode"]');
        row.scrollIntoView({ block: "center", behavior: "instant" });
        const start = win.performance.now();
        let last = "", same = 0;
        const tick = () => {
          const rect = row.getBoundingClientRect(), value = [rect.left, rect.top, rect.width, rect.height].join(":");
          same = value === last ? same + 1 : 0;
          last = value;
          if (same >= 4 && win.performance.now() - start >= 320) resolve();
          else win.requestAnimationFrame(tick);
        };
        win.requestAnimationFrame(tick);
      }));
      currentStep = "native-settings-read-fields";
      const native = await page.evaluate(() => {
        const root = app.setting.activeTab.containerEl, select2 = root.querySelector('[data-margin-key="placementMode"] select:not(.is-measuring)');
        window.marginNativeSettingsWindow = root.ownerDocument.defaultView;
        return { options: Object.fromEntries([...select2.options].map((option) => [option.value, option.textContent])), value: select2.value, disabledLayout: root.querySelector('[data-margin-key="layout"] select:not(.is-measuring)').disabled, disabledSnap: root.querySelector('[data-margin-key="snapGrid"] input[type=range]').disabled, differentDocument: root.ownerDocument !== document, listenerCountAtOpen: app.plugins.plugins["margin-link"].listeners.size };
      });
      assert.deepEqual(native.options, options);
      assert.equal(native.value, "manual");
      assert(native.disabledLayout && native.disabledSnap);
      currentStep = "native-settings-close";
      await page.evaluate(() => app.setting.close());
      // Native settings have a separate window. close() returns before that
      // document is destroyed; wait for ownership to return before another modal.
      await page.waitForFunction(() => window.marginNativeSettingsWindow === window || window.marginNativeSettingsWindow.closed && document.hasFocus());
      native.lifecycleAfter = await page.evaluate(() => ({ closed: window.marginNativeSettingsWindow.closed, focused: document.hasFocus(), listenerCount: app.plugins.plugins["margin-link"].listeners.size }));
      currentStep = "quick-controls-open";
      await page.evaluate(() => app.commands.executeCommandById("margin-link:quick-controls"));
      await frames();
      const quick = page.locator(".margin-link-quick-controls .setting-item").filter({ has: page.getByText("\u5E03\u5C40\u6A21\u5F0F", { exact: true }) }).locator("select:not(.is-measuring)");
      assert.deepEqual(await quick.locator("option").evaluateAll((options2) => Object.fromEntries(options2.map((option) => [option.value, option.textContent]))), options);
      assert.equal(await quick.inputValue(), "manual");
      currentStep = "quick-controls-select-snap";
      await quick.selectOption("snap");
      await frames();
      currentStep = "quick-controls-select-manual";
      await quick.selectOption("manual");
      await frames();
      currentStep = "quick-controls-close";
      await closeSettings();
      assert.equal((await snapshot()).prefs.placementMode, "manual");
      return { options, native, before, after };
    });
    await check("manual: restore appearance defaults preserves mode and existing positions", async () => {
      await open("source", "manual", layouts);
      const before = await snapshot();
      await page.evaluate(() => app.plugins.plugins["margin-link"].openSettingsPanel());
      await frames();
      await page.locator(".margin-link-settings-view").getByRole("button", { name: "\u6062\u590D\u9ED8\u8BA4", exact: true }).click();
      await page.locator(".margin-link-confirm").getByRole("button", { name: "\u786E\u8BA4", exact: true }).click();
      await frames();
      await closeSettings();
      const after = await snapshot();
      assert.equal(after.prefs.placementMode, "manual");
      assert.deepEqual(after.records, before.records);
      assert.deepEqual(differences(before, after), []);
      return { before, after };
    });
    await check("manual: resize, scrolling and plugin reload preserve saved layout", async () => {
      await open("source", "manual", layouts);
      const before = await snapshot();
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
      await frames(15);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
      await frames(15);
      await focusClosing();
      assert.deepEqual(differences(before, await snapshot()), []);
      await page.evaluate(async () => {
        const p = app.plugins.plugins["margin-link"];
        await p.flush();
        await app.plugins.disablePlugin("margin-link");
        await app.plugins.enablePlugin("margin-link");
      });
      await frames(20);
      await reopen("source");
      const after = await snapshot();
      assert.equal(after.prefs.placementMode, "manual");
      assert.deepEqual(differences(before, after), []);
      return { before, after };
    });
    await check("manual: Ctrl-click opens another tab without changing the source card positions", async () => {
      await open("source", "manual", layouts);
      const before = await snapshot(), card = before.cards.find((card2) => card2.label === "Verse"), leafID = await page.evaluate(() => app.workspace.activeLeaf.id);
      await page.keyboard.down("Control");
      await page.mouse.click(card.rect.x + card.rect.width / 2, card.rect.y + card.rect.height / 2);
      await page.keyboard.up("Control");
      await page.waitForFunction((id) => app.workspace.activeLeaf.id !== id, leafID);
      const target = await page.evaluate(() => app.workspace.activeLeaf.view.file?.path);
      await page.evaluate((id) => app.workspace.setActiveLeaf(app.workspace.getLeafById(id), { focus: true }), leafID);
      await frames(15);
      const after = await snapshot();
      assert.deepEqual(differences(before, after), []);
      return { before, after, target };
    });
    await check("manual: explicit current-note reset keeps the selected mode and does not modify another note positions", async () => {
      await open("preview", "manual", layouts);
      const unrelatedBefore = await page.evaluate((fixture2) => app.plugins.plugins["margin-link"].layouts.snapshot().filter((record) => record.source !== fixture2), fixture);
      await page.evaluate((fixture2) => app.plugins.plugins["margin-link"].confirmReset(fixture2), fixture);
      await page.locator(".margin-link-confirm").getByRole("button", { name: "\u786E\u8BA4", exact: true }).click();
      await frames(20);
      const after = await snapshot();
      assert.equal(after.prefs.placementMode, "manual");
      assert(after.records.length >= 6);
      assert.deepEqual(await page.evaluate((fixture2) => app.plugins.plugins["margin-link"].layouts.snapshot().filter((record) => record.source !== fixture2), fixture), unrelatedBefore);
      return { after };
    });
    await check("manual: two simultaneous views freeze the recently active visible layout and preserve all measured keys", async () => {
      await open("source", "auto", []);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 2400, height: 900, deviceScaleFactor: 1, mobile: false });
      await frames(20);
      await page.evaluate(async (fixture2) => {
        const first = app.workspace.getLeavesOfType("markdown")[0], scroll = first.view.editor?.cm?.scrollDOM;
        if (scroll) scroll.scrollTop = 0;
        const second = app.workspace.createLeafBySplit(first, "vertical");
        await second.setViewState({ type: "markdown", state: { file: fixture2, mode: "preview", source: false } });
        app.workspace.setActiveLeaf(second, { focus: true });
      }, fixture);
      await settle();
      await focusClosing();
      const before = await snapshot(), expectedKeys = await page.evaluate((fixture2) => [...new Set([...app.plugins.plugins["margin-link"].overlays].filter(([view]) => view.file?.path === fixture2).flatMap(([, overlay]) => [...overlay.cards.values()].map((card) => card.anchor.layoutKey).filter(Boolean)))], fixture);
      await page.evaluate(() => app.plugins.plugins["margin-link"].setPlacementMode("manual"));
      await frames(20);
      const after = await snapshot();
      assert.deepEqual(differences(before, after), []);
      assert(expectedKeys.every((key) => after.records.some((record) => record.key === key)));
      assert.equal(new Set(after.records.map((record) => record.key)).size, after.records.length);
      await page.evaluate(() => {
        const active = app.workspace.activeLeaf;
        for (const leaf of app.workspace.getLeavesOfType("markdown")) if (leaf !== active) leaf.detach();
      });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
      await settle();
      return { before, after, expectedKeys };
    });
    await check("manual: actual native process restart retains layout and persisted selection", async () => {
      await open("source", "manual", layouts);
      const before = await snapshot(), processes = await restart();
      await reopen("source");
      const after = await snapshot();
      assert.equal(after.prefs.placementMode, "manual");
      assert.deepEqual(differences(before, after), []);
      assert.deepEqual(after.records, before.records);
      return { before, after, processes };
    });
    await check("auto: automatic mode remains available and does not persist generated positions", async () => {
      await open("preview", "auto");
      const result = await snapshot();
      assert.equal(result.records.length, 0);
      return result;
    });
  }
  report.status = report.scenarios.every((s) => s.passed) && !report.errors.length ? "passed" : "failed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  report.stack = error.stack;
} finally {
  if (page) {
    await closeSettings().catch(() => {
    });
    await page.evaluate(async ({ preferences: preferences2, layouts: layouts2 }) => {
      const plugin = app.plugins.plugins["margin-link"];
      if (preferences2) Object.assign(plugin.preferences, preferences2);
      if (layouts2) plugin.layouts.records = layouts2;
      plugin.refresh();
      await plugin.savePreferences();
    }, { preferences, layouts }).catch((error) => {
      report.restoreError = String(error);
    });
  }
  report.finalFormalSHA256 = hash(await readFile(path.join("E:/Obsidian\u4ED3\u5E93/AnyTime", fixture)));
  assert.equal(report.finalFormalSHA256, original);
  await save();
  await browser?.close();
  console.log(`${report.status}: ${output}/results.json`);
  if (!baseline && report.status !== "passed") process.exitCode = 1;
}
