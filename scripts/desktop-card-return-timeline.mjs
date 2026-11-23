/* global app */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

// A prepared test Vault supplies the Markdown, peer HTML viewer and local targets.
const args = process.argv.slice(2);
const values = name => args.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
const option = (name, fallback) => values(name).at(-1) ?? fallback;
const phase = option('phase', 'baseline');
const fixture = option('fixture');
const targets = values('target');
const sectionLine = Number(option('section-line', 1));
const duration = Number(option('capture-ms', 1800));
const port = Number(option('port', 9238));
const arms = option('arms', 'card,native,unloaded').split(',');
const bundle = option('bundle');
const detailed = args.includes('--trace');
const inspectTokens = args.includes('--inspect-tokens');
const paint = args.includes('--paint');
const wheel = args.includes('--first-wheel');
const verifyHover = args.includes('--verify-hover');
const verifyParity = args.includes('--verify-parity');
assert(/^[\w-]+$/.test(phase) && fixture && targets.length && Number.isInteger(sectionLine) && sectionLine > 0);
assert(Number.isInteger(port) && port > 0 && port < 65536 && duration >= 250 && duration <= 12000);
assert(arms.every(arm => ['card', 'native', 'unloaded'].includes(arm)));
assert(!wheel || (targets.length === 1 && arms.length === 1 && arms[0] === 'card'));
assert(!verifyParity || (!wheel && arms.every(arm => arm === 'card')));
const output = path.resolve('artifacts/card-return-timeline');
const digest = value => createHash('sha256').update(value).digest('hex');
const within = (root, candidate) => {
  const rel = path.relative(root, candidate);
  return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 12000 });
const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().startsWith('app://obsidian.md/'));
assert(page, 'Expected an isolated Obsidian page');
page.setDefaultTimeout(25000);
const report = { phase, duration, arms, scenarios: [], errors: [], runtime: [] };
let verified = false;

// Find the recorded occurrence nearest the requested section, independent of layout and renderer state.
function referenceFor(text, target) {
  const links = [...text.matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)]
    .filter(match => match[1] === target)
    .map(match => ({ offset: match.index, alias: match[2], line: text.slice(0, match.index).split('\n').length }));
  assert(links.length, 'Target is absent from the fixture');
  const match = links.sort((a, b) => Math.abs(a.line - sectionLine) - Math.abs(b.line - sectionLine))[0];
  const original = text.slice(text.lastIndexOf('\n', match.offset) + 1, match.offset);
  const prefix = original.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').trim().slice(0, 80);
  return { ...match, target, prefix };
}

const armEnabled = enabled => page.evaluate(async enabled => {
  const active = !!app.plugins.plugins['margin-link'];
  if (enabled && !active) await app.plugins.enablePluginAndSave('margin-link');
  if (!enabled && active) await app.plugins.disablePluginAndSave('margin-link');
}, enabled);

