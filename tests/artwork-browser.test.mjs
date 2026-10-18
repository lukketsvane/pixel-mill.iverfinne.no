// Opt-in real-browser round trip: PIXEL_MILL_BROWSER=1 node --test tests/artwork-browser.test.mjs
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE when Chromium is installed outside Playwright's cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {agentFetch} from '../worker/api.mjs';
import {encodePNG,decodePNG,dataURL} from '../dist/png.mjs';
import {platforms} from '../dist/engine.mjs';
import {maskContains} from '../dist/brush.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
class BrowserBucket {
 constructor(){this.items=new Map();this.version=0}
 async get(key){const item=this.items.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.text)}:null}
 async put(key,text,{onlyIf}={}){const old=this.items.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.items.set(key,{text,etag});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.items.delete(key)}
}
async function browserHarness(){
 const require=createRequire(import.meta.url);let chromium;
 try{({chromium}=require('playwright'))}catch{const modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;if(!modules)throw Error('Install Playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES before running browser verification.');({chromium}=require(path.join(modules,'playwright')))}
 const env={BUCKET:new BrowserBucket()},requests=[];
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host);requests.push({path:url.pathname,method:req.method});
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const abort=new AbortController();res.once('close',()=>abort.abort());const result=await agentFetch(new Request(url,{method:req.method,headers:req.headers,signal:abort.signal,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);res.writeHead(result.status,Object.fromEntries(result.headers));res.flushHeaders();if(result.body)for await(const chunk of result.body){if(res.destroyed)break;res.write(chunk)}if(!res.destroyed)res.end();return}
  const filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!filename.startsWith(root))throw Error('Invalid path');const data=await fs.readFile(filename);res.setHeader('content-type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');res.end(data);
 }catch(error){res.statusCode=500;res.end(error.message)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 let browser;try{browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']})}catch(error){server.close();throw error}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,acceptDownloads:true});
 await context.addInitScript(()=>{window.pixelMillTools=new Map();Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool:tool=>window.pixelMillTools.set(tool.name,tool)}})});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.pixelMillTools?.has('apply_artwork'));
 return{page,requests,errors,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve))}};
}
async function png(w,h,color=(x,y)=>[44+(x%16)*3,70+(y%16)*3,112,255]){const pixels=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set(color(x,y),(y*w+x)*4);return dataURL(await encodePNG({w,h,pixels}))}
const value=result=>result.structuredContent||result;
async function local(page,name,args={}){return value(await page.evaluate(async({name,args})=>window.pixelMillTools.get(name).execute(args),{name,args}))}
async function savedProject(page){const level=await local(page,'get_level');if(level.name==='Untitled')await local(page,'edit_level',{revision:level.revision,operations:[{type:'rename',name:'Browser artwork test'}]});const download=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#save').click());const file=await download,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString())}
const geometry=project=>({spawn:project.spawn,objects:project.objects.map(({artwork,...object})=>object),collision:platforms(project.objects)});

test('browser: Use sheets textures new brush strokes immediately and preserves native erasing and undo', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  let level=await local(page,'get_level');await local(page,'edit_level',{revision:level.revision,operations:[{type:'block',id:'initial-floor',x:-40,y:20,width:80,height:16,role:'platform',color:'#91e8c1'}]});level=await local(page,'get_level');const imported=await local(page,'import_image',{revision:level.revision,name:'One terrain sheet',dataUrl:await png(48,48),autoGroup:false}),assetId=imported.assetIds[0];level=await local(page,'get_level');await local(page,'edit_level',{revision:level.revision,operations:[{type:'asset',id:assetId,changes:{selectedForGeneration:true,sheet:{tileSize:16,role:'platform'}}}]});
  await page.locator('#artwork-menu > summary').click();await page.locator('#apply-selected-sheets').click();level=await local(page,'get_level');assert.equal(level.objects[0].artwork.asset,assetId);assert.equal(level.assets[0].sheet.live,true);const count=level.assets.length;
  await page.locator('#canvas').focus();await page.keyboard.press('b');await page.mouse.move(90,230);await page.mouse.down();await page.mouse.move(230,230,{steps:8});await page.mouse.up();const painted=await local(page,'get_level'),stroke=painted.objects.find(object=>object.id!=='initial-floor'),camera=painted.camera;assert.ok(stroke.mask.runs.length);assert.equal(stroke.artwork.asset,assetId);assert.equal(stroke.artwork.mode,'terrain');assert.equal(painted.assets.length,count);assert.equal(painted.artRequests?.length||0,0);const hole={x:camera.x+160/camera.z-stroke.x,y:camera.y+230/camera.z-stroke.y};assert.equal(maskContains(stroke.mask,hole.x,hole.y),true);
  await page.keyboard.press('e');await page.locator('#brush-number').fill('8');await page.locator('#brush-number').blur();await page.locator('#canvas').focus();await page.mouse.click(160,230);const erased=await local(page,'get_level'),cut=erased.objects.find(object=>object.id===stroke.id);assert.equal(maskContains(cut.mask,hole.x,hole.y),false);assert.equal(cut.artwork.asset,assetId);assert.equal(erased.assets.length,count);assert.equal(erased.artRequests?.length||0,0);await page.keyboard.press('Control+z');const restored=await local(page,'get_level');assert.deepEqual(restored.objects,painted.objects);assert.equal(restored.assets.length,count);assert.equal(restored.artRequests?.length||0,0);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: asset multi-selection removes unused images together and keeps used sources and references', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 const selected=()=>page.locator('.sheet-card[data-selected="true"]');
 const card=id=>page.locator(`.sheet-card[data-asset-id="${id}"] .sheet-card-preview`);
 try{
  await page.setViewportSize({width:1200,height:850});const src=await png(16,16),project={format:'max-level-studio',version:1,name:'Bulk asset editing',spawn:{x:0,y:0},assets:['used','one','two','three'].map(id=>({id,name:id,w:16,h:16,src,...(id==='one'?{selectedForGeneration:true}:{})})),objects:[{id:'placed',name:'Used source',asset:'used',kind:'decor',x:8,y:16,w:16,h:16}]};
  await page.locator('#project-file').setInputFiles({name:'bulk-assets.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForFunction(()=>document.querySelectorAll('#sheet-grid .sheet-card-preview').length===4);await page.locator('#assets').waitFor({state:'visible'});await card('one').click();await card('three').click({modifiers:['Shift']});assert.equal(await selected().count(),3);assert.equal(await page.locator('#asset-selection-count').innerText(),'3 selected');assert.equal(await page.locator('.sheet-reference[aria-pressed="true"]').count(),1);await page.keyboard.press('b');await card('two').click({button:'right'});assert.equal(await selected().count(),3);assert.equal(await page.locator('[data-tool="paint"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#sheet-name').inputValue(),'two');let before=await local(page,'get_level');
  if(process.env.PIXEL_MILL_SCREENSHOTS){await page.locator('#status').waitFor({state:'hidden'});await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-bulk-assets.png')});await page.setViewportSize({width:390,height:844});const inspector=await page.locator('#sheet-detail').boundingBox(),strip=await page.locator('#assets').boundingBox(),dock=await page.locator('#toolbar').boundingBox();assert.ok(inspector.x>0&&inspector.width<390&&inspector.height<422&&inspector.y+inspector.height<=strip.y);assert.ok(strip.y+strip.height<dock.y);await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-bulk-assets-mobile.png')});await page.setViewportSize({width:1200,height:850})}
  await page.locator('#delete-selected-assets').click();await page.waitForFunction(()=>document.querySelectorAll('.sheet-card').length===1);assert.deepEqual((await local(page,'get_level')).objects,before.objects);await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.sheet-card').length===4);assert.deepEqual((await local(page,'get_level')).assets,before.assets);
  await card('one').click();await card('two').click({modifiers:['Control']});assert.equal(await selected().count(),2);await card('two').click({modifiers:['Meta']});assert.equal(await selected().count(),1);await page.keyboard.press('Escape');assert.equal(await selected().count(),0);assert.equal(await page.locator('#asset-selection-count').isVisible(),false);await card('used').click();await page.locator('#sheet-name').focus();await page.keyboard.press('Control+a');await page.keyboard.press('Delete');assert.equal((await local(page,'get_level')).assets.length,4);assert.equal(await selected().count(),1);await page.locator('#sheet-name').fill('used');await page.locator('#sheet-name').blur();await page.locator('#sheet-preview').focus();await page.keyboard.press('Control+a');assert.equal(await selected().count(),4);await page.keyboard.press('Backspace');await page.waitForFunction(()=>document.querySelectorAll('.sheet-card').length===1);const kept=await local(page,'get_level');assert.equal(kept.assets[0].id,'used');assert.deepEqual(kept.objects,before.objects);assert.match(await page.locator('#status').innerText(),/3 removed · 1 in use kept/);await page.keyboard.press('Delete');assert.equal((await local(page,'get_level')).revision,kept.revision);await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.sheet-card').length===4);assert.deepEqual((await local(page,'get_level')).objects,before.objects);await card('one').click();const strip=await page.locator('#assets').boundingBox();await page.mouse.click(strip.x+strip.width-5,strip.y+strip.height-5);assert.equal(await selected().count(),0);assert.equal(await page.locator('#delete-selected-assets').isVisible(),false);assert.equal(await page.locator('dialog[open]').count(),0);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: collision strokes keep their solid kind when the inspector receives an invalid change', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  const level=await local(page,'get_level');await local(page,'edit_level',{revision:level.revision,operations:[{type:'stroke',id:'collision',points:[{x:0,y:0},{x:80,y:0}],width:8}]});await page.locator('#canvas').focus();await page.keyboard.press('v');await page.keyboard.press('f');const before=await local(page,'get_level'),camera=before.camera;await page.mouse.click((40-camera.x)*camera.z,(0-camera.y)*camera.z);assert.equal(await page.locator('#piece-kind').isDisabled(),true);const revision=(await local(page,'get_level')).revision;await page.locator('#piece-kind').evaluate(select=>{select.value='decor';select.dispatchEvent(new Event('change',{bubbles:true}))});const after=await local(page,'get_level');assert.equal(after.objects[0].kind,'solid');assert.equal(after.objects[0].collisionOnly,true);assert.equal(after.revision,revision);assert.equal(await page.locator('#piece-kind').inputValue(),'solid');await page.mouse.click((40-camera.x)*camera.z,(0-camera.y)*camera.z,{button:'right'});assert.equal(await page.locator('#context-menu').isVisible(),true);assert.equal((await page.locator('#context-menu').innerText()).trim(),'Lock');assert.equal(await page.locator('#crop-piece').isVisible(),false);assert.equal(await page.locator('#erase-piece').isVisible(),false);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: level assets and tools remain visible through drawing, remote artwork, restore and play', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 const visible=async()=>{assert.equal(await page.locator('#assets').isVisible(),true);assert.equal(await page.locator('#toolbar').isVisible(),true);assert.equal(await page.locator('#close-assets').count(),0);const tray=await page.locator('#assets').boundingBox(),dock=await page.locator('#toolbar').boundingBox();assert.ok(tray.y+tray.height<dock.y);assert.ok(tray.height<=100)};
 try{
  const src=await png(16,16),project={format:'max-level-studio',version:1,name:'Persistent palette',spawn:{x:0,y:0},assets:[{id:'reference',name:'Reference',w:16,h:16,src}],objects:[]};
  await page.locator('#project-file').setInputFiles({name:'palette.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForFunction(()=>document.querySelectorAll('#sheet-grid .sheet-card-preview').length===1);await visible();
  await page.locator('#canvas').focus();await page.keyboard.press('b');await page.mouse.move(100,280);await page.mouse.down();await page.mouse.move(270,300,{steps:6});await page.mouse.up();await visible();await page.keyboard.press('v');await visible();await page.keyboard.press('Escape');await visible();await page.keyboard.press('f');await visible();
  let level=await local(page,'get_level');const prepared=await local(page,'prepare_artwork',{revision:level.revision,assetIds:['reference']}),request=prepared.request;await local(page,'apply_artwork',{revision:prepared.revision,requestId:request.id,dataUrl:await png(request.width,request.height)});await visible();level=await local(page,'get_level');assert.ok(level.objects[0].artwork);
  await page.keyboard.press('Control+z');level=await local(page,'get_level');assert.equal(level.objects[0].artwork,undefined);await visible();await page.keyboard.press('b');const brush=await page.locator('#brush-options').boundingBox(),tray=await page.locator('#assets').boundingBox();assert.ok(brush.y+brush.height<tray.y,'brush stays above the asset strip');
  if(process.env.PIXEL_MILL_SCREENSHOTS){await page.locator('#status').waitFor({state:'hidden'});await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-persistent-assets-mobile.png')})};await page.setViewportSize({width:1200,height:850});await visible();if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-persistent-assets.png')});assert.equal(await page.locator('#assets-workspace,#workspace-tabs').count(),0);await visible();await page.locator('#canvas').focus();await page.keyboard.press('Enter');assert.equal((await local(page,'get_level')).playing,true);assert.equal(await page.locator('#assets').isVisible(),false);await page.keyboard.press('Escape');await visible();assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: native image selections segment exact pieces and background removal keeps placed geometry', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;let downloads=0;page.on('download',()=>downloads++);
 const image=async id=>{const result=await local(page,'get_asset_image',{id});return decodePNG(Buffer.from(result.content.find(item=>item.type==='image').data,'base64'))};
 const focus=async id=>{await page.locator(`.sheet-card[data-asset-id="${id}"] .sheet-card-preview`).click();await page.waitForFunction(()=>{const image=document.querySelector('#sheet-preview');return image.complete&&image.naturalWidth>0});await page.locator('#segment-asset').waitFor({state:'visible'})};
 const settled=()=>page.waitForFunction(()=>!document.querySelector('#segment-asset').disabled);
 const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await page.waitForTimeout(50)}throw Error('Image edit did not settle')};
 try{
  const source=await png(80,48,(x,y)=>x>=4&&x<12&&y>=8&&y<16?[23,171,92,255]:x>=28&&x<38&&y>=10&&y<20?[201,37,110,255]:x>=60&&x<68&&y>=24&&y<32?[37,83,211,255]:[0,0,0,0]);
  let initial=await local(page,'get_level');const sourceId=(await local(page,'import_image',{revision:initial.revision,dataUrl:source,name:'Three loose objects',autoGroup:false})).assetIds[0];initial=await local(page,'get_level');await local(page,'edit_level',{revision:initial.revision,operations:[{type:'rename',name:'Native image editing'},{type:'place',id:'placed-source',assetId:sourceId,x:12,y:16,kind:'decor'}]});
  await page.locator('#assets').waitFor({state:'visible'});await focus(sourceId);const before=await local(page,'get_level'),original=await image(sourceId),box=await page.locator('#sheet-preview').boundingBox();
  await page.mouse.move(box.x+1,box.y+4);await page.mouse.down();await page.mouse.move(box.x+50,box.y+23,{steps:6});await page.mouse.up();assert.equal(await page.locator('#asset-region').isVisible(),true);
  const region=await page.locator('#asset-region').boundingBox();assert.equal(Math.round(region.width),49);assert.equal(Math.round(region.height),19);
  await page.locator('#segment-asset').click();await until(async()=>(await local(page,'get_level')).assets.length===3);await settled();let level=await local(page,'get_level');const parts=level.assets.filter(asset=>asset.id!==sourceId);assert.deepEqual(parts.map(({w,h})=>[w,h]),[[8,8],[10,10]]);assert.deepEqual(level.objects,before.objects);assert.deepEqual((await image(sourceId)).pixels,original.pixels);assert.equal(await page.locator('#asset-region').isVisible(),false);
  for(const [i,part]of parts.entries()){const output=await image(part.id),expected=i?[201,37,110,255]:[23,171,92,255];for(let at=0;at<output.pixels.length;at+=4)assert.deepEqual([...output.pixels.subarray(at,at+4)],expected)}
  await page.keyboard.press('Control+z');await until(async()=>(await local(page,'get_level')).assets.length===1);await page.keyboard.press('Control+Shift+z');await until(async()=>(await local(page,'get_level')).assets.length===3);
  await focus(sourceId);await page.locator('#sheet-preview').click({position:{x:7,y:11}});let selected=await page.locator('#asset-region').boundingBox();assert.equal(Math.round(selected.width),8);assert.equal(Math.round(selected.height),8);await page.keyboard.press('Escape');assert.equal(await page.locator('#asset-region').isVisible(),false);await page.locator('#sheet-preview').click({position:{x:7,y:11}});await page.keyboard.press('Control+Shift+x');await until(async()=>(await local(page,'get_level')).assets.length===4);await settled();level=await local(page,'get_level');assert.deepEqual([level.assets.at(-1).w,level.assets.at(-1).h],[8,8]);
  level=await local(page,'get_level');const white=await png(32,32,(x,y)=>x>=12&&x<20&&y>=12&&y<20?[211,44,55,255]:[255,255,255,255]),imported=await local(page,'import_image',{revision:level.revision,dataUrl:white,name:'Background removal',autoGroup:false}),whiteId=imported.assetIds[0];level=await local(page,'get_level');await local(page,'edit_level',{revision:level.revision,operations:[{type:'place',id:'placed-white',assetId:whiteId,x:120,y:40,kind:'decor'}]});await focus(whiteId);const placed=(await local(page,'get_level')).objects;
  await page.locator('#sheet-name').focus();await page.keyboard.press('Control+Shift+b');assert.deepEqual((await image(whiteId)).pixels,(await decodePNG(Buffer.from(white.split(',')[1],'base64'))).pixels);await page.locator('#sheet-preview').focus();await page.keyboard.press('Control+Shift+b');await until(async()=>(await local(page,'get_level')).assets.some(asset=>asset.hidden));await settled();const cleaned=await image(whiteId);assert.deepEqual([cleaned.w,cleaned.h],[32,32]);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const at=(y*32+x)*4;assert.deepEqual([...cleaned.pixels.subarray(at,at+4)],x>=12&&x<20&&y>=12&&y<20?[211,44,55,255]:[0,0,0,0])}
  level=await local(page,'get_level');assert.deepEqual(level.objects,placed);const backup=level.assets.find(asset=>asset.hidden);assert.deepEqual((await image(backup.id)).pixels,(await decodePNG(Buffer.from(white.split(',')[1],'base64'))).pixels);assert.equal(await page.locator(`#sheet-grid .sheet-card[data-asset-id="${backup.id}"]`).count(),0);assert.equal(await page.locator('#sheet-name').inputValue(),'Background removal');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(downloads,0);
  await page.keyboard.press('Control+z');await until(async()=>!(await local(page,'get_level')).assets.some(asset=>asset.hidden));assert.deepEqual((await image(whiteId)).pixels,(await decodePNG(Buffer.from(white.split(',')[1],'base64'))).pixels);await page.keyboard.press('Control+Shift+z');await until(async()=>(await local(page,'get_level')).assets.some(asset=>asset.hidden));await settled();
  if(process.env.PIXEL_MILL_SCREENSHOTS){await page.locator('#status').waitFor({state:'hidden'});await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-native-image-tools-mobile.png')})};await page.setViewportSize({width:1200,height:850});await focus(sourceId);await page.locator('#sheet-preview').click({position:{x:7,y:11}});if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-native-image-tools.png')});await page.locator('#sheet-treatment > summary').click();await page.locator('#pick-terrain').click();assert.equal(await page.locator('#asset-region').isVisible(),false);await page.locator('#sheet-preview').click({position:{x:5,y:5}});await until(async()=>!!(await local(page,'get_level')).assets.find(asset=>asset.id===sourceId).sheet?.terrain);assert.deepEqual((await local(page,'get_level')).assets.find(asset=>asset.id===sourceId).sheet.terrain,{x:0,y:0,tileSize:16});assert.equal(await page.locator('#terrain-region').isVisible(),true);assert.equal(await page.locator('#asset-region').isVisible(),false);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
test('browser: painted masks survive ZIP handoff and clip returned artwork at native pixels', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  const src=await png(8,8),mask={w:8,h:8,runs:Array.from({length:8},(_,y)=>y===3||y===4?[[y,0,3],[y,5,8]]:[[y,0,8]]).flat()},original={format:'max-level-studio',version:1,name:'Painted mask',spawn:{x:0,y:0},assets:[{id:'active',name:'Active',w:8,h:8,src},{id:'unused',name:'Unused',w:8,h:8,src}],objects:[{id:'paint',name:'Terrain',asset:'active',x:0,y:0,w:8,h:8,kind:'solid',role:'platform',mask}]},download=page.waitForEvent('download');
  const proof=await page.evaluate(async({original,src})=>{const {prepareArtwork,applyArtwork}=await import('/artwork.mjs'),{drawObject}=await import('/geometry.mjs'),{exportArtworkRequest}=await import('/io.mjs'),prepared=await prepareArtwork(original,{id:'browser-mask'}),applied=await applyArtwork(prepared.project,{requestId:'browser-mask',dataUrl:src}),image=new Image();image.src=src;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const ctx=canvas.getContext('2d');drawObject(ctx,applied.project.objects[0],image);const pixels=[...ctx.getImageData(0,0,8,8).data];exportArtworkRequest(prepared.project,prepared.request);return{pixels,mask:applied.project.objects[0].mask,refs:prepared.request.assetIds,map:prepared.request.map}}, {original,src});
  assert.deepEqual(proof.mask,mask);assert.deepEqual(proof.refs,['active']);for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.equal(proof.pixels[(y*8+x)*4+3],x>=3&&x<5&&y>=3&&y<5?0:255);
  const bundle=await download,stream=await bundle.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const bytes=Buffer.concat(chunks),entries=new Map();let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+18),nameLength=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+nameLength+extra;entries.set(bytes.subarray(at+30,at+30+nameLength).toString(),bytes.subarray(start,start+size));at=start+size}
  const manifest=JSON.parse(entries.get('request.json'));assert.deepEqual(manifest.objects[0].mask,mask);assert.deepEqual(entries.get('clownmap.png'),Buffer.from(proof.map.split(',')[1],'base64'));assert.equal([...entries.keys()].filter(name=>name.startsWith('references/')).length,1);assert.match(entries.get('PROMPT.txt').toString(),/invoke ChatGPT image generation/);assert.match(entries.get('PROMPT.txt').toString(),/erased holes/);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: naming, live GPT edits, reopen without duplicates, delete and restore', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await page.waitForTimeout(100)}throw Error('Browser state did not settle')};
 const cache=()=>page.evaluate(async()=>{const {ProjectCache}=await import('/autosave.mjs'),c=new ProjectCache();return{active:await c.active(),list:await c.list()}});
 try{
  await page.locator('#menu-button').click();await page.locator('#save').click();assert.match(await page.locator('#status').innerText(),/name before saving/);assert.equal((await cache()).list.length,0);assert.equal(h.requests.filter(r=>r.path==='/api/projects'&&r.method==='POST').length,0);
  await page.locator('#project-name').fill('Live project');await page.locator('#project-name').blur();await until(async()=>!!(await cache()).active?.token);const original=(await cache()).active;assert.equal(new URL(page.url()).hash,'');
  await page.locator('#agent-button').click();await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));await until(async()=>!!(await cache()).active?.roomToken);const endpoint=await page.locator('#agent-url').inputValue();await page.locator('#close-agent').click();
  const rpc=async(name,args={})=>(await(await page.request.post(endpoint,{data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}})).json()).result;
  const initial=(await rpc('get_level')).structuredContent;
  const edit=await rpc('edit_level',{revision:initial.revision,operations:[{type:'rename',name:'GPT live change'},{type:'block',id:'live-platform',x:0,y:0,width:80,height:16}]});assert.equal(edit.isError,undefined);
  await until(async()=>(await local(page,'get_level')).objects.some(o=>o.id==='live-platform'));assert.equal((await local(page,'get_level')).name,'GPT live change');await until(async()=>/^Live/.test(await page.locator('#sync-status').innerText()));
  await until(async()=>!(await cache()).active.dirty);await page.goto(new URL('/#project='+original.token,page.url()).href,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});await until(async()=>await page.evaluate(()=>!!window.pixelMillTools?.has('get_level')&&!document.querySelector('#app').inert));
  assert.equal(new URL(page.url()).hash,'');assert.equal((await cache()).active.id,original.id);assert.equal((await cache()).active.token,original.token);assert.equal((await cache()).list.length,1);assert.equal((await local(page,'get_level')).name,'GPT live change');
  await page.reload({waitUntil:'domcontentloaded'});await until(async()=>await page.evaluate(()=>!!window.pixelMillTools?.has('get_level')&&!document.querySelector('#app').inert));assert.equal(new URL(page.url()).hash,'');assert.equal((await cache()).active.id,original.id);assert.equal((await local(page,'get_level')).name,'GPT live change');
  await page.locator('#menu-button').click();await page.locator('#projects-button').click();await until(async()=>await page.locator('.project-row').count()===1);
  page.once('dialog',dialog=>dialog.accept());await page.locator('.project-delete').click();await until(async()=>await page.locator('.project-row').count()===0);assert.equal((await page.request.get(new URL('/api/projects/'+original.token,page.url()).href)).status(),410);
  await page.locator('#undo-project-delete').click();await until(async()=>await page.locator('.project-row').count()===1);assert.equal((await page.request.get(new URL('/api/projects/'+original.token,page.url()).href)).status(),200);assert.equal((await cache()).list[0].project.name,'GPT live change');assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
async function localArtwork(page,{id,mode,assetId,none=false}={}){
 // Await asynchronous IndexedDB reads explicitly; some Chromium/Playwright combinations
 // treat an async waitForFunction predicate's Promise itself as the truthy result.
 for(let attempt=0;attempt<100;attempt++){const ready=await page.evaluate(async({id,mode,assetId,none})=>{const {ProjectCache}=await import('/autosave.mjs'),record=await new ProjectCache().active();if(!record)return false;const objects=id?record.project.objects.filter(o=>o.id===id):record.project.objects;return objects.length>0&&objects.every(o=>none?!o.artwork:o.artwork&&(!mode||o.artwork.mode===mode)&&(!assetId||o.artwork.asset===assetId))},{id,mode,assetId,none});if(ready)return;await page.waitForTimeout(100)}throw Error('Artwork did not reach the local editor and recovery cache.');
}

test('browser: coherent artwork and existing sheets complete the round trip on the live editor', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  assert.ok((await page.locator('body').innerText()).length>0,'editor is not blank');
  assert.equal(await page.locator('[data-nextjs-dialog],.vite-error-overlay').count(),0);
  const empty=await local(page,'get_level');
  await local(page,'edit_level',{revision:empty.revision,operations:[
   {type:'block',id:'sky',name:'Background',x:0,y:0,width:160,height:96,kind:'decor',role:'background',color:'#6b9fe8'},
   {type:'block',id:'floor',name:'Walkable floor',x:16,y:80,width:128,height:16,kind:'solid',role:'platform',color:'#91e8c1'},
   {type:'block',id:'ledge',name:'Slanted ledge',x:32,y:42,width:32,height:16,rotation:15,kind:'platform',role:'platform',color:'#91e8c1'},
   {type:'block',id:'tree',name:'Decoration',x:112,y:48,width:16,height:32,kind:'decor',role:'decoration',color:'#f5a15c'},
   {type:'spawn',x:24,y:80}
  ]});
  let level=await local(page,'get_level');const imported=await local(page,'import_image',{revision:level.revision,name:'Terrain reference',dataUrl:await png(48,48,(x,y)=>[40+Math.floor(x/16)*70,60+Math.floor(y/16)*60,120,255])});
  const sheetId=imported.assetIds[0];level=await local(page,'get_level');
  await local(page,'edit_level',{revision:level.revision,operations:[{type:'asset',id:sheetId,changes:{selectedForGeneration:true,sheet:{tileSize:16,role:'platform'}}}]});
  const before=await savedProject(page),originalGeometry=geometry(before);
  // Use the actual Streamable HTTP room protocol, then observe it arrive in the editor.
  await page.locator('#menu-button').click();await page.locator('#agent-button').click();await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));
  await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));
  const endpoint=await page.locator('#agent-url').inputValue();await page.locator('#close-agent').click();
  const rpc=async(name,args={})=>{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(response.status,200);const result=(await response.json()).result;if(result.isError)throw Error(result.content[0].text);return result};
  level=value(await rpc('get_level'));
  const prepared=await rpc('prepare_artwork',{revision:level.revision,includeImages:true,prompt:'Keep the original level silhouette.'}),request=value(prepared).request;
  assert.deepEqual(request.assetIds,[sheetId]);assert.equal(request.objects.length,4);assert.equal(prepared.content.filter(c=>c.type==='image').length,2,'map and one reference travel together');
  const compact=await rpc('get_artwork_request',{requestId:request.id});assert.equal(compact.content.filter(c=>c.type==='image').length,0,'images are not repeated for metadata reads');
  const artwork=await png(request.width,request.height);
  const applied=value(await rpc('apply_artwork',{revision:value(prepared).revision,requestId:request.id,dataUrl:artwork,name:'Full level treatment'}));assert.equal(applied.geometryPreserved,true);
  await localArtwork(page,{mode:'atlas',assetId:applied.assetId});
  const full=await savedProject(page);assert.deepEqual(geometry(full),originalGeometry);assert.equal(full.assets.length,before.assets.length+1);assert.ok(full.objects.every(o=>o.artwork.asset===applied.assetId));assert.equal(full.artRequests.at(-1).status,'applied');
  await page.locator('#fit').click();if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-mobile-artwork.png')});
  await page.locator('#undo').click();await localArtwork(page,{none:true});assert.deepEqual(geometry(await savedProject(page)),originalGeometry);
  // Reapply only a selected region; edits to other shapes are allowed while generation runs.
  level=value(await rpc('get_level'));const regional=await rpc('prepare_artwork',{revision:level.revision,objectIds:['floor'],assetIds:[sheetId]});const region=value(regional).request;
  await rpc('edit_level',{revision:value(regional).revision,operations:[{type:'update',id:'tree',changes:{name:'Unrelated local edit'}}]});
  level=value(await rpc('get_level'));await rpc('apply_artwork',{revision:level.revision,requestId:region.id,dataUrl:await png(region.width,region.height)});
  await localArtwork(page,{id:'floor',mode:'atlas'});
  const regionalProject=await savedProject(page);assert.ok(regionalProject.objects.find(o=>o.id==='floor').artwork);assert.ok(regionalProject.objects.filter(o=>o.id!=='floor').every(o=>!o.artwork));assert.equal(regionalProject.objects.find(o=>o.id==='tree').name,'Unrelated local edit');assert.deepEqual(platforms(regionalProject.objects),originalGeometry.collision);
  // Existing sheets reuse their exact source, including automatic 3×3 terrain mapping.
  level=value(await rpc('get_level'));const reused=value(await rpc('apply_asset_sheet',{revision:level.revision,assetId:sheetId,tileSize:16}));assert.equal(reused.reusedSource,true);
  await localArtwork(page,{id:'floor',mode:'terrain'});
  const tiled=await savedProject(page);assert.equal(tiled.assets.length,regionalProject.assets.length,'sheet reuse creates no generated copies');assert.equal(tiled.objects.find(o=>o.id==='floor').artwork.asset,sheetId);assert.equal(tiled.objects.find(o=>o.id==='sky').artwork,undefined);assert.deepEqual(platforms(tiled.objects),originalGeometry.collision);
  // A stale target is rejected atomically and cannot relocate the authored geometry.
  level=value(await rpc('get_level'));const stale=await rpc('prepare_artwork',{revision:level.revision,objectIds:['floor']});const staleRequest=value(stale).request;
  await rpc('edit_level',{revision:value(stale).revision,operations:[{type:'update',id:'floor',changes:{x:20}}]});level=value(await rpc('get_level'));await assert.rejects(()=>rpc('apply_artwork',{revision:level.revision,requestId:staleRequest.id,dataUrl:artwork}),/sketch changed/i);
  assert.equal(value(await rpc('get_level')).revision,level.revision);
  assert.equal(h.requests.some(r=>r.path.includes('/responses')),false,'sheet reuse never calls a generation API');
  assert.deepEqual(h.errors,[],'no browser errors');
 }finally{await h.close()}
});

