import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {agentFetch} from '../worker/api.mjs';
import {patchSourceHash} from '../dist/agent.mjs';
import {validateProject} from '../dist/engine.mjs';
import {encodePNG,decodePNG,dataURL,pngBytes} from '../dist/png.mjs';

class EditBucket{
 constructor(){this.records=new Map();this.version=0}
 async get(key){const value=this.records.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null}
 async put(key,text,{onlyIf}={}){const previous=this.records.get(key);if(onlyIf?.etagMatches&&previous?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&previous)return null;const etag=String(++this.version);this.records.set(key,{text,etag});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.records.delete(key)}
}
async function session(t,project){
 const env={BUCKET:new EditBucket()},server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const result=await agentFetch(new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()))}catch{res.writeHead(500);res.end('Test service failed.')}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body)=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,value:await response.json()}};
 const opened=await call('/api/rooms','POST',project),token=opened.value.token;let id=0;
 return{call,token,read:async()=>(await call('/api/rooms/'+token)).value,tool:async(name,args={})=>(await call('/mcp/'+token,'POST',{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})).value.result};
}
async function fixture(transparent=false){const w=24,h=10,pixels=new Uint8Array(w*h*4);if(!transparent)pixels.fill(255);for(const [left,color]of [[2,[20,40,60,87]],[14,[60,90,120,255]]])for(let y=2;y<5;y++)for(let x=left;x<left+6;x++)pixels.set(color,(y*w+x)*4);const src=dataURL(await encodePNG({w,h,pixels}));return validateProject({format:'max-level-studio',version:1,name:'HTTP asset edit',spawn:{x:0,y:0},assets:[{id:'image',name:'Image',w,h,src}],objects:[{id:'placed',name:'Placed',asset:'image',x:12,y:24,w,h,kind:'decor'}]})}

test('HTTP image editing keeps stable instances, rejects stale sources, preserves no-op revisions, and saves undo/redo sources',async t=>{
 const original=await fixture(),{tool,read,call,token}=await session(t,original),descriptor=(await call('/mcp/'+token,'POST',{jsonrpc:'2.0',id:'list',method:'tools/list'})).value.result.tools.find(value=>value.name==='edit_asset_image');assert.ok(descriptor);assert.equal(descriptor.inputSchema.properties.sourceHash.pattern,'^[a-f0-9]{64}$');
 let result=await tool('edit_asset_image',{revision:0,assetId:'image',action:'remove_background',sourceHash:patchSourceHash(original.assets[0].src),includeImage:true});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.revision,1);assert.equal(result.content[1].type,'image');const edited=(await read()).project;assert.equal(edited.assets.length,2);assert.equal(edited.assets[0].id,'image');assert.equal(edited.assets[1].src,original.assets[0].src);assert.equal(edited.assets[1].hidden,true);assert.deepEqual(edited.objects,original.objects);const pixels=await decodePNG(pngBytes(edited.assets[0].src));assert.deepEqual([...pixels.pixels.subarray((2*24+2)*4,(2*24+2)*4+4)],[20,40,60,87]);
 result=await tool('edit_asset_image',{revision:1,assetId:'image',action:'segment',sourceHash:patchSourceHash(original.assets[0].src)});assert.equal(result.isError,true);assert.match(result.content[0].text,/source image changed/);assert.deepEqual((await read()).project,edited);
 result=await tool('edit_asset_image',{revision:1,assetId:'image',action:'remove_background'});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.changed,false);assert.equal(result.structuredContent.revision,1);assert.deepEqual((await read()).project,edited);
 const saved=await call('/api/projects','POST',{roomToken:token});assert.equal(saved.status,201);assert.deepEqual((await call('/api/projects/'+saved.value.token)).value.project,edited);
 result=await tool('undo_level',{revision:saved.value.revision});assert.equal(result.isError,undefined);assert.deepEqual((await read()).project,original);result=await tool('redo_level',{revision:result.structuredContent.revision});assert.equal(result.isError,undefined);assert.deepEqual((await read()).project,edited);
});

test('HTTP segmentation crops the selected component once and retains every original source pixel',async t=>{
 const original=await fixture(true),{tool,read}=await session(t,original),result=await tool('edit_asset_image',{revision:0,assetId:'image',action:'segment',rect:{x:0,y:0,w:24,h:8},point:{x:15,y:3},sourceHash:patchSourceHash(original.assets[0].src)});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.revision,1);assert.equal(result.structuredContent.parts.length,1);assert.deepEqual(result.structuredContent.parts[0],{assetId:result.structuredContent.assetIds[0],x:14,y:2,w:6,h:3,area:18});const edited=(await read()).project;assert.deepEqual(edited.assets[0],original.assets[0]);assert.equal(edited.assets.length,2);assert.deepEqual(edited.objects,original.objects);await tool('undo_level',{revision:1});assert.deepEqual((await read()).project,original);
});