// Observe both the animation-frame callback and a subsequent task. Neither sample
// alone demonstrates what was presented by the compositor.
async function installTimeline(leafId, reference) {
  await page.evaluate(({ leafId, fixture, reference, detailed, inspectTokens }) => {
    const leaf = app.workspace.getLeafById(leafId);
    const timeline = [], longTasks = [], changes = [], stages = [], restore = [], embeds = new WeakMap();
    let began = performance.now(), outbound, outboundVisible, outboundText, previousReference, wheelSample;
    let frame = 0, stopped = false, pending = new Set(), lastNativeState;
    if (detailed) {
      const plugin = app.plugins.plugins['margin-link'], patched = new WeakSet();
      const wrap = (object, key, label, after) => {
        const original = object?.[key];
        if (typeof original !== 'function') return;
        object[key] = function (...items) {
          const start = performance.now();
          try { return original.apply(this, items); }
          finally {
            const end = performance.now();
            stages.push([label, start, end - start]);
            performance.measure(`card-return:${label}`, { start, end });
            after?.();
          }
        };
        restore.push(() => { object[key] = original; });
      };
      const hook = () => {
        const overlay = plugin?.overlays.get(leaf.view);
        if (!overlay || patched.has(overlay)) return;
        patched.add(overlay);
        wrap(overlay, 'render', 'render');
        wrap(overlay, 'paintConnectors', 'paintConnectors');
        wrap(overlay, 'updateContinuations', 'continuations');
        wrap(overlay, 'sourceReady', 'sourceReady');
        wrap(overlay.textObstacles, 'read', 'textObstacles');
        wrap(overlay.stableLayout, 'update', 'stableLayout');
        wrap(overlay.bridge(), 'anchors', 'editorAnchors');
      };
      hook();
      wrap(plugin, 'sync', 'sync', hook);
    }
    const point = rect => rect && [rect.left, rect.top, rect.width, rect.height];
    const onScreen = (rect, clip) => !!rect && rect.width > 0 && rect.height > 0 &&
      rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom;
    const textRect = (element, needle, clip) => {
      const start = element.textContent.indexOf(needle);
      if (start < 0) return undefined;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0, opened = false;
      while (walker.nextNode()) {
        const node = walker.currentNode, next = offset + node.length;
        if (!opened && next > start) { range.setStart(node, start - offset); opened = true; }
        if (opened && next >= start + needle.length) {
          range.setEnd(node, start + needle.length - offset);
          return [...range.getClientRects()].find(rect => onScreen(rect, clip));
        }
        offset = next;
      }
    };
    const tokens = (overlay, matching) => {
      if (!inspectTokens || !matching || !overlay) return undefined;
      const cm = overlay.bridge()?.cm;
      if (!cm) return undefined;
      const selection = cm.state.selection.main;
      previousReference = overlay.returning?.visit.reference ?? previousReference;
      const inspect = offset => {
        if (!Number.isInteger(offset)) return undefined;
        try {
          const range = document.createRange();
          const start = cm.domAtPos(offset), end = cm.domAtPos(offset + 2);
          range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
          const info = position => {
            const node = position.node, element = node.nodeType === 1 ? node : node.parentElement;
            return { type: node.nodeType, offset: position.offset, ancestor: element?.className,
              line: element?.closest('.cm-line')?.className };
          };
          return { offset, raw: range.toString() === '[[', start: info(start), end: info(end),
            rects: [...range.getClientRects()].map(point) };
        } catch { return { offset, unavailable: true }; }
      };
      return { activeReference: overlay.returning?.visit.reference, previousReference,
        selection: [selection.from, selection.to], live: !!cm.dom.closest('.is-live-preview'),
        restore: inspect(previousReference === undefined ? undefined : Number(previousReference)),
        target: inspect(reference.offset) };
    };
    const embedding = host => {
      const element = host?.querySelector('iframe, webview');
      if (!element) return undefined;
      let state = embeds.get(element);
      if (!state) {
        state = { tag: element.tagName, eventReady: false };
        embeds.set(element, state);
        const ready = () => { state.eventReady = true; };
        for (const event of ['load', 'dom-ready', 'did-finish-load']) {
          element.addEventListener(event, ready);
          restore.push(() => element.removeEventListener(event, ready));
        }
      }
      let bodyReady = false;
      try { bodyReady = !!element.contentDocument?.body?.textContent.trim(); } catch { /* The guest can have a separate origin. */ }
      let guestReady = false;
      try { guestReady = typeof element.isLoading === 'function' && !!element.getURL() && !element.isLoading(); }
      catch { /* Electron webview methods require an attached guest. */ }
      return { tag: state.tag, ready: state.eventReady || bodyReady || guestReady, text: bodyReady };
    };
    const snapshot = (kind, time, geometry = true) => {
      const view = leaf.view, host = view?.contentEl;
      const matching = view?.file?.path === fixture && view?.getViewType() === 'markdown';
      const html = view?.file?.path === reference.target && view.getViewType() === 'html-view' ? embedding(host) : undefined;
      if (html?.ready) outboundVisible ??= performance.now();
      if (html?.text) outboundText ??= performance.now();
      const content = matching ? host?.querySelector('.cm-content') : undefined;
      const scroller = matching ? host?.querySelector('.cm-scroller') : undefined;
      const lines = content ? [...content.querySelectorAll('.cm-line')] : [];
      const candidate = lines.find(line => line.textContent.includes(reference.alias) &&
        (!reference.prefix || line.textContent.trim().startsWith(reference.prefix)));
      const overlay = matching ? app.plugins.plugins['margin-link']?.overlays.get(view) : undefined;
      const clip = geometry && scroller?.getBoundingClientRect();
      const alias = clip && candidate && textRect(candidate, reference.alias, clip);
      const raw = clip && candidate && textRect(candidate, `[[${reference.target}|`, clip);
      const visibleLines = clip ? lines.filter(line => line.textContent.trim() && onScreen(line.getBoundingClientRect(), clip)) : [];
      const rawVisible = visibleLines.filter(line => !line.classList.contains('cm-active') && textRect(line, '[[', clip)).length;
      const formattedLink = clip && visibleLines.some(line => [...line.querySelectorAll('.cm-hmd-internal-link')]
        .some(link => !link.classList.contains('cm-formatting-link') && onScreen(link.getBoundingClientRect(), clip)));
      const cardSet = [], card = overlay && [...overlay.cards.values()].find(item =>
        item.anchor.occurrence.target === reference.target && item.anchor.occurrence.start === reference.offset);
      const isVisible = button => button.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      if (clip && overlay) for (const [key, item] of overlay.cards) {
        const rect = item.button.getBoundingClientRect();
        if (onScreen(rect, clip) && isVisible(item.button)) cardSet.push([key, item.anchor.key, rect.left, rect.top]);
      }
      const cardRect = card?.button.getBoundingClientRect();
      const hit = clip && onScreen(cardRect, clip) && isVisible(card.button) && card.button.contains(document.elementFromPoint(
        (cardRect.left + cardRect.right) / 2, (cardRect.top + cardRect.bottom) / 2));
      const row = { t: time, kind, type: view?.getViewType(), note: matching, mode: matching ? view.getMode() : null,
        nativeLive: !!content?.closest('.is-live-preview'), stateSource: matching ? !!view.getState().source : null,
        nativeLines: lines.length, hasText: lines.some(line => line.textContent.trim()), visibleLines: visibleLines.length, targetLine: !!candidate,
        alias: point(alias), raw: point(raw), rawVisible, formattedLink, scrollTop: scroller ? scroller.scrollTop : null,
        confirmed: !!overlay && overlay.confirmedSource === fixture, card: hit ? point(cardRect) : null, cardSet,
        html, tokens: geometry ? tokens(overlay, matching) : undefined };
      if (geometry) timeline.push(row);
      else {
        const state = [row.type, row.note, row.nativeLive, row.stateSource, row.nativeLines, row.hasText, row.targetLine, row.confirmed].join();
        if (state !== lastNativeState) { changes.push(row); lastNativeState = state; }
      }
      return row;
    };
    const mutation = new MutationObserver(() => snapshot('mutation', performance.now(), false));
    mutation.observe(leaf.containerEl, { childList: true, subtree: true });
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => [entry.startTime, entry.duration])));
    observer.observe({ entryTypes: ['longtask'] });
    const tick = time => {
      // Keep dense observations during the first second, then sample the tail.
      if (time - began < 1200 || timeline.length === 0 || time - timeline.at(-1).t >= 28) {
        snapshot('rAF', time);
        const timer = setTimeout(() => {
          pending.delete(timer);
          if (!stopped) snapshot('post-rAF', performance.now());
        }, 0);
        pending.add(timer);
      }
      if (!stopped) frame = requestAnimationFrame(tick);
    };
    window.marginLinkReturnTimeline = {
      before: () => snapshot('before', performance.now()),
      markOutbound: () => {
        outbound = performance.now();
        performance.mark('margin-link-outbound');
      },
      htmlReady: () => !!outboundVisible,
      hasReturnedText: () => timeline.some(row => row.t >= began && row.note && row.visibleLines),
      beforeWheel: () => {
        wheelSample = snapshot('before-wheel', performance.now());
        const rect = leaf.view.contentEl.querySelector('.cm-scroller').getBoundingClientRect();
        return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
      },
      back: async () => {
        const trigger = performance.now();
        began = trigger;
        performance.mark('margin-link-return');
        app.commands.executeCommandById('app:go-back');
        await Promise.resolve();
        snapshot('microtask', performance.now());
        return trigger;
      },
      stop() {
        stopped = true; cancelAnimationFrame(frame);
        for (const timer of pending) clearTimeout(timer);
        pending = new Set(); mutation.disconnect(); observer.disconnect();
        for (const reset of restore.reverse()) reset();
        delete window.marginLinkReturnTimeline;
        return { timeline, longTasks, changes, stages, outbound, outboundVisible, outboundText, wheelSample, timeOrigin: performance.timeOrigin };
      }
    };
    frame = requestAnimationFrame(tick);
  }, { leafId, fixture, reference, detailed, inspectTokens });
}