test('browser: a real externally generated PNG applies, exports, and undoes on its authored map', {skip:!process.env.PIXEL_MILL_BROWSER||!process.env.PIXEL_MILL_GENERATED_IMAGE,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  let level=await local(page,'get_level');
  await local(page,'edit_level',{revision:level.revision,operations:[
   {type:'block',id:'background',x:0,y:0,width:256,height:256,kind:'decor',role:'background',color:'#6b9fe8'},
   {type:'block',id:'ground',x:16,y:208,width:224,height:32,kind:'solid',role:'platform',color:'#91e8c1'},
   {type:'block',id:'lower-left',x:32,y:144,width:80,height:16,kind:'platform',role:'platform',color:'#91e8c1'},
   {type:'block',id:'middle-right',x:152,y:96,width:72,height:16,kind:'platform',role:'platform',color:'#91e8c1'},
   {type:'block',id:'upper-left',x:64,y:24,width:64,height:16,kind:'platform',role:'platform',color:'#91e8c1'},
   {type:'block',id:'decoration',x:184,y:176,width:24,height:32,kind:'decor',role:'decoration',color:'#f5a15c'},
   {type:'spawn',x:32,y:208}
  ]});
  if(process.env.PIXEL_MILL_REFERENCE_IMAGE){level=await local(page,'get_level');const imported=await local(page,'import_image',{revision:level.revision,dataUrl:dataURL(await fs.readFile(process.env.PIXEL_MILL_REFERENCE_IMAGE)),name:'Selected terrain reference'});level=await local(page,'get_level');await local(page,'edit_level',{revision:level.revision,operations:[{type:'asset',id:imported.assetIds[0],changes:{selectedForGeneration:true,sheet:{tileSize:16,role:'platform'}}}]})}
  const before=await savedProject(page);await page.locator('#fit').click();
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-genuine-before.png')});
  await page.locator('#menu-button').click();await page.locator('#agent-button').click();await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));const endpoint=await page.locator('#agent-url').inputValue();await page.locator('#close-agent').click();
  const rpc=async(name,args={})=>{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(response.status,200);const result=(await response.json()).result;if(result.isError)throw Error(result.content[0].text);return result};
  level=value(await rpc('get_level'));const prepared=await rpc('prepare_artwork',{revision:level.revision,includeImages:true}),request=value(prepared).request;assert.equal(request.width,256);assert.equal(request.height,256);assert.equal(request.objects.length,6);
  const actualGeneratedSource=dataURL(await fs.readFile(process.env.PIXEL_MILL_GENERATED_IMAGE));
  const applied=value(await rpc('apply_artwork',{revision:value(prepared).revision,requestId:request.id,dataUrl:actualGeneratedSource,name:'Genuine ChatGPT generated level'}));
  await localArtwork(page,{mode:'atlas',assetId:applied.assetId});const after=await savedProject(page);assert.deepEqual(geometry(after),geometry(before));assert.equal(after.assets.find(a=>a.id===applied.assetId).src,actualGeneratedSource);assert.equal(after.objects.filter(o=>o.artwork?.asset===applied.assetId).length,6);
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-genuine-after.png')});
  const exporting=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#export').click());const file=await exporting,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const archive=Buffer.concat(chunks);assert.deepEqual([...archive.subarray(0,4)],[80,75,3,4]);for(const entry of ['level.json','level.png','garden-geometry.json'])assert.ok(archive.includes(Buffer.from(entry)));
  await page.locator('#undo').click();await localArtwork(page,{none:true});const restored=await savedProject(page);assert.deepEqual(geometry(restored),geometry(before));assert.ok(restored.objects.every(o=>!o.artwork));assert.equal(restored.assets.length,before.assets.length);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: direct sketching, asset references, connected artwork handoff and returned-file application work through mobile controls', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  assert.equal(await page.getByRole('tab').count(),0);assert.equal(await page.locator('#block-color').isVisible(),false);
  for(const [role,from,to] of [['background',[75,230],[290,420]],['platform',[80,460],[285,495]]]){
   await page.locator('#sketch-color').click();assert.equal(await page.locator('#block-color').isVisible(),true);await page.locator(`#semantic-colors [data-role="${role}"]`).click();assert.equal(await page.locator('#block-color').isVisible(),false);
   await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:5});await page.mouse.up();
  }
  let level=await local(page,'get_level');assert.equal(level.objects.length,2);assert.equal(level.objects[0].role,'background');assert.equal(level.objects[0].kind,'decor');assert.equal(level.objects[1].role,'platform');assert.equal(level.objects[1].kind,'solid');
  assert.equal(await page.locator('[data-tool="paint"]').getAttribute('aria-pressed'),'true','drawing stays active after each shape');assert.ok(level.objects.every(o=>o.mask?.runs.length),'semantic strokes retain their painted masks');
  const chooser=page.waitForEvent('filechooser');await page.locator('#import-button').click();assert.equal(await page.locator('#import-dialog,#import-kind,#import-cell-size').count(),0);
  const sheet=await png(48,48,(x,y)=>[60+Math.floor(x/16)*50,95+Math.floor(y/16)*45,100,255]);await(await chooser).setFiles({name:'Exact terrain.png',mimeType:'image/png',buffer:Buffer.from(sheet.split(',')[1],'base64')});await page.waitForFunction(()=>document.querySelectorAll('#sheet-grid .sheet-card-preview').length===1);await page.locator('#assets').waitFor({state:'visible'});await page.locator('.sheet-card-preview').waitFor();
  assert.equal(await page.locator('#assets-workspace,#workspace-tabs,#assets-tab,#level-tab').count(),0);assert.equal(await page.locator('#toolbar').isVisible(),true);assert.equal(await page.locator('.sheet-card-preview').count(),1,'whole sheet is retained');
  const wasSelected=await page.locator('.sheet-reference').getAttribute('aria-pressed');await page.locator('.sheet-reference').click();await page.waitForFunction(previous=>document.querySelector('.sheet-reference')?.getAttribute('aria-pressed')!==previous,wasSelected);if(wasSelected==='true'){await page.locator('.sheet-reference').click();await page.waitForFunction(()=>document.querySelector('.sheet-reference')?.getAttribute('aria-pressed')==='true')}await page.locator('.sheet-card-preview').click();assert.equal(await page.locator('#sheet-tile-size').inputValue(),'16');
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-assets-mobile.png')});
  const exportSheet=page.waitForEvent('download');await page.locator('#export-sheet').click();assert.match((await exportSheet).suggestedFilename(),/\.png$/);
  await page.locator('#apply-sheet').click();await page.waitForFunction(()=>document.querySelector('#sheet-detail').hidden);level=await local(page,'get_level');assert.equal(level.objects.find(o=>o.role==='platform').artwork.mode,'terrain');assert.equal(level.objects.find(o=>o.role==='background').artwork,undefined);
  await page.locator('#artwork-menu > summary').click();await page.locator('#treatment-scope').click();await savedProject(page);let handoffDownloads=0;const onDownload=()=>handoffDownloads++;page.on('download',onDownload);await page.locator('#prepare-artwork').click();await page.waitForFunction(()=>document.querySelector('#artwork-status').dataset.state==='waiting');assert.equal(handoffDownloads,0);assert.equal(await page.locator('dialog[open]').count(),0);page.off('download',onDownload);const snapshot=await savedProject(page),request=snapshot.artRequests.at(-1);assert.equal(request.objects.length,2);assert.equal(request.assetIds.length,1);assert.equal(await page.locator('#apply-artwork').isEnabled(),true);
  const source=await png(request.width,request.height);await page.locator('#artwork-file').setInputFiles({name:request.id+'.png',mimeType:'image/png',buffer:Buffer.from(source.split(',')[1],'base64')});await localArtwork(page,{mode:'atlas'});
  const applied=await savedProject(page);assert.deepEqual(geometry(applied),geometry(snapshot));
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.waitForFunction(()=>Math.abs(document.getElementById('app').getBoundingClientRect().width-innerWidth)<1);if(!await page.locator('#artwork-menu').evaluate(el=>el.open))await page.locator('#artwork-menu > summary').click();const issue=await page.evaluate(()=>{for(const id of ['import-button','sketch-color','prepare-artwork','apply-selected-sheets']){const el=document.getElementById(id),r=el.getBoundingClientRect();if(r.left<0||r.top<0||r.right>innerWidth+.5||r.bottom>innerHeight+.5)return id+' is outside viewport: '+JSON.stringify({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight});const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(hit!==el&&!el.contains(hit))return id+' is obscured by '+hit?.id}return null});assert.equal(issue,null,`${viewport.width}×${viewport.height}: ${issue}`);
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
