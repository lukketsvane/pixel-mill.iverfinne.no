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
import {validateProject} from '../dist/engine.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
class Bucket{
 constructor(){this.items=new Map();this.version=0}
 async get(key){const i=this.items.get(key);return i?{etag:i.etag,json:async()=>JSON.parse(i.text)}:null}
 async put(key,text,{onlyIf}={}){const old=this.items.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.items.set(key,{etag,text});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.items.delete(key)}
}
async function harness({webMCP=true}={}){
 const require=createRequire(import.meta.url);let chromium;
 try{({chromium}=require('playwright'))}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')))}
 const env={BUCKET:new Bucket()},server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp/')){const parts=[];for await(const part of req)parts.push(part);const abort=new AbortController();res.once('close',()=>abort.abort());const response=await agentFetch(new Request(url,{method:req.method,headers:req.headers,signal:abort.signal,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(parts)})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.flushHeaders();if(response.body)for await(const chunk of response.body){if(res.destroyed)break;res.write(chunk)}if(!res.destroyed)res.end();return}
  const filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!filename.startsWith(root))throw Error('Invalid path');res.setHeader('content-type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');res.end(await fs.readFile(filename));
 }catch(error){res.statusCode=500;res.end(error.message)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']})}catch(error){server.close();throw error}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,acceptDownloads:true});
 if(webMCP)await context.addInitScript(()=>{window.pixelMillTools=new Map();Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool:tool=>window.pixelMillTools.set(tool.name,tool)}})});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.waitForFunction(webMCP=>!document.querySelector('#app').inert&&(!webMCP||window.pixelMillTools?.has('group_sprite_sheet')),webMCP);
 assert.ok((await page.locator('body').innerText()).length>0);assert.equal(await page.locator('[data-nextjs-dialog],.vite-error-overlay').count(),0);
 return{page,errors,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve))}};
}
const tool=(page,name,args={})=>page.evaluate(async({name,args})=>{const out=await window.pixelMillTools.get(name).execute(args);return out.structuredContent||out},{name,args});
async function downloadBytes(page,action){const pending=page.waitForEvent('download');await action();const download=await pending,stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);return Buffer.concat(parts)}
async function project(page){const level=await tool(page,'get_level');if(level.name==='Untitled')await tool(page,'edit_level',{revision:level.revision,operations:[{type:'rename',name:'Browser sprite test'}]});return JSON.parse((await downloadBytes(page,()=>page.evaluate(()=>document.querySelector('#save').click()))).toString())}
async function sheet(page,assetId){return(await tool(page,'inspect_sprite_sheet',{assetId,includeFrames:true})).spriteSheet}
function entries(buffer){const files=new Map();let p=0;while(buffer.readUInt32LE(p)===0x04034b50){const size=buffer.readUInt32LE(p+18),n=buffer.readUInt16LE(p+26),extra=buffer.readUInt16LE(p+28),name=buffer.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;files.set(name,buffer.subarray(start,start+size));p=start+size}return files}
async function waitGroups(page,n){await page.waitForFunction(n=>document.querySelectorAll('.sprite-group').length===n,n)}

