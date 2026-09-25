// PIXEL_MILL_BROWSER=1 node --test tests/collections-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {agentFetch} from '../worker/api.mjs';
import {encodePNG,decodePNG,dataURL} from '../dist/png.mjs';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
class Bucket{
 constructor(){this.items=new Map();this.version=0}
 async get(key){const item=this.items.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.text)}:null}
 async put(key,text,{onlyIf}={}){const old=this.items.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.items.set(key,{etag,text});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.items.delete(key)}
}
async function harness(){
 const require=createRequire(import.meta.url);let chromium;
 try{({chromium}=require('playwright'))}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')))}
 const env={BUCKET:new Bucket()},server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const result=await agentFetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return}
  const filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!filename.startsWith(root))throw Error('Invalid path');res.setHeader('content-type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');res.end(await fs.readFile(filename));
 }catch(error){res.statusCode=500;res.end(error.message)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']})}catch(error){server.close();throw error}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,acceptDownloads:true});
 await context.addInitScript(()=>{window.pixelMillTools=new Map();Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool:tool=>window.pixelMillTools.set(tool.name,tool)}})});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.pixelMillTools.has('group_workspace_sprites')&&!document.getElementById('app').inert);
 return{page,errors,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve))}};
}
async function rawTool(page,name,args={}){return page.evaluate(async({name,args})=>window.pixelMillTools.get(name).execute(args),{name,args})}
const value=result=>result.structuredContent||result;
async function tool(page,name,args={}){return value(await rawTool(page,name,args))}
async function mutate(page,name,args={}){const {revision}=await tool(page,'get_level');return tool(page,name,{...args,revision})}
async function project(page){const level=await tool(page,'get_level');if(level.name==='Untitled')await mutate(page,'edit_level',{operations:[{type:'rename',name:'Browser collection test'}]});const pending=page.waitForEvent('download');await page.evaluate(()=>document.getElementById('save').click());const file=await pending,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString())}
async function imageOf(page,assetId){const response=await rawTool(page,'get_asset_image',{id:assetId}),image=response.content.find(c=>c.type==='image');assert.ok(image);return decodePNG(Buffer.from(image.data,'base64'))}
function region(image,x,y,w,h){const pixels=new Uint8Array(w*h*4);for(let row=0;row<h;row++)pixels.set(image.pixels.subarray(((y+row)*image.w+x)*4,((y+row)*image.w+x+w)*4),row*w*4);return pixels}
async function sourcePNG(index){const pixels=new Uint8Array(16*16*4);if(index!==3){for(let y=4;y<12;y++)for(let x=3;x<10;x++)pixels.set([60+index*60,130,80,255],(y*16+x)*4);if(index===2)pixels.set([60,170,255,255],(14*16+13)*4)}return{pixels,src:dataURL(await encodePNG({w:16,h:16,pixels}))}}
async function workspaceFixture(page){
 const originals=[];for(let index=0;index<4;index++){const source=await sourcePNG(index),result=await mutate(page,'import_image',{name:['Walk A','Walk B','Watering droplets','Empty hold'][index],dataUrl:source.src});originals.push({id:result.assetIds[0],...source})}
 const ordered=[['a-first',0,0,0],['b',1,16,0],['a-repeat',0,32,0],['droplets',2,0,16],['empty',3,32,16]];
 await mutate(page,'edit_level',{operations:[4,1,3,2,0].map(i=>{const [id,index,x,y]=ordered[i];return{type:'place',id,assetId:originals[index].id,x,y,width:16,height:16,kind:'decor'}})});
 const before=await project(page);const result=await mutate(page,'group_workspace_sprites',{objectIds:['empty','b','droplets','a-repeat','a-first'],cellWidth:16,cellHeight:16,sheetType:'character',name:'Existing character collection'});
 const grouped=await project(page),parent=grouped.assets.find(a=>!before.assets.some(source=>source.id===a.id));assert.ok(parent,'grouping adds a virtual parent');return{originals,before,grouped,parent,result};
}
async function waitFor(page,read,predicate){for(let attempt=0;attempt<100;attempt++){const result=await read();if(predicate(result))return result;await page.waitForTimeout(50)}throw Error('Collection operation did not finish.');}

