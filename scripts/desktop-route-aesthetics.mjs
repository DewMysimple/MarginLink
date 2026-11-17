/* global app */
// Real Obsidian geometry; all mutations are limited to the project test Vault.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const phase = process.argv.find(v => v.startsWith('--phase='))?.slice(8) ?? 'baseline';
assert(/^[\w-]+$/.test(phase));
const output = `artifacts/route-aesthetics/${phase}`, fixture = '详细分析/The road to Unreal Engine 6. Read about our plans and timeline.md';
const width = Number(process.argv.find(v => v.startsWith('--width='))?.slice(8) ?? 1.5);
assert(Number.isFinite(width) && width > 0 && width <= 8);
const allowContinuation = process.argv.includes('--allow-continuation');
const labels = ['UEFN','unified','Cook','incremental','programming model','transactionalizes','live experiences','pipeline','MCP','multipliers','manual'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const dataPath = process.argv.find(v => v.startsWith('--data='))?.slice(7) ?? 'test-vault/.obsidian/plugins/margin-link/data.json';
const selectedBytes = await readFile(dataPath), snapshot = JSON.parse(selectedBytes.toString('utf8'));
const selected = { schemaVersion: snapshot.schemaVersion, preferences: { ...snapshot.preferences, lineWidth: width }, layouts: snapshot.layouts.filter(record => record.source === fixture) };
assert.equal(selected.schemaVersion, 2); assert(Array.isArray(selected.layouts));
const sourcePath = `E:/Obsidian仓库/AnyTime/${fixture}`, sourceSHA256 = digest(await readFile(sourcePath));
const report = { phase, status:'running', sourceSHA256, dataPath, dataSHA256: digest(selectedBytes), lineWidth: width, allowContinuation, scenarios:[], errors:[] };
await mkdir(output,{recursive:true});
const save = () => writeFile(`${output}/results.json`,JSON.stringify(report,null,2));
let browser, page, preferences, layouts;
const frames = n => page.evaluate(n=>new Promise(resolve=>{const next=()=>--n?requestAnimationFrame(next):resolve();requestAnimationFrame(next);}),n);
const probeSource = await readFile('scripts/desktop-connectors-manual.mjs','utf8');
const match = /window\.marginConnectorProbe = id => \{([\s\S]*?)\n {4}\};/.exec(probeSource);assert(match);
const probe = `window.marginConnectorProbe = id => {${match[1]}\n};`
.replaceAll("overlay.root.querySelectorAll('[data-relation][data-end]')", "overlay.decorations.canvas.querySelectorAll('[data-relation][data-end]')")
.replaceAll('scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;',"scroller = source ? bridge.cm.scrollDOM : (view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl);")
.replaceAll('.margin-link-overlay, .cm-gap','.margin-link-overlay, .margin-link-decoration-layer, .cm-gap')
.replaceAll('Number.parseFloat(css.strokeWidth)',"CSSNumericValue.parse(css.strokeWidth).to('px').value")
.replaceAll('const collisions = [], padding = plugin.preferences.lineWidth / 2 + .15;', 'const collisions = [], padding = Math.max(plugin.preferences.lineWidth, ...parts.filter(Boolean).map(p => p.width)) / 2 + .15;')
.replaceAll('route: { complete:', 'route: { extent: start && end ? { above: Math.max(0, Math.min(start.y, end.y) - Math.min(...points.map(p => p.y))), below: Math.max(0, Math.max(...points.map(p => p.y)) - Math.max(start.y, end.y)) } : null, complete:');
try{
 browser=await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL??'http://127.0.0.1:9227',{timeout:12000});
 page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));assert(page);
 await page.waitForFunction(()=>typeof app!=='undefined'&&app.plugins?.plugins['margin-link']?.layouts&&app.workspace.layoutReady);
 assert.equal(path.resolve(await page.evaluate(()=>app.vault.adapter.getBasePath())).toLowerCase(),path.resolve('test-vault').toLowerCase(),'Refuse formal Vault');
 await page.route(/^https?:\/\//,r=>r.abort());page.on('pageerror',e=>report.errors.push(String(e)));
 preferences=await page.evaluate(()=>({...app.plugins.plugins['margin-link'].preferences}));layouts=await page.evaluate(()=>app.plugins.plugins['margin-link'].layouts.snapshot());
 report.bundleSHA256=digest(await readFile('test-vault/.obsidian/plugins/margin-link/main.js'));
 report.fixtureSHA256=digest(await readFile(`test-vault/${fixture}`));assert.equal(report.fixtureSHA256,sourceSHA256);
 report.layoutSHA256=digest(Buffer.from(JSON.stringify(selected.layouts)));report.preferences={...selected.preferences,enabled:true,lines:'always',reduceMotion:true};
 report.runtime=await page.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,version:app.plugins.plugins['margin-link'].manifest.version}));
 report.manifest=JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/manifest.json','utf8'));assert.equal(report.runtime.version,report.manifest.version,'Restart isolated Obsidian after replacing manifest');
 const cdp=await page.context().newCDPSession(page);
 const sizes=process.argv.includes('--narrow')?[[1100,838]]:[[1614,838]];
 const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7);
 for(const size of sizes) for(const mode of ['preview','source']) for(const style of ['curve','straight','elbow']){
  if(only&&!`${mode}/${style}`.includes(only))continue;
  const s={mode,style,size,passed:false};report.scenarios.push(s);
  try{
   await page.reload();await page.waitForFunction(()=>typeof app!=='undefined'&&app.plugins?.plugins['margin-link']?.layouts&&app.workspace.layoutReady);
   await cdp.send('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:false});
   await page.evaluate(probe);
   const id=await page.evaluate(async({fixture,mode,style,selected})=>{
    const p=app.plugins.plugins['margin-link'];Object.assign(p.preferences,selected.preferences,{enabled:true,lines:'always',reduceMotion:true,lineStyle:style});p.layouts.records=selected.layouts;await p.savePreferences();
    app.vault.setConfig('theme','moonstone');app.setTheme();app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();
    const leaves=app.workspace.getLeavesOfType('markdown'),leaf=leaves[0]??app.workspace.getLeaf(true);for(const other of leaves.slice(1))other.detach();
    await leaf.setViewState({type:'markdown',state:{file:fixture,mode,source:false}});app.workspace.setActiveLeaf(leaf,{focus:true});return leaf.id;
   },{fixture,mode,style,selected});await frames(15);
   await page.evaluate(async({id,labels})=>{
    await document.fonts.ready;const [v,o]=[...app.plugins.plugins['margin-link'].overlays].find(([v])=>v.leaf.id===id);
    if(v.getMode()==='source'){const at=v.editor.getValue().indexOf('### What is UE6?'),pos=v.editor.offsetToPos(at);v.editor.scrollIntoView({from:pos,to:pos},true);for(let i=0;i<6;i++)await new Promise(r=>requestAnimationFrame(r));const cm=o.bridge().cm,coords=cm.coordsAtPos(at);if(coords)cm.scrollDOM.scrollTop+=coords.top-cm.scrollDOM.getBoundingClientRect().top-80;}
    else {const scroll=v.previewMode.containerEl.querySelector('.markdown-preview-view');scroll.scrollTop=0;for(let i=0;i<50;i++){const h=[...v.contentEl.querySelectorAll('h3')].find(h=>h.textContent==='What is UE6?');if(h){scroll.scrollTop+=h.getBoundingClientRect().top-scroll.getBoundingClientRect().top-80;break;}scroll.scrollTop+=200;await new Promise(r=>requestAnimationFrame(r));}}
    const start=performance.now();let prev='',since=start;
    await new Promise((resolve,reject)=>{const tick=()=>{const cards=[...o.cards.values()].filter(c=>labels.includes(c.anchor.occurrence.label));const signature=cards.length===labels.length?cards.map(c=>{const r=c.shell.getBoundingClientRect();return[r.x,r.y,r.width,r.height,...c.anchor.fragments.flatMap(f=>[f.left,f.top,f.right,f.bottom])];}).join(':'):'';const now=performance.now();if(signature!==prev){prev=signature;since=now;}if(signature&&now-since>=250&&document.fonts.status==='loaded')resolve();else if(now-start>8000)reject(Error(`Unsettled ${cards.length}/${labels.length} selected cards`));else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
   },{id,labels});await frames(3);
   const captured=await page.evaluate(id=>window.marginConnectorProbe(id),id);
   const extras=await page.evaluate(({id,labels})=>{
    const [v,o]=[...app.plugins.plugins['margin-link'].overlays].find(([v])=>v.leaf.id===id);
    const relations=[...(o.batch?.relations??[])].filter(([,r])=>labels.includes(o.cards.get(r.key)?.anchor.occurrence.label)).map(([key,r])=>{
      const c=o.cards.get(key),parts=r.connector.segments,points=parts.flatMap(p=>[p.from,p.to,...(p.control?[p.control]:[]),...(p.control2?[p.control2]:[])]);
      const endpoints=[parts[0].from,parts.at(-1).to],top=Math.min(...endpoints.map(p=>p.y)),bottom=Math.max(...endpoints.map(p=>p.y));
      let reversals=0;for(let i=1;i<r.connector.points.length-1;i++){const a=r.connector.points[i-1],b=r.connector.points[i],d=r.connector.points[i+1];if((b.x-a.x)*(d.x-b.x)+(b.y-a.y)*(d.y-b.y)<-.01)reversals++;}
      return {key,label:c.anchor.occurrence.label,connector:r.connector,choice:r.choice,fragments:c.anchor.fragments,card:c.placement,above:Math.max(0,top-Math.min(...points.map(p=>p.y))),below:Math.max(0,Math.max(...points.map(p=>p.y))-bottom),reversals,longDiagonal:Math.max(0,...parts.filter(p=>!p.control&&Math.abs(p.to.x-p.from.x)>1&&Math.abs(p.to.y-p.from.y)>1).map(p=>Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y)))};
    });
    const body=v.getMode()==='source'?o.bridge().cm.contentDOM:v.contentEl.querySelector('.markdown-preview-sizer'),css=getComputedStyle(body);
    return {relations,routing:{body:o.layoutInput.body,viewport:o.layoutInput.viewport,obstacles:o.obstacles,measuredTop:o.measuredTop,measuredBottom:o.measuredBottom,placements:o.routePlacements},font:{family:css.fontFamily,size:css.fontSize,lineHeight:css.lineHeight},diagnostics:o.diagnostics};
   },{id,labels});
   s.snapshot={...captured,...extras};await page.mouse.move(5,5);await page.screenshot({path:`${output}/${size.join('-')}-${mode}-${style}.png`});
   const cards=captured.cards.filter(c=>labels.includes(c.label));assert.equal(cards.length,labels.length);assert(cards.every(c=>c.sourceVisible&&c.fullyVisible),'All eleven actual endpoints must be visible');
   for(const c of cards.filter(c=>c.sourceVisible&&c.fullyVisible)){if(allowContinuation && c.routeState==='continuation'){const pair=c.markers.filter(m=>m.visible);assert.equal(pair.length,2,`${c.label}: missing continuation endpoint`);assert(pair.every(m=>m.safe),`${c.label}: unsafe marker`);assert(pair[0].number&&pair[0].number===pair[1].number,`${c.label}: mismatched continuation`);continue;}assert.equal(c.routeState,'complete',`${c.label}: ${c.routeState}`);assert(c.route.complete,`${c.label}: disconnected actual SVG`);assert.deepEqual(c.route.collisions,[],`${c.label}: actual stroke intersects text/card`);assert(c.route.startError<=1&&c.route.endError<=1&&c.route.jointError<=1,`${c.label}: endpoint/seam gap`);}
   s.visible=cards.filter(c=>c.sourceVisible&&c.fullyVisible).map(c=>c.label);s.passed=true;console.log('PASS',mode,style,s.visible.length,'fully visible');
  }catch(e){Object.assign(s,{error:String(e),stack:e.stack});console.log('FAIL',mode,style,e.message);}
  await save();
 }
 report.status=report.scenarios.every(s=>s.passed)&&!report.errors.length?'passed':'failed';if(report.status==='failed')process.exitCode=1;
}catch(e){Object.assign(report,{status:'failed',error:String(e),stack:e.stack});process.exitCode=1;}
finally{if(page&&preferences)await page.evaluate(async({preferences,layouts})=>{const p=app.plugins.plugins['margin-link'];Object.assign(p.preferences,preferences);p.layouts.records=layouts;await p.savePreferences();await p.flush();},{preferences,layouts}).catch(e=>report.restoreError=String(e));report.formalSHA256After=digest(await readFile(sourcePath));report.formalUnchanged=report.formalSHA256After===sourceSHA256;await save();await browser?.close();console.log(report.status,`${output}/results.json`);}