test('browser: cached local imports clean after idle without WebMCP or cloud and Undo survives reload',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await harness({webMCP:false}),{page}=h;
 const cached=()=>page.evaluate(async()=>{const {ProjectCache}=await import('/autosave.mjs');return new ProjectCache().active()});
 const until=async predicate=>{for(let i=0;i<150;i++){if(await predicate())return;await page.waitForTimeout(50)}throw Error('Startup cleanup did not settle')};
 try{
  const w=40,height=24,pixels=new Uint8Array(w*height*4);pixels.fill(255);for(let y=4;y<12;y++)for(let x=4;x<12;x++)if(x<7||y>=9)pixels.set([35,160,85,255],(y*w+x)*4);for(let y=6;y<11;y++)for(let x=25;x<30;x++)pixels.set([180,55,120,255],(y*w+x)*4);const src='data:image/png;base64,'+Buffer.from(await encodePNG({w,h:height,pixels})).toString('base64'),project=validateProject({format:'max-level-studio',version:1,name:'Latest local drawing',spawn:{x:12,y:20},assets:[{id:'local-atlas',name:'Local original',w,h:height,src,selectedForGeneration:true}],objects:[{id:'locked-local',asset:'local-atlas',name:'Unsynced local object',x:10,y:20,w,h:height,kind:'solid',locked:true,rotation:15,crop:{x:.1,y:0,w:.8,h:1},mask:{w,h:height,runs:Array.from({length:height},(_,y)=>[y,0,w])}}]}),record={id:'cached-startup-cleanup',token:'f'.repeat(64),revision:4,project,baseProject:{...project,objects:[]},dirty:true,connectionDisabled:true,updatedAt:Date.now()};
  await page.route('**/api/projects/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Cloud unavailable'})}));await page.evaluate(async record=>{const {ProjectCache}=await import('/autosave.mjs'),cache=new ProjectCache();await cache.put(record);await cache.select(record.id)},record);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.querySelector('#app').inert);assert.equal(await page.evaluate(()=>!!document.modelContext?.registerTool),false);
  await page.locator('#canvas').focus();await page.keyboard.press('b');await page.mouse.move(90,260);await page.mouse.down();await page.mouse.move(200,260,{steps:5});await page.waitForTimeout(800);assert.equal((await cached()).project.assets.length,1,'cleanup waits for the live gesture');await page.mouse.up();await until(async()=>{const current=await cached();return current.importCleanupVersion===1&&current.project.assets.length===4});const cleaned=await cached();assert.equal(cleaned.id,record.id);assert.equal(cleaned.project.name,project.name);assert.deepEqual(cleaned.project.objects[0],project.objects[0]);assert.equal(cleaned.project.objects.length,2,'new local stroke survives migration');assert.ok(cleaned.project.objects[1].mask.runs.length);assert.equal(cleaned.project.assets.find(asset=>asset.id==='local-atlas').selectedForGeneration,true);assert.notEqual(cleaned.project.assets.find(asset=>asset.id==='local-atlas').src,src);assert.equal(await page.locator('dialog[open]').count(),0);
  await page.keyboard.press('Control+z');await until(async()=>(await cached()).project.assets.length===1);const restored=await cached();assert.deepEqual(restored.project.objects,cleaned.project.objects);assert.equal(restored.project.assets[0].src,src);assert.equal(restored.importCleanupVersion,1);await page.waitForTimeout(1300);assert.equal((await cached()).project.assets.length,1,'Undo is not automatically restyled');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!document.querySelector('#app').inert);await page.waitForTimeout(800);const reopened=await cached();assert.equal(reopened.id,record.id);assert.equal(reopened.project.assets.length,1);assert.deepEqual(reopened.project.objects,cleaned.project.objects);assert.equal(await page.locator('dialog[open]').count(),0);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: normal import removes opaque backgrounds and splits every native object without settings',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await harness(),{page}=h;
 const image=(w,h,background)=>{const pixels=new Uint8Array(w*h*4);for(let at=0;at<pixels.length;at+=4)pixels.set(background,at);return{w,h,pixels}};
 const paint=(source,part)=>{for(let y=0;y<part.h;y++)for(let x=0;x<part.w;x++)if(!part.on||part.on(x,y))source.pixels.set(part.color,((part.y+y)*source.w+part.x+x)*4)};
 const verify=async(assets,prefix,parts)=>{const imported=assets.filter(asset=>asset.name.startsWith(prefix));assert.equal(imported.length,parts.length);for(const part of parts){const asset=imported.find(asset=>asset.w===part.w&&asset.h===part.h);assert.ok(asset,'object keeps its native crop');assert.equal(asset.spriteSheet,undefined);assert.equal(asset.parentAssetId,undefined);const decoded=await decodePNG(Buffer.from(asset.src.split(',')[1],'base64'));for(let y=0;y<part.h;y++)for(let x=0;x<part.w;x++){const at=(y*part.w+x)*4;assert.deepEqual([...decoded.pixels.subarray(at,at+4)],!part.on||part.on(x,y)?part.color:[0,0,0,0])}}};
 const transfer=async(type,name,png)=>{await page.locator('#canvas').focus();await page.evaluate(({type,name,data})=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),files=new DataTransfer();files.items.add(new File([bytes],name,{type:'image/png'}));document.querySelector('#canvas').dispatchEvent(type==='drop'?new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:files}):new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:files}))},{type,name,data:Buffer.from(png).toString('base64')});await page.waitForFunction(()=>!document.querySelector('#import-button').disabled)};
 try{
  await tool(page,'edit_level',{revision:(await tool(page,'get_level')).revision,operations:[{type:'rename',name:'Automatic object import'}]});
  const opaque=image(96,64,[246,237,219,255]),parts=[{x:4,y:6,w:12,h:12,color:[45,155,90,255],on:(x,y)=>x<3||y>=9},{x:32,y:12,w:10,h:14,color:[190,65,110,255],on:(x,y)=>x<2||x>=8||y>=12},{x:80,y:50,w:1,h:1,color:[35,90,220,255]}];for(const part of parts)paint(opaque,part);const opaquePNG=await encodePNG(opaque);
  const chooser=page.waitForEvent('filechooser');await page.locator('#import-button').click();assert.equal(await page.locator('#import-dialog,#import-kind,#background,#tolerance,#scale,#split,#min-area').count(),0);assert.equal(await page.locator('dialog[open]').count(),0);await(await chooser).setFiles({name:'Opaque sheet.png',mimeType:'image/png',buffer:Buffer.from(opaquePNG)});await page.waitForFunction(()=>!document.querySelector('#import-button').disabled);
  let saved=await project(page);assert.equal(saved.assets.length,3,'one-pixel objects are retained');assert.equal(saved.objects.length,0);await verify(saved.assets,'Opaque-sheet',parts);await page.locator('#canvas').focus();await page.keyboard.press('Control+z');assert.equal((await tool(page,'get_level')).assets.length,0);await page.keyboard.press('Control+Shift+z');assert.equal((await tool(page,'get_level')).assets.length,3);
  const transparent=image(48,32,[0,0,0,0]),foreground=[{x:0,y:0,w:8,h:6,color:[246,237,219,255]},{x:24,y:14,w:5,h:9,color:[0,0,255,91]}];for(const part of foreground)paint(transparent,part);await transfer('drop','Transparent objects.png',await encodePNG(transparent));saved=await project(page);assert.equal(saved.assets.length,5);await verify(saved.assets,'Transparent-objects',foreground);
  await transfer('paste','Pasted sheet.png',opaquePNG);saved=await project(page);assert.equal(saved.assets.length,8);await verify(saved.assets,'Pasted-sheet',parts);assert.ok(saved.assets.every(asset=>!asset.spriteSheet&&!asset.parentAssetId));assert.equal(saved.artRequests?.length||0,0);await page.locator('#canvas').focus();await page.keyboard.press('Control+z');assert.equal((await tool(page,'get_level')).assets.length,5);await page.keyboard.press('Control+Shift+z');assert.equal((await tool(page,'get_level')).assets.length,8);assert.equal(await page.locator('#import-dialog').count(),0);assert.equal(await page.locator('dialog[open]').count(),0);assert.deepEqual(h.errors,[]);
  if(process.env.PIXEL_MILL_SCREENSHOTS){await page.setViewportSize({width:1200,height:850});await page.locator('.sheet-card-preview').first().click();await page.mouse.click(420,340);await page.locator('.sheet-card-preview').nth(1).click();await page.mouse.click(540,340);await page.locator('.sheet-card-preview').first().click();await page.locator('#status').waitFor({state:'hidden'});await fs.mkdir(process.env.PIXEL_MILL_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-automatic-import.png')})}
 }finally{await h.close()}
});

