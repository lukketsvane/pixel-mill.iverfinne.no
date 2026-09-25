// PIXEL_MILL_BROWSER=1 node --test tests/sprite-browser.test.mjs
import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {agentFetch} from '../worker/api.mjs';
import {encodePNG,decodePNG} from '../dist/png.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
class Bucket{
 constructor(){this.items=new Map();this.version=0}
 async get(key){const i=this.items.get(key);return i?{etag:i.etag,json:async()=>JSON.parse(i.text)}:null}
 async put(key,text,{onlyIf}={}){const old=this.items.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.items.set(key,{etag,text});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.items.delete(key)}
}
async function harness(){
 const require=createRequire(import.meta.url);let chromium;
 try{({chromium}=require('playwright'))}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')))}
 const env={BUCKET:new Bucket()},server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp/')){const parts=[];for await(const part of req)parts.push(part);const response=await agentFetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(parts)})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return}
  const filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!filename.startsWith(root))throw Error('Invalid path');res.setHeader('content-type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');res.end(await fs.readFile(filename));
 }catch(error){res.statusCode=500;res.end(error.message)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']})}catch(error){server.close();throw error}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,acceptDownloads:true});
 await context.addInitScript(()=>{window.pixelMillTools=new Map();Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool:tool=>window.pixelMillTools.set(tool.name,tool)}})});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.pixelMillTools.has('group_sprite_sheet')&&!document.querySelector('#app').inert);
 assert.ok((await page.locator('body').innerText()).length>0);assert.equal(await page.locator('[data-nextjs-dialog],.vite-error-overlay').count(),0);
 return{page,errors,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve))}};
}
const tool=(page,name,args={})=>page.evaluate(async({name,args})=>{const out=await window.pixelMillTools.get(name).execute(args);return out.structuredContent||out},{name,args});
async function downloadBytes(page,action){const pending=page.waitForEvent('download');await action();const download=await pending,stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);return Buffer.concat(parts)}
async function project(page){return JSON.parse((await downloadBytes(page,()=>page.evaluate(()=>document.querySelector('#save').click()))).toString())}
async function sheet(page,assetId){return(await tool(page,'inspect_sprite_sheet',{assetId,includeFrames:true})).spriteSheet}
function entries(buffer){const files=new Map();let p=0;while(buffer.readUInt32LE(p)===0x04034b50){const size=buffer.readUInt32LE(p+18),n=buffer.readUInt16LE(p+26),extra=buffer.readUInt16LE(p+28),name=buffer.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;files.set(name,buffer.subarray(start,start+size));p=start+size}return files}
async function waitGroups(page,n){await page.waitForFunction(n=>document.querySelectorAll('.sprite-group').length===n,n)}