test('browser: workspace collection preserves sparse spatial frames, source pixels, edits and reversible grouping',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await harness(),{page}=h;
 try{
  const {originals,before,grouped,parent}=await workspaceFixture(page),meta=parent.spriteSheet;
  assert.equal(parent.src,undefined,'a collection does not copy raster payloads');assert.equal(grouped.assets.filter(a=>a.src).length,4);assert.deepEqual(grouped.assets.filter(a=>a.id!==parent.id),before.assets);assert.deepEqual(grouped.objects,before.objects);
  assert.equal(meta.source,'assets');assert.deepEqual([meta.cols,meta.rows,meta.frames.length],[3,2,6]);assert.deepEqual(meta.groups.map(g=>g.frameIds.length),[3,3]);
  const byPosition=(row,col)=>meta.frames.find(f=>f.row===row&&f.col===col);assert.equal(byPosition(0,0).sourceAssetId,originals[0].id);assert.equal(byPosition(0,2).sourceAssetId,originals[0].id);assert.equal(byPosition(1,1).sourceAssetId,undefined);assert.equal(byPosition(1,1).empty,true);assert.equal(byPosition(1,2).sourceAssetId,originals[3].id);assert.equal(byPosition(1,2).empty,true,'transparent source frames retain their identity and empty timing slot');
  const rendered=await imageOf(page,parent.id);assert.deepEqual([rendered.w,rendered.h],[48,32]);for(const [row,col,index] of [[0,0,0],[0,1,1],[0,2,0],[1,0,2],[1,2,3]])assert.deepEqual(region(rendered,col*16,row*16,16,16),originals[index].pixels);assert.deepEqual(region(rendered,16,16,16,16),new Uint8Array(16*16*4));
  assert.deepEqual([...region(rendered,13,30,1,1)],[60,170,255,255],'a detached watering droplet is retained at its original cell offset');
  await page.locator('#assets-tab').click();await page.locator('.sheet-card-preview').waitFor();assert.equal(await page.locator('.sheet-card-preview').count(),1,'the collection is one card instead of loose sources');await page.locator('.sheet-card-preview').click();await page.waitForFunction(()=>document.querySelectorAll('.sprite-group').length===2);
  // Source changes must invalidate both the virtual raster and its browser preview cache.
  const updated=structuredClone(grouped),replacement=await sourcePNG(4);updated.assets.find(a=>a.id===originals[0].id).src=replacement.src;
  await page.locator('#project-file').setInputFiles({name:'updated-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(updated))});
  for(let attempt=0;attempt<80;attempt++){const p=await tool(page,'get_level');if(p.assets?.find(a=>a.id===parent.id)){const current=await imageOf(page,parent.id);if(Buffer.from(region(current,0,0,16,16)).equals(Buffer.from(replacement.pixels)))break}if(attempt===79)throw Error('Virtual parent did not refresh from its retained source.');await page.waitForTimeout(50)}
  const current=await imageOf(page,parent.id);assert.deepEqual(region(current,0,0,16,16),replacement.pixels);assert.deepEqual(region(current,32,0,16,16),replacement.pixels);
  const preview=await waitFor(page,()=>page.locator('.sheet-card-preview img').evaluate(image=>{if(!image.complete||!image.naturalWidth)return null;const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const context=c.getContext('2d');context.drawImage(image,0,0);return[...context.getImageData(3,4,1,1).data]}),pixels=>pixels?.[0]===300%256);assert.deepEqual(preview,[44,130,80,255],'the visible collection preview refreshes after source edits');
  const preUngroup=await project(page);await page.locator('#ungroup-sheet').click();await page.waitForFunction(()=>document.querySelectorAll('.sheet-card-preview').length===4);const ungrouped=await project(page);assert.deepEqual(ungrouped.assets,preUngroup.assets.filter(a=>a.id!==parent.id));assert.deepEqual(ungrouped.objects,preUngroup.objects);
  await page.locator('#assets-undo').click();await page.waitForFunction(()=>document.querySelectorAll('.sheet-card-preview').length===1);const restored=await project(page);assert.deepEqual(restored.assets,preUngroup.assets);assert.deepEqual(restored.objects,preUngroup.objects);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: scoped collection generation replaces only target frames and retains editable originals',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:90000},async()=>{
 const h=await harness(),{page}=h;
 try{
  const {originals,parent}=await workspaceFixture(page),targetGroup=parent.spriteSheet.groups[1],referenceFrame=parent.spriteSheet.groups[0].frameIds[0];
  await page.locator('#assets-tab').click();await page.locator('.sheet-card-preview').click();await page.getByRole('button',{name:'Open row-01 frames',exact:true}).click();await page.locator(`[data-frame="${referenceFrame}"]`).click();await page.getByRole('button',{name:'Use current sprite selection as reference',exact:true}).click();
  await waitFor(page,()=>tool(page,'get_level',{mode:'full'}),p=>p.assets?.find(a=>a.id===parent.id)?.referenceSelection?.frameIds?.[0]===referenceFrame);
  const before=await project(page);await page.getByRole('button',{name:'Select the whole sprite sheet',exact:true}).click();await page.getByRole('checkbox',{name:'Select group row-02',exact:true}).check();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Send current sprite selection to ChatGPT',exact:true}).click();assert.match((await pending).suggestedFilename(),/\.zip$/);const prepared=await project(page),requestId=prepared.assetRequests.at(-1).id,request=(await tool(page,'get_asset_artwork_request',{requestId,includeImages:true})).request;
  assert.deepEqual(request.target.frameIds,targetGroup.frameIds);assert.equal(request.placements.length,3);assert.equal(request.references.length,1);assert.deepEqual([request.references[0].w,request.references[0].h],[16,16],'the reference is one chosen frame, not the full character sheet');
  const pixels=new Uint8Array(request.width*request.height*4);for(let i=0;i<pixels.length;i+=4)pixels.set([205,90,160,255],i);const generated=dataURL(await encodePNG({w:request.width,h:request.height,pixels}));
  await page.getByLabel('Returned sprite artwork',{exact:true}).setInputFiles({name:request.id+'.png',mimeType:'image/png',buffer:Buffer.from(generated.split(',')[1],'base64')});await waitFor(page,()=>tool(page,'inspect_sprite_sheet',{assetId:parent.id,includeFrames:true}),p=>p.spriteSheet?.frames.filter(f=>targetGroup.frameIds.includes(f.id)).every(f=>f.artwork));const after=await project(page),changed=after.assets.find(a=>a.id===parent.id),targetIds=new Set(targetGroup.frameIds);
  assert.deepEqual(after.objects,before.objects);for(const source of originals)assert.equal(after.assets.find(a=>a.id===source.id).src,source.src);assert.equal(changed.src,undefined);assert.deepEqual(changed.spriteSheet.groups,parent.spriteSheet.groups);
  for(const frame of changed.spriteSheet.frames){const original=parent.spriteSheet.frames.find(f=>f.id===frame.id);if(targetIds.has(frame.id)){assert.ok(frame.artwork);const {artwork,...retained}=frame;assert.deepEqual(retained,original)}else assert.deepEqual(frame,original)}
  const flattened=await imageOf(page,parent.id);assert.deepEqual(region(flattened,0,0,16,16),originals[0].pixels);assert.deepEqual([...region(flattened,1,17,1,1)],[205,90,160,255]);
  const generatedAssets=after.assets.filter(a=>!before.assets.some(source=>source.id===a.id));assert.equal(generatedAssets.length,1);assert.equal(generatedAssets[0].hidden,true,'replacement pixels remain an editable child source');
  await page.locator('#assets-undo').click();await waitFor(page,()=>tool(page,'inspect_sprite_sheet',{assetId:parent.id,includeFrames:true}),p=>p.spriteSheet?.frames.every(f=>!f.artwork));const undone=await project(page);assert.deepEqual(undone.assets,before.assets);assert.deepEqual(undone.objects,before.objects);
  assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});

test('browser: Group selected collects existing asset cards in one undo step without raster copies',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:60000},async()=>{
 const h=await harness(),{page}=h;
 try{
  for(let index=0;index<3;index++){const source=await sourcePNG(index);await mutate(page,'import_image',{name:'Existing frame '+index,dataUrl:source.src})}
  await page.locator('#assets-tab').click();assert.equal(await page.locator('.sheet-card-preview').count(),3);
  for(let index=0;index<3;index++){const choice=page.locator('.sheet-reference').nth(index);if(await choice.getAttribute('aria-pressed')!=='true'){await choice.click();await waitFor(page,()=>choice.getAttribute('aria-pressed'),value=>value==='true')}}
  const before=await project(page);await page.locator('#create-sheet').click();await page.waitForFunction(()=>document.querySelectorAll('.sheet-card-preview').length===1);const after=await project(page),parent=after.assets.find(a=>!before.assets.some(source=>source.id===a.id));assert.ok(parent);assert.equal(parent.spriteSheet.source,'assets');assert.equal(parent.src,undefined);assert.equal(after.assets.length,4);for(const original of before.assets)assert.deepEqual(after.assets.find(a=>a.id===original.id),original);
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelectorAll('.sheet-card-preview').length===3);assert.deepEqual((await project(page)).assets,before.assets);assert.deepEqual(h.errors,[]);
 }finally{await h.close()}
});