test('browser: existing import cleanup preserves placed geometry and native foreground with idempotent undo',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await harness(),{page}=h;
 try{
  const w=96,height=64,pixels=new Uint8Array(w*height*4);pixels.fill(255);const parts=[{x:4,y:6,w:12,h:12,color:[45,155,90,255],on:(x,y)=>x<3||y>=9},{x:32,y:12,w:10,h:14,color:[190,65,110,255],on:(x,y)=>x<2||x>=8||y>=12},{x:80,y:50,w:1,h:1,color:[35,90,220,255]}];for(const part of parts)for(let y=0;y<part.h;y++)for(let x=0;x<part.w;x++)if(!part.on||part.on(x,y))pixels.set(part.color,((part.y+y)*w+part.x+x)*4);
  const src='data:image/png;base64,'+Buffer.from(await encodePNG({w,h:height,pixels})).toString('base64'),transparentPixels=new Uint8Array(16*16*4);for(let y=0;y<6;y++)for(let x=0;x<8;x++)transparentPixels.set([245,245,245,255],(y*16+x)*4);transparentPixels.set([0,0,255,91],(14*16+14)*4);const transparent='data:image/png;base64,'+Buffer.from(await encodePNG({w:16,h:16,pixels:transparentPixels})).toString('base64');
  const fixture={format:'max-level-studio',version:1,name:'Existing import cleanup',spawn:{x:0,y:0},assets:[{id:'existing-atlas',name:'Existing atlas',w,h:height,src},{id:'transparent-reference',name:'Transparent reference',w:16,h:16,src:transparent,selectedForGeneration:true}],objects:[{id:'cropped-mask',name:'Cropped rotated terrain',asset:'existing-atlas',x:-50,y:-30,w,h:height,kind:'solid',role:'platform',rotation:15,flip:true,crop:{x:.125,y:.125,w:.75,h:.75},mask:{w,h:height,runs:Array.from({length:height},(_,y)=>[[y,0,24],[y,28,w]]).flat()}},{id:'other-instance',name:'Other atlas instance',asset:'existing-atlas',x:80,y:20,w,h:height,kind:'decor',rotation:-10}]};
  await page.locator('#project-file').setInputFiles({name:'existing-imports.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(()=>window.pixelMillTools.has('clean_imported_images')&&document.querySelectorAll('.sheet-card').length===2);const before=await project(page),assetIds=before.assets.map(asset=>asset.id),hashes=assets=>Object.fromEntries(assets.filter(asset=>assetIds.includes(asset.id)).map(asset=>[asset.id,createHash('sha256').update(asset.src).digest('hex')]));let level=await tool(page,'get_level');const cleaned=await tool(page,'clean_imported_images',{revision:level.revision,assetIds,sourceHashes:hashes(before.assets)});assert.equal(cleaned.changed,true);const after=await project(page);assert.deepEqual(after.objects,before.objects);assert.deepEqual(after.spawn,before.spawn);const source=after.assets.find(asset=>asset.id==='existing-atlas');assert.deepEqual([source.w,source.h],[w,height]);const backgroundRemoved=await decodePNG(Buffer.from(source.src.split(',')[1],'base64'));for(let at=0;at<pixels.length;at+=4)assert.deepEqual([...backgroundRemoved.pixels.subarray(at,at+4)],pixels[at]===255&&pixels[at+1]===255&&pixels[at+2]===255?[0,0,0,0]:[...pixels.subarray(at,at+4)]);assert.ok(after.assets.some(asset=>asset.id!=='existing-atlas'&&asset.hidden&&asset.src===src),'untouched original PNG is retained');assert.equal(after.assets.find(asset=>asset.id==='transparent-reference').src,transparent);assert.equal(after.assets.find(asset=>asset.id==='transparent-reference').hidden,undefined);
  const atlasParts=cleaned.sources.find(source=>source.sourceId==='existing-atlas').parts;assert.equal(atlasParts.length,3);for(const expected of parts){const part=atlasParts.find(part=>part.x===expected.x&&part.y===expected.y),asset=after.assets.find(asset=>asset.id===part.assetId);assert.deepEqual([asset.w,asset.h],[expected.w,expected.h]);const decoded=await decodePNG(Buffer.from(asset.src.split(',')[1],'base64'));for(let y=0;y<asset.h;y++)for(let x=0;x<asset.w;x++){const at=(y*asset.w+x)*4;assert.deepEqual([...decoded.pixels.subarray(at,at+4)],!expected.on||expected.on(x,y)?expected.color:[0,0,0,0])}assert.equal(await page.locator(`.sheet-card[data-asset-id="${asset.id}"]`).count(),1)}
  level=await tool(page,'get_level');const repeated=await tool(page,'clean_imported_images',{revision:level.revision,assetIds,sourceHashes:hashes(after.assets)});assert.equal(repeated.changed,false);assert.deepEqual(repeated.assetIds,cleaned.assetIds);assert.equal((await tool(page,'get_level')).revision,level.revision);assert.deepEqual((await project(page)).assets,after.assets);await page.locator('#canvas').focus();await page.keyboard.press('Control+z');assert.deepEqual(await project(page),before);await page.keyboard.press('Control+Shift+z');assert.deepEqual(await project(page),after);assert.deepEqual(h.errors,[]);
  if(process.env.PIXEL_MILL_SCREENSHOTS){await page.setViewportSize({width:1200,height:850});await page.locator(`.sheet-card[data-asset-id="${atlasParts[0].assetId}"] .sheet-card-preview`).click({button:'right'});await page.locator('#status').waitFor({state:'hidden'});await fs.mkdir(process.env.PIXEL_MILL_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-existing-imports.png')})}
 }finally{await h.close()}
});

test('browser: one character sheet retains source, editable row/frame hierarchy, exports and undo',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:120000},async()=>{
 const h=await harness(),{page}=h;
 try{
  const pixels=new Uint8Array(128*128*4);for(let row=0;row<8;row++)for(let col=0;col<8;col++){if(row===7&&col===7)continue;for(let y=3;y<13;y++)for(let x=3;x<13;x++)pixels.set([40+row*20,40+col*20,120,255],((row*16+y)*128+col*16+x)*4)}
  const original=await encodePNG({w:128,h:128,pixels});
  await tool(page,'import_image',{revision:(await tool(page,'get_level')).revision,name:'character-eight-rows',dataUrl:'data:image/png;base64,'+Buffer.from(original).toString('base64')});await page.locator('#assets').waitFor({state:'visible'});await page.locator('.sheet-card-preview').click();
  await waitGroups(page,8);assert.equal(await page.locator('#assets-workspace,#workspace-tabs,#assets-tab,#level-tab').count(),0);assert.equal(await page.locator('#segment-asset').isDisabled(),true);assert.equal(await page.locator('#remove-asset-background').isDisabled(),true);assert.match(await page.locator('#segment-asset').getAttribute('title'),/animation sheets stay intact/);
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
  await project(page);await page.waitForFunction(async()=>{const {ProjectCache}=await import('/autosave.mjs'),record=await new ProjectCache().active();return!!record?.token&&!record.dirty});

  await page.getByRole('button',{name:'Edit sheet grouping',exact:true}).click();assert.equal(await page.locator('.sprite-organize-form input[type=number]').count(),0);await page.locator('.sprite-organize-form [name=grouping]').selectOption('row');await page.getByRole('button',{name:'Confirm sprite sheet grouping',exact:true}).click();await waitGroups(page,8);meta=await sheet(page,assetId);assert.equal(meta.frames[1].x,16);assert.equal(meta.frames[1].w,16);assert.equal(meta.preserveEmpty,true);

  await format.selectOption('sheet');const full=await decodePNG(await downloadBytes(page,()=>exportButton.click()));assert.deepEqual([full.w,full.h],[128,128]);
  await format.selectOption('strips');const strips=entries(await downloadBytes(page,()=>exportButton.click()));assert.equal([...strips.keys()].filter(name=>name.startsWith('strips/')).length,8);assert.ok(strips.has('source.png'));assert.ok(strips.has('sprite-sheet.json'));assert.deepEqual((await decodePNG(strips.get('source.png'))).pixels,pixels);
  await format.selectOption('frames');const frames=entries(await downloadBytes(page,()=>exportButton.click()));assert.equal([...frames.keys()].filter(name=>name.startsWith('frames/')).length,64);const manifest=JSON.parse(frames.get('sprite-sheet.json'));assert.equal(manifest.type,'sprite_sheet');assert.equal(manifest.spriteSheet.groups.length,8);
  const saved=await project(page);assert.equal(saved.assets.length,1);assert.equal(saved.assets[0].src,source,'editing and exports preserve exact retained image source');assert.equal(saved.objects.length,0);
  // Undo is shared with the level editor: one grouping operation, one history step.
  await page.evaluate(()=>{const original=Image.prototype.decode;Image.prototype.decode=function(){Image.prototype.decode=original;window.undoDecodeStarted=true;return new Promise(resolve=>window.releaseUndoDecode=()=>resolve(original.call(this)))};document.querySelector('#undo').click()});await page.waitForFunction(()=>window.undoDecodeStarted);assert.deepEqual(await sheet(page,assetId),manual,'remote undo commits while the editor decodes its restored pixels');await page.evaluate(()=>window.releaseUndoDecode());await waitGroups(page,2);assert.deepEqual(await sheet(page,assetId),manual);
  assert.deepEqual(h.errors,[],'the imported hierarchy is interactive without browser errors');
 }finally{await h.close()}
});

test('browser: actual JPEG animation sheet and irregular PNG atlas import without grid setup',{skip:!process.env.PIXEL_MILL_BROWSER||!process.env.PIXEL_MILL_IMPORT_CHARACTER||!process.env.PIXEL_MILL_IMPORT_ENVIRONMENT,timeout:120000},async()=>{
 const h=await harness(),{page}=h;
 try{
  for(const filename of [process.env.PIXEL_MILL_IMPORT_CHARACTER,process.env.PIXEL_MILL_IMPORT_ENVIRONMENT]){const bytes=await fs.readFile(filename),type=/\.jpe?g$/i.test(filename)?'image/jpeg':'image/png',src=await page.evaluate(async({source,type})=>{if(type==='image/png')return source;const img=new Image();img.src=source;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png')},{source:`data:${type};base64,${bytes.toString('base64')}`,type});await tool(page,'import_image',{revision:(await tool(page,'get_level')).revision,name:path.basename(filename,path.extname(filename)),dataUrl:src})}await page.locator('#assets').waitFor({state:'visible'});await page.locator('.sheet-card-preview').first().click();
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
