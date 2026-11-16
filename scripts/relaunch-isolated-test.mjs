/* global app */
// Close the isolated test window through its native title bar, verify its main
// process exits, then launch only this repository's profile again.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const profile = path.resolve('test-profile'), vault = path.resolve('test-vault');
const ps = command => execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();
const processes = () => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Obsidian.exe' -and $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId,CommandLine)"));
const before = processes(), isolated = before.filter(p => p.CommandLine.toLowerCase().includes(profile.toLowerCase()));
assert.equal(isolated.length, 1, 'Exactly one isolated process must own the test profile');
const pid = isolated[0].ProcessId, ordinary = before.filter(p => p.ProcessId !== pid).map(p => p.ProcessId);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), vault.toLowerCase());
await page.locator('.titlebar-button.mod-close').click().catch(e => { if (!/closed|Target.*page/i.test(String(e))) throw e; });
await browser.close().catch(() => {});
let exited = false;
for (let i = 0; i < 60; i++) { if (!processes().some(p => p.ProcessId === pid)) { exited = true; break; } await new Promise(resolve => setTimeout(resolve, 100)); }
assert(exited, 'Native titlebar close must actually terminate the isolated main process');
if (process.argv[2] === '--close-only') {
  const remaining = processes(); ordinary.forEach(id => assert(remaining.some(p => p.ProcessId === id), `Ordinary instance ${id} must stay alive`));
  console.log(`PASS native close: isolated PID ${pid} exited; ordinary PIDs ${ordinary.join(',')} preserved.`);
  process.exit(0);
}
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/launch-test.ps1'), '-ObsidianExe', 'F:\\Software\\Obsidian\\Obsidian.exe']);
let connection;
for (let i = 0; i < 80; i++) { try { connection = await chromium.connectOverCDP('http://127.0.0.1:9223'); break; } catch { await new Promise(resolve => setTimeout(resolve, 150)); } }
assert(connection, 'Isolated CDP did not relaunch');
const next = connection.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
await next.waitForFunction(() => typeof app !== 'undefined' && app.vault && app.workspace && app.plugins.plugins['margin-link']);
assert.equal(path.resolve(await next.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), vault.toLowerCase());
const after = processes(), current = after.filter(p => p.CommandLine.toLowerCase().includes(profile.toLowerCase()));
assert.equal(current.length, 1); assert.notEqual(current[0].ProcessId, pid);
ordinary.forEach(id => assert(after.some(p => p.ProcessId === id), `Ordinary instance ${id} must stay alive`));
console.log(`PASS native close/relaunch: isolated PID ${pid} exited; new PID ${current[0].ProcessId}; ordinary PIDs ${ordinary.join(',')} preserved.`);
await connection.close();