test('browser: one character sheet retains source, editable row/frame hierarchy, exports and undo',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:120000},async()=>{
 const h=await harness(),{page}=h;
 try{
  const pixels=new Uint8Array(128*128*4);for(let row=0;row<8;row++)for(let col=0;col<8;col++){if(row===7&&col===7)continue;for(let y=3;y<13;y++)for(let x=3;x<13;x++)pixels.set([40+row*20,40+col*20,120,255],((row*16+y)*128+col*16+x)*4)}
  const original=await encodePNG({w:128,h:128,pixels});
  await page.locator('#import-button').click();assert.equal(await page.locator('#import-cell-size').count(),0);assert.equal(await page.locator('#import-kind').inputValue(),'sheet');
  await page.locator('#files').setInputFiles({name:'character-eight-rows.png',mimeType:'image/png',buffer:Buffer.from(original)});
  await waitGroups(page,8);assert.equal(await page.locator('#assets-tab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.sprite-grid-form').count(),0,'a clear 8×8 sheet groups immediately without a setup screen');
  assert.equal(await page.locator('.sprite-frame').count(),0,'the parent shows animation groups, not 64 loose frames');
  const before=await project(page);assert.equal(before.assets.length,1);const assetId=before.assets[0].id,source=before.assets[0].src;
  let meta=await sheet(page,assetId);assert.equal(meta.frames.length,64);assert.equal(meta.cellWidth,16);assert.equal(meta.cellHeight,16);assert.equal(meta.rows,8);assert.equal(meta.cols,8);assert.equal(meta.grouping,'row');assert.deepEqual(meta.groups.map(g=>g.frameIds.length),Array(8).fill(8));assert.equal(meta.frames.at(-1).empty,true);
  assert.equal((await project(page)).assets.length,1,'frames are source rectangles, not loose assets');
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-sprite-groups-mobile.png')});

  await page.getByRole('button',{name:'Open row-01 frames',exact:true}).click();assert.equal(await page.locator('.sprite-frame').count(),8);
  const fps=page.getByRole('spinbutton',{name:'row-01 frames per second',exact:true});await fps.fill('12');await fps.press('Tab');await page.getByRole('checkbox',{name:'row-01 loop animation',exact:true}).uncheck();
  await page.getByRole('button',{name:'Play row-01',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-animation-group="row-01"]')?.dataset.frameId==='frame-0-7'&&document.querySelector('[data-play-group="row-01"]')?.getAttribute('aria-pressed')==='false');
  meta=await sheet(page,assetId);assert.equal(meta.groups[0].fps,12);assert.equal(meta.groups[0].loop,false);assert.deepEqual(meta.groups[0].origin,{x:0,y:0});
  const previewPixels=await page.locator('[data-animation-group="row-01"]').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
  const expected=new Uint8Array(16*16*4);for(let y=0;y<16;y++)expected.set(pixels.subarray((y*128+112)*4,(y*128+128)*4),y*16*4);assert.deepEqual(previewPixels,[...expected],'animation previews retain the exact shared cell origin');
  await page.getByRole('button',{name:'Use current sprite selection as reference',exact:true}).click();let reference=(await project(page)).assets[0];assert.deepEqual(reference.referenceSelection,{groupIds:['row-01']});assert.equal(reference.selectedForGeneration,true);
  const format=page.getByRole('combobox',{name:'Sprite export format',exact:true}),exportButton=page.getByRole('button',{name:'Export sprite sheet artwork',exact:true});
  await format.selectOption('strips');const animationExport=entries(await downloadBytes(page,()=>exportButton.click()));assert.equal([...animationExport.keys()].filter(name=>name.startsWith('strips/')).length,1);const animationManifest=JSON.parse(animationExport.get('sprite-sheet.json'));assert.equal(animationManifest.spriteSheet.groups[0].fps,12);assert.equal(animationManifest.spriteSheet.groups[0].loop,false);assert.deepEqual(animationManifest.selection,{groupIds:['row-01']});
  await page.locator('[data-frame="frame-0-1"]').click();await page.getByRole('button',{name:'Use current sprite selection as reference',exact:true}).click();reference=(await project(page)).assets[0];assert.deepEqual(reference.referenceSelection,{frameIds:['frame-0-1']});
  await format.selectOption('sheet');const oneFrame=await decodePNG(await downloadBytes(page,()=>exportButton.click()));assert.deepEqual([oneFrame.w,oneFrame.h],[16,16]);
  await page.getByRole('button',{name:'Clear frame and group selection',exact:true}).click();
  await page.getByRole('textbox',{name:'Name of group 1',exact:true}).fill('Walk');await page.getByRole('textbox',{name:'Name of group 1',exact:true}).press('Tab');
  await page.getByRole('button',{name:'Move Walk later',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.sprite-group')[1]?.querySelector('.sprite-group-settings input')?.value==='Walk');
  meta=await sheet(page,assetId);assert.equal(meta.groups[1].name,'Walk');
  const walking=meta.groups[1],first=walking.frameIds[0],second=walking.frameIds[1];
  await page.locator(`[data-frame="${first}"]`).click();await page.getByRole('button',{name:'Move selected frame later',exact:true}).click();
  await page.waitForFunction(id=>document.querySelectorAll('.sprite-group')[1]?.querySelectorAll('[data-frame]')[1]?.dataset.frame===id,first);
  meta=await sheet(page,assetId);assert.deepEqual(meta.groups[1].frameIds.slice(0,2),[second,first]);
  await page.getByRole('button',{name:'Clear frame and group selection',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select group row-02',exact:true}).check();await page.getByRole('checkbox',{name:'Select group Walk',exact:true}).check();
  await page.getByRole('button',{name:'Merge selected groups',exact:true}).click();await waitGroups(page,7);meta=await sheet(page,assetId);assert.equal(meta.groups[0].frameIds.length,16);
  await page.locator(`[data-frame="${second}"]`).click();await page.getByRole('button',{name:'Start a new group at selected frame',exact:true}).click();await waitGroups(page,8);meta=await sheet(page,assetId);assert.equal(meta.groups[0].frameIds.length,8);assert.equal(meta.groups[1].frameIds.length,8);

  await page.getByRole('button',{name:'Edit sheet grouping',exact:true}).click();await page.locator('.sprite-organize-form [name=grouping]').selectOption('column');await page.getByRole('button',{name:'Confirm sprite sheet grouping',exact:true}).click();await waitGroups(page,8);
  meta=await sheet(page,assetId);assert.equal(meta.grouping,'column');assert.deepEqual(meta.groups[0].frameIds,['frame-0-0','frame-1-0','frame-2-0','frame-3-0','frame-4-0','frame-5-0','frame-6-0','frame-7-0']);
  const columns=meta.groups;
  await page.getByRole('button',{name:'Edit sheet grouping',exact:true}).click();await page.locator('.sprite-organize-form [name=grouping]').selectOption('manual');await page.getByRole('button',{name:'Confirm sprite sheet grouping',exact:true}).click();await waitGroups(page,8);
  meta=await sheet(page,assetId);assert.equal(meta.grouping,'manual');assert.deepEqual(meta.groups.map(({type,...group})=>group),columns.map(({type,...group})=>group),'manual mode preserves existing animation membership and settings');
  await page.getByRole('button',{name:`Open ${meta.groups[0].name} frames`,exact:true}).click();await page.locator(`[data-frame="${meta.groups[0].frameIds[0]}"]`).click();
  await page.getByRole('button',{name:`Open ${meta.groups[1].name} frames`,exact:true}).click();await page.locator(`[data-frame="${meta.groups[1].frameIds[0]}"]`).click();assert.equal(await page.locator('.sprite-scope output').textContent(),'2 frames','frame selections survive drilling into another animation');
  await page.getByRole('button',{name:'Clear frame and group selection',exact:true}).click();
  for(let index=0;index<8;index++)await page.locator('[data-group-check]').nth(index).check();
  await page.getByRole('button',{name:'Merge selected groups',exact:true}).click();await waitGroups(page,1);meta=await sheet(page,assetId);assert.equal(meta.groups[0].frameIds.length,64,'merging is explicit, not a side effect of manual mode');
  await page.locator('[data-frame="frame-0-0"]').click();await page.locator('[data-frame="frame-0-1"]').click();await page.getByRole('button',{name:'Make a group from selected frames',exact:true}).click();await waitGroups(page,2);
  meta=await sheet(page,assetId);assert.deepEqual(meta.groups.map(g=>g.frameIds.length),[62,2]);const manual=meta;
  await page.getByRole('button',{name:'Edit sheet grouping',exact:true}).click();assert.equal(await page.locator('.sprite-organize-form input[type=number]').count(),0);await page.locator('.sprite-organize-form [name=grouping]').selectOption('row');await page.getByRole('button',{name:'Confirm sprite sheet grouping',exact:true}).click();await waitGroups(page,8);meta=await sheet(page,assetId);assert.equal(meta.frames[1].x,16);assert.equal(meta.frames[1].w,16);assert.equal(meta.preserveEmpty,true);

  await format.selectOption('sheet');const full=await decodePNG(await downloadBytes(page,()=>exportButton.click()));assert.deepEqual([full.w,full.h],[128,128]);
  await format.selectOption('strips');const strips=entries(await downloadBytes(page,()=>exportButton.click()));assert.equal([...strips.keys()].filter(name=>name.startsWith('strips/')).length,8);assert.ok(strips.has('source.png'));assert.ok(strips.has('sprite-sheet.json'));assert.deepEqual((await decodePNG(strips.get('source.png'))).pixels,pixels);
  await format.selectOption('frames');const frames=entries(await downloadBytes(page,()=>exportButton.click()));assert.equal([...frames.keys()].filter(name=>name.startsWith('frames/')).length,64);const manifest=JSON.parse(frames.get('sprite-sheet.json'));assert.equal(manifest.type,'sprite_sheet');assert.equal(manifest.spriteSheet.groups.length,8);
  const saved=await project(page);assert.equal(saved.assets.length,1);assert.equal(saved.assets[0].src,source,'editing and exports preserve exact retained image source');assert.equal(saved.objects.length,0);
  // Undo is shared with the level editor: one grouping operation, one history step.
  await page.evaluate(()=>document.querySelector('#undo').click());await waitGroups(page,2);assert.deepEqual(await sheet(page,assetId),manual);
  assert.deepEqual(h.errors,[],'the imported hierarchy is interactive without browser errors');
 }finally{await h.close()}
});

test('browser: actual JPEG animation sheet and irregular PNG atlas import without grid setup',{skip:!process.env.PIXEL_MILL_BROWSER||!process.env.PIXEL_MILL_IMPORT_CHARACTER||!process.env.PIXEL_MILL_IMPORT_ENVIRONMENT,timeout:120000},async()=>{
 const h=await harness(),{page}=h;
 try{
  await page.locator('#import-button').click();assert.equal(await page.locator('#import-kind').inputValue(),'sheet');assert.equal(await page.locator('#import-dialog input[type=number]:visible').count(),0);
  await page.locator('#files').setInputFiles([process.env.PIXEL_MILL_IMPORT_CHARACTER,process.env.PIXEL_MILL_IMPORT_ENVIRONMENT]);
  await waitGroups(page,8);let saved=await project(page);assert.equal(saved.assets.length,2);
  const character=saved.assets.find(a=>a.spriteSheet?.type==='character'),environment=saved.assets.find(a=>a.spriteSheet?.type==='environment');assert.ok(character);assert.ok(environment);
  assert.deepEqual([character.w,character.h,character.spriteSheet.rows,character.spriteSheet.cols,character.spriteSheet.frames.length],[1254,1254,8,8,64]);assert.deepEqual(character.spriteSheet.groups.map(g=>g.frameIds.length),Array(8).fill(8));assert.equal(character.sheet.tileSize,16);
  assert.equal(await page.locator('.sprite-grid-form,.sprite-organize-form').count(),0);assert.equal(await page.locator('.sprite-frame').count(),0);
  const format=page.getByRole('combobox',{name:'Sprite export format',exact:true}),exportButton=page.getByRole('button',{name:'Export sprite sheet artwork',exact:true});
  const full=await decodePNG(await downloadBytes(page,()=>exportButton.click()));assert.deepEqual([full.w,full.h],[1254,1254]);
  await page.getByRole('button',{name:'Open row-07 frames',exact:true}).click();assert.equal(await page.locator('.sprite-frame').count(),8);
  const frame=character.spriteSheet.frames.find(f=>f.row===6&&f.col===3);await page.locator(`[data-frame="${frame.id}"]`).click();
  const exported=await decodePNG(await downloadBytes(page,()=>exportButton.click()));assert.deepEqual([exported.w,exported.h],[frame.w,frame.h]);
  for(let y=0;y<frame.h;y++)assert.deepEqual(exported.pixels.slice(y*frame.w*4,(y+1)*frame.w*4),full.pixels.slice(((frame.y+y)*full.w+frame.x)*4,((frame.y+y)*full.w+frame.x+frame.w)*4),'water and character keep the exact original spacing');
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'recognized-character-mobile.png')});
  await page.getByRole('button',{name:`Edit ${environment.name}`,exact:true}).click();await waitGroups(page,environment.spriteSheet.groups.length);
  assert.deepEqual([environment.w,environment.h],[2048,391]);assert.ok(environment.spriteSheet.frames.length>400);assert.ok(environment.spriteSheet.frames.some(f=>f.w===739&&f.h===150));assert.ok(environment.spriteSheet.frames.some(f=>f.w<16&&f.h<16));
  assert.equal(await page.locator('[data-play-group]').count(),0,'environment sets do not pretend to be animation strips');
  const group=environment.spriteSheet.groups[2];await page.getByRole('button',{name:`Open ${group.name} frames`,exact:true}).click();assert.equal(await page.locator('.sprite-asset-grid .sprite-frame').count(),group.frameIds.length);
  await page.getByRole('button',{name:'Select the whole sprite sheet',exact:true}).click();await format.selectOption('sheet');const atlas=await decodePNG(await downloadBytes(page,()=>exportButton.click()));assert.deepEqual([atlas.w,atlas.h],[2048,391]);
  const source=await decodePNG(await fs.readFile(process.env.PIXEL_MILL_IMPORT_ENVIRONMENT));assert.equal(createHash('sha256').update(atlas.pixels).digest('hex'),createHash('sha256').update(source.pixels).digest('hex'),'full sheet export preserves every original pixel');
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'recognized-environment-mobile.png')});
  saved=await project(page);assert.equal(saved.assets.length,2);assert.equal(saved.objects.length,0);assert.equal(saved.assets[0].src,character.src);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
