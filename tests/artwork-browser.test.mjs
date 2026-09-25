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
import {encodePNG,dataURL} from '../dist/png.mjs';
import {platforms} from '../dist/engine.mjs';

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
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const result=await agentFetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return}
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
test('browser: naming, live GPT edits, reopen without duplicates, delete and restore', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await page.waitForTimeout(100)}throw Error('Browser state did not settle')};
 const cache=()=>page.evaluate(async()=>{const {ProjectCache}=await import('/autosave.mjs'),c=new ProjectCache();return{active:await c.active(),list:await c.list()}});
 try{
  await page.locator('#menu-button').click();await page.locator('#save').click();assert.match(await page.locator('#status').innerText(),/name before saving/);assert.equal((await cache()).list.length,0);assert.equal(h.requests.filter(r=>r.path==='/api/projects'&&r.method==='POST').length,0);
  await page.locator('#project-name').fill('Live project');await page.locator('#project-name').blur();await until(async()=>!!(await cache()).active?.token);const original=(await cache()).active;
  await page.locator('#agent-button').click();await page.locator('#agent-connect').click();await until(async()=>!!(await cache()).active?.roomToken);const endpoint=await page.locator('#agent-url').inputValue();await page.locator('#close-agent').click();
  const rpc=async(name,args={})=>(await(await page.request.post(endpoint,{data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}})).json()).result;
  const initial=(await rpc('get_level')).structuredContent;
  const edit=await rpc('edit_level',{revision:initial.revision,operations:[{type:'rename',name:'GPT live change'},{type:'block',id:'live-platform',x:0,y:0,width:80,height:16}]});assert.equal(edit.isError,undefined);
  await until(async()=>(await local(page,'get_level')).objects.some(o=>o.id==='live-platform'));assert.equal((await local(page,'get_level')).name,'GPT live change');await until(async()=>/^Live/.test(await page.locator('#sync-status').innerText()));
  await until(async()=>!(await cache()).active.dirty);await page.reload({waitUntil:'domcontentloaded'});await until(async()=>await page.evaluate(()=>!!window.pixelMillTools?.has('get_level')&&!document.querySelector('#app').inert));
  assert.equal((await cache()).active.id,original.id);assert.equal((await cache()).list.length,1);assert.equal((await local(page,'get_level')).name,'GPT live change');
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
  await page.locator('#menu-button').click();await page.locator('#agent-button').click();await page.locator('#agent-connect').click();
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
  await page.locator('#menu-button').click();await page.locator('#agent-button').click();await page.locator('#agent-connect').click();await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));const endpoint=await page.locator('#agent-url').inputValue();await page.locator('#close-agent').click();
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

test('browser: direct sketching, asset references, ZIP handoff and returned-file application work through mobile controls', {skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await browserHarness(),{page}=h;
 try{
  assert.equal(await page.getByRole('tab').count(),2);assert.equal(await page.locator('#block-color').isVisible(),false);
  for(const [role,from,to] of [['background',[75,230],[290,420]],['platform',[80,460],[285,495]]]){
   await page.locator('#sketch-color').click();assert.equal(await page.locator('#block-color').isVisible(),true);await page.locator(`#semantic-colors [data-role="${role}"]`).click();assert.equal(await page.locator('#block-color').isVisible(),false);
   await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:5});await page.mouse.up();
  }
  let level=await local(page,'get_level');assert.equal(level.objects.length,2);assert.equal(level.objects[0].role,'background');assert.equal(level.objects[0].kind,'decor');assert.equal(level.objects[1].role,'platform');assert.equal(level.objects[1].kind,'solid');
  assert.equal(await page.locator('[data-tool="block"]').getAttribute('aria-pressed'),'true','drawing stays active after each shape');
  await page.locator('#import-button').click();assert.equal(await page.locator('#import-dialog').isVisible(),true);assert.equal(await page.locator('#import-kind').inputValue(),'sheet');assert.equal(await page.locator('#import-cell-size').count(),0);
  const sheet=await png(48,48,(x,y)=>[60+Math.floor(x/16)*50,95+Math.floor(y/16)*45,100,255]);await page.locator('#files').setInputFiles({name:'Exact terrain.png',mimeType:'image/png',buffer:Buffer.from(sheet.split(',')[1],'base64')});await page.locator('.sheet-card-preview').waitFor();
  assert.equal(await page.locator('#assets-tab').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#toolbar').isVisible(),false);assert.equal(await page.locator('.sheet-card-preview').count(),1,'whole sheet is retained');
  const wasSelected=await page.locator('.sheet-reference').getAttribute('aria-pressed');await page.locator('.sheet-reference').click();await page.waitForFunction(previous=>document.querySelector('.sheet-reference')?.getAttribute('aria-pressed')!==previous,wasSelected);if(wasSelected==='true'){await page.locator('.sheet-reference').click();await page.waitForFunction(()=>document.querySelector('.sheet-reference')?.getAttribute('aria-pressed')==='true')}await page.locator('.sheet-card-preview').click();assert.equal(await page.locator('#sheet-tile-size').inputValue(),'16');
  if(process.env.PIXEL_MILL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PIXEL_MILL_SCREENSHOTS,'pixel-mill-assets-mobile.png')});
  const exportSheet=page.waitForEvent('download');await page.locator('#export-sheet').click();assert.match((await exportSheet).suggestedFilename(),/\.png$/);
  await page.locator('#apply-sheet').click();await page.waitForFunction(()=>document.querySelector('#level-tab').getAttribute('aria-selected')==='true');level=await local(page,'get_level');assert.equal(level.objects.find(o=>o.role==='platform').artwork.mode,'terrain');assert.equal(level.objects.find(o=>o.role==='background').artwork,undefined);
  await page.locator('#treatment-scope').click();const handoff=page.waitForEvent('download');await page.locator('#prepare-artwork').click();const bundle=await handoff;assert.match(bundle.suggestedFilename(),/\.zip$/);const snapshot=await savedProject(page),request=snapshot.artRequests.at(-1);assert.equal(request.objects.length,2);assert.equal(request.assetIds.length,1);assert.equal(await page.locator('#apply-artwork').isEnabled(),true);
  const source=await png(request.width,request.height);await page.locator('#artwork-file').setInputFiles({name:request.id+'.png',mimeType:'image/png',buffer:Buffer.from(source.split(',')[1],'base64')});await localArtwork(page,{mode:'atlas'});
  const applied=await savedProject(page);assert.deepEqual(geometry(applied),geometry(snapshot));
  for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
   await page.setViewportSize(viewport);await page.waitForFunction(()=>Math.abs(document.getElementById('app').getBoundingClientRect().width-innerWidth)<1);const issue=await page.evaluate(()=>{for(const id of ['level-tab','assets-tab','import-button','sketch-color','prepare-artwork','apply-selected-sheets']){const el=document.getElementById(id),r=el.getBoundingClientRect();if(r.left<0||r.top<0||r.right>innerWidth+.5||r.bottom>innerHeight+.5)return id+' is outside viewport: '+JSON.stringify({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight});const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(hit!==el&&!el.contains(hit))return id+' is obscured by '+hit?.id}return null});assert.equal(issue,null,`${viewport.width}×${viewport.height}: ${issue}`);
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