async function startTrace(cdp, name) {
  const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream',
    categories: 'toplevel,devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack' });
  return async () => {
    await cdp.send('Tracing.end');
    const { stream } = await completed, chunks = [];
    try {
      while (true) {
        const chunk = await cdp.send('IO.read', { handle: stream });
        chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
        if (chunk.eof) break;
      }
    } finally { await cdp.send('IO.close', { handle: stream }); }
    await writeFile(path.join(output, name + '.trace.json'), Buffer.concat(chunks));
  };
}

async function startScreencast(cdp, name) {
  const directory = path.join(output, name + '-paint');
  await mkdir(directory, { recursive: true });
  const frames = [];
  const capture = event => {
    frames.push({ timestamp: event.metadata.timestamp, data: event.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  };
  cdp.on('Page.screencastFrame', capture);
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', capture);
    const rows = [];
    for (const [index, frame] of frames.entries()) {
      const name = String(index).padStart(4, '0') + '.png';
      rows.push({ name, timestamp: frame.timestamp });
      await writeFile(path.join(directory, name), Buffer.from(frame.data, 'base64'));
    }
    await writeFile(path.join(directory, 'frames.json'), JSON.stringify(rows));
  };
}

const compact = (before, raw, trigger) => {
  const observed = raw.timeline.filter(row => row.t >= trigger);
  const post = observed.filter(row => row.kind !== 'rAF');
  const first = predicate => post.find(predicate);
  const ms = row => row ? Math.round((row.t - trigger) * 10) / 10 : null;
  const formatted = first(row => row.note && row.alias && !row.raw);
  const visibleCard = first(row => row.note && row.card);
  const settled = post.findLast(row => row.note && row.targetLine);
  const firstSecond = observed.filter(row => row.t <= trigger + 1000);
  const delta = (left, right, axis) => left && right ? Math.round((left[axis] - right[axis]) * 100) / 100 : null;
  const deltaY = (left, right) => delta(left, right, 1);
  const maxY = key => {
    const seen = post.filter(row => row[key]).map(row => deltaY(row[key], before[key])).filter(delta => delta !== null);
    return seen.length ? Math.max(...seen.map(Math.abs)) : null;
  };
  const initialCards = new Map(before.cardSet.map(item => [item[0], item]));
  const matchesCards = row => initialCards.size && row.cardSet.length === initialCards.size && row.cardSet.every(([key, anchor, x, y]) => {
    const initial = initialCards.get(key);
    return initial && anchor === initial[1] && Math.abs(x - initial[2]) <= 1 && Math.abs(y - initial[3]) <= 1;
  });
  const stageMax = {};
  for (const [label, time, elapsed] of raw.stages) {
    if (time + elapsed >= trigger) stageMax[label] = Math.max(stageMax[label] ?? 0, Math.round(elapsed * 10) / 10);
  }
  const htmlView = raw.timeline.find(row => row.t >= raw.outbound && row.type === 'html-view');
  const wheelFrames = raw.wheelSample && post.filter(row => row.t > raw.wheelSample.t && row.note && row.scrollTop !== null);
  const relativeOffsets = post.filter(row => row.card && row.alias && !row.raw).map(row => row.card[1] - row.alias[1]);
  return { outbound: { htmlView: htmlView ? Math.round((htmlView.t - raw.outbound) * 10) / 10 : null,
    htmlGuestReady: raw.outboundVisible ? Math.round((raw.outboundVisible - raw.outbound) * 10) / 10 : null,
    htmlText: raw.outboundText ? Math.round((raw.outboundText - raw.outbound) * 10) / 10 : null },
    note: ms(first(row => row.note)), nativeText: ms(first(row => row.note && row.visibleLines)),
    targetAlias: ms(first(row => row.note && row.alias)), rawFirst: ms(first(row => row.note && row.raw)),
    rawLast: ms(post.findLast(row => row.note && row.raw)), rawRegionFirst: ms(first(row => row.note && row.rawVisible)),
    rawRegionLast: ms(post.findLast(row => row.note && row.rawVisible)), formatted: ms(formatted),
    formattedRegion: ms(first(row => row.note && row.formattedLink && !row.rawVisible)),
    card: ms(visibleCard), cardReady: ms(first(row => row.note && row.confirmed)),
    matchingCardSet: ms(first(matchesCards)), peakGlyphDeltaY: maxY('alias'), peakCardDeltaY: maxY('card'),
    firstFormattedGlyphDeltaY: deltaY(formatted?.alias, before.alias), firstCardDeltaY: deltaY(visibleCard?.card, before.card),
    firstCardDeltaX: delta(visibleCard?.card, before.card, 0),
    earlyCardWithRaw: post.filter(row => row.cardSet.length && row.rawVisible).length,
    relativeOffsetRange: relativeOffsets.length ? Math.round((Math.max(...relativeOffsets) - Math.min(...relativeOffsets)) * 100) / 100 : null,
    wheel: wheelFrames?.length ? { at: ms(raw.wheelSample), before: raw.wheelSample.scrollTop,
      maximum: Math.max(...wheelFrames.map(row => row.scrollTop)), final: wheelFrames.at(-1).scrollTop } : undefined,
    firstSecondFrames: firstSecond.length, longTasks: raw.longTasks.filter(([time, elapsed]) => time + elapsed >= trigger)
      .map(([time, elapsed]) => [Math.round((time - trigger) * 10) / 10, elapsed]), stageMax,
    settled: { live: settled?.nativeLive, source: settled?.stateSource, glyphDeltaY: deltaY(settled?.alias, before.alias),
      glyphDeltaX: delta(settled?.alias, before.alias, 0), cardDeltaY: deltaY(settled?.card, before.card),
      cardDeltaX: delta(settled?.card, before.card, 0), beforeCards: before.cardSet.length, afterCards: settled?.cardSet.length ?? 0,
      sameCardSet: !!settled && !!matchesCards(settled) } };
};

try {
  await page.waitForFunction(() => window.app?.workspace?.layoutReady);
  const vault = await realpath(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert(within(await realpath(path.resolve('test-vault/.v03-desktop')), vault), 'Only an isolated project test Vault is allowed');
  const source = await realpath(path.resolve(vault, fixture));
  const pluginDir = await realpath(path.resolve(vault, '.obsidian/plugins/margin-link'));
  assert(within(vault, source) && within(vault, pluginDir));
  const bytes = await readFile(source);
  const references = targets.map(target => referenceFor(bytes.toString('utf8'), target));
  for (const target of targets) assert(within(vault, await realpath(path.resolve(vault, target))));
  verified = true;
  await mkdir(output, { recursive: true });
  report.fixtureSHA256 = digest(bytes);
  page.on('pageerror', error => report.errors.push(String(error)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', event => report.runtime.push(event.exceptionDetails.text));
  const trust = page.getByRole('button', { name: /Trust author and enable plugins|信任仓库作者并启用插件/i });
  if (await trust.isVisible()) await trust.click();
  await page.waitForFunction(() => !!app.plugins.plugins['obsidian-html-plugin']);
  await armEnabled(true);
  await page.waitForFunction(() => !!app.plugins.plugins['margin-link']?.layouts);
  await page.evaluate(() => app.setting?.close());
  await page.bringToFront();
  await page.keyboard.press('Escape');
  if (bundle) {
    await armEnabled(false);
    try {
      for (const name of ['main.js', 'manifest.json', 'styles.css'])
        await copyFile(path.resolve(bundle, name), path.join(pluginDir, name));
    } finally { await armEnabled(true); }
    await page.waitForFunction(() => !!app.plugins.plugins['margin-link']?.layouts);
  }
  report.bundleSHA256 = digest(await readFile(path.join(pluginDir, 'main.js')));
  report.host = await page.evaluate(() => ({ title: document.title.split(' - ').at(-1), width: innerWidth, height: innerHeight,
    chrome: process.versions.chrome, htmlType: app.viewRegistry.getTypeByExtension('html') }));
  assert.equal(report.host.htmlType, 'html-view', 'The peer HTML viewer must own the extension');
  report.preferences = await page.evaluate(() => {
    const { enabled, mergeReferences, lines, lineStyle, cardShape, cardSize, placementMode, edgePadding } = app.plugins.plugins['margin-link'].preferences;
    return { enabled, mergeReferences, lines, lineStyle, cardShape, cardSize, placementMode, edgePadding };
  });
  if (verifyHover) assert(report.preferences.enabled && report.preferences.mergeReferences &&
    report.preferences.lines === 'hover' && report.preferences.lineStyle === 'curve' && report.preferences.cardShape === 'icon',
  'Expected the prepared hover/curve, merged icon-card preferences');

  const leafId = await page.evaluate(async ({ fixture, sectionLine }) => {
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const leaf = app.workspace.activeLeaf ?? app.workspace.getLeaf(false);
    await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode: 'source', source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await document.fonts.ready;
    const head = { line: sectionLine - 1, ch: 0 };
    leaf.view.editor.setCursor(head);
    leaf.view.editor.scrollIntoView({ from: head, to: head }, true);
    return leaf.id;
  }, { fixture, sectionLine });
  await page.waitForTimeout(500);
  for (const arm of arms) {
    await armEnabled(arm !== 'unloaded');
    for (const [index, reference] of references.entries()) {
      if (arm !== 'card') {
        await page.evaluate(({ leafId, sectionLine }) => {
          const editor = app.workspace.getLeafById(leafId).view.editor, head = { line: sectionLine - 1, ch: 0 };
          editor.setCursor(head);
          editor.scrollIntoView({ from: head, to: head }, true);
        }, { leafId, sectionLine });
        await page.waitForTimeout(300);
      }
      if (arm === 'card') await page.waitForFunction(({ leafId, reference }) => {
        const view = app.workspace.getLeafById(leafId).view, overlay = app.plugins.plugins['margin-link']?.overlays.get(view);
        return [...overlay?.cards.values() ?? []].some(item => {
          if (item.anchor.occurrence.start !== reference.offset || item.anchor.occurrence.target !== reference.target) return false;
          const rect = item.button.getBoundingClientRect();
          return rect.width && item.button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        });
      }, { leafId, reference });
      await installTimeline(leafId, reference);
      const endTrace = detailed ? await startTrace(cdp, `${phase}-${arm}-${index}`) : undefined;
      const endPaint = paint ? await startScreencast(cdp, `${phase}-${arm}-${index}`) : undefined;
      try {
        const before = await page.evaluate(() => window.marginLinkReturnTimeline.before());
        assert(before.note && before.nativeLive && before.alias && !before.raw, `The initial live-preview reference was not formatted for ${arm}/${index}`);
        await page.evaluate(() => window.marginLinkReturnTimeline.markOutbound());
        if (arm === 'card') {
          assert(before.card);
          const [x, y, width, height] = before.card;
          await page.mouse.click(x + width / 2, y + height / 2);
        } else await page.evaluate(async ({ leafId, target }) => {
          const leaf = app.workspace.getLeafById(leafId), file = app.vault.getFileByPath(target);
          await leaf.openFile(file);
        }, { leafId, target: reference.target });
        await page.waitForFunction(({ leafId, target }) => {
          const leaf = app.workspace.getLeafById(leafId);
          return app.workspace.activeLeaf === leaf && leaf.view.file?.path === target && leaf.view.getViewType() === 'html-view' && !leaf.working;
        }, { leafId, target: reference.target });
        await page.waitForFunction(() => window.marginLinkReturnTimeline.htmlReady(), undefined, { timeout: 1500 })
          .catch(error => { if (error.name !== 'TimeoutError') throw error; });
        const trigger = await page.evaluate(() => window.marginLinkReturnTimeline.back());
        if (wheel) {
          await page.waitForFunction(() => window.marginLinkReturnTimeline.hasReturnedText());
          const point = await page.evaluate(() => window.marginLinkReturnTimeline.beforeWheel());
          await page.mouse.move(point.x, point.y);
          await page.mouse.wheel(0, 180);
        }
        await page.waitForTimeout(duration);
        const raw = await page.evaluate(() => window.marginLinkReturnTimeline.stop());
        raw.trigger = trigger; raw.before = before;
        const result = { arm, targetIndex: index, line: reference.line, ...compact(before, raw, trigger) };
        report.scenarios.push(result);
        console.log(JSON.stringify(result));
        await writeFile(path.join(output, `${phase}-${arm}-${index}.json`), JSON.stringify(raw));
        assert(result.nativeText !== null, 'Native note text never became visible');
        if (arm === 'card' && !wheel) assert(result.formatted !== null && result.card !== null, 'The original reference and card did not return');
        if (wheel) assert(result.wheel?.final > result.wheel?.before + 40, 'The first wheel did not advance the viewport');
        if (verifyParity) {
          const { settled } = result;
          assert([result.firstCardDeltaX, result.firstCardDeltaY, settled.cardDeltaX, settled.cardDeltaY, settled.glyphDeltaX,
            settled.glyphDeltaY].every(value => typeof value === 'number' && Math.abs(value) <= 1), 'The first or settled geometry shifted');
          assert(settled.sameCardSet, 'The settled card set changed');
          assert.equal(result.earlyCardWithRaw, 0, 'Cards appeared while non-active Wiki markers were visible');
        }
      } finally {
        await page.evaluate(() => window.marginLinkReturnTimeline?.stop());
        await endTrace?.();
        await endPaint?.();
      }
    }
  }
  report.fixtureUnchanged = bytes.equals(await readFile(source));
  assert(report.fixtureUnchanged);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.runtime, []);
} finally {
  if (verified) {
    await armEnabled(true).catch(error => { report.restoreError = String(error); });
    await writeFile(path.join(output, `${phase}-summary.json`), JSON.stringify(report, null, 2));
  }
  await browser.close();
}
