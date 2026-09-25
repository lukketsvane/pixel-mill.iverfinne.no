import test from 'node:test';
import assert from 'node:assert/strict';
import {agentFetch} from '../worker/api.mjs';
import {editProject,projectDiff,applyDiff} from '../dist/agent.mjs';
import {encodePNG,decodePNG,dataURL,pngBytes} from '../dist/png.mjs';
class Bucket{constructor(){this.data=new Map();this.version=0}async get(key){const o=this.data.get(key);return o?{etag:o.etag,json:async()=>JSON.parse(o.text)}:null}async put(key,text,options={}){const old=this.data.get(key),condition=options.onlyIf;if(condition?.etagMatches&&old?.etag!==condition.etagMatches||condition?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.data.set(key,{text,etag});return{etag}}async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.data.delete(k)}}
const base={format:'max-level-studio',version:1,name:'Room',spawn:{x:0,y:0},assets:[],objects:[]};
test('MCP Streamable HTTP handshake, reads, atomic edits, stale revisions, undo, preview and revocation',async()=>{
 const env={BUCKET:new Bucket()},origin='https://pixel.example';const call=async(path,method='GET',data,headers={})=>agentFetch(new Request(origin+path,{method,headers:{'content-type':'application/json',origin,...headers},body:data?JSON.stringify(data):undefined}),env);
 const created=await call('/api/rooms','POST',base);assert.equal(created.status,201);const room=await created.json(),url='/mcp/'+room.token;let id=0;const rpc=async(method,params)=>{const r=await call(url,'POST',{jsonrpc:'2.0',id:++id,method,params},{Accept:'application/json, text/event-stream'});return(await r.json()).result};
 const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});assert.equal(init.protocolVersion,'2025-06-18');assert.ok(init.capabilities.tools);
 const list=await rpc('tools/list');assert.ok(list.tools.some(t=>t.name==='edit_level'));assert.equal((await call(url)).status,405);
 let info=await rpc('tools/call',{name:'get_level'});assert.equal(info.structuredContent.revision,0);assert.equal(info.structuredContent.movement,undefined);assert.equal(info.structuredContent.coordinates,undefined);
 let result=await rpc('tools/call',{name:'edit_level',arguments:{revision:0,verify:true,operations:[{type:'block',id:'floor',x:-100,y:0,width:200,height:12},{type:'spawn',x:0,y:0}]}});assert.equal(result.structuredContent.revision,1);assert.deepEqual(result.structuredContent.changedIds,['floor']);assert.equal(result.structuredContent.objects.length,1);assert.equal(result.structuredContent.assets,undefined);
 result=await rpc('tools/call',{name:'edit_level',arguments:{revision:0,operations:[{type:'delete',ids:['floor']}]}});assert.equal(result.isError,true);
 result=await rpc('tools/call',{name:'edit_level',arguments:{revision:1,operations:[{type:'rename',name:'bad'},{type:'update',id:'missing',changes:{x:1}}]}});assert.equal(result.isError,true);info=await rpc('tools/call',{name:'get_level'});assert.equal(info.structuredContent.name,'Room');assert.equal(info.structuredContent.revision,1);
 const full=await rpc('tools/call',{name:'get_level',arguments:{mode:'full'}});assert.ok(full.structuredContent.movement);assert.equal(full.structuredContent.objects[0].id,'floor');
 result=await rpc('tools/call',{name:'simulate_player',arguments:{route:[{seconds:.5,axis:1,run:true}]}});assert.ok(result.structuredContent.end.x>30);assert.equal(result.structuredContent.end.grounded,true);
 const bad=await call(url,'POST',{jsonrpc:'2.0',id:1,method:'tools/list'},{origin:'https://evil.example'});assert.equal(bad.status,403);
 result=await rpc('tools/call',{name:'undo_level',arguments:{revision:1}});assert.equal(result.structuredContent.objects.length,0);assert.equal(result.structuredContent.revision,2);
 const fresh=await call('/api/rooms/'+room.token+'?revision=2');assert.equal(fresh.status,304);
 const preview=await call('/api/rooms/'+room.token+'/preview','POST',{revision:2,src:'data:image/png;base64,aGVsbG8='});assert.equal(preview.status,200);result=await rpc('tools/call',{name:'get_canvas_preview'});assert.equal(result.content[1].type,'image');
 await call('/api/rooms/'+room.token,'DELETE');assert.equal((await call(url,'POST',{jsonrpc:'2.0',id:1,method:'tools/list'})).status,410);
});
test('human and agent edits merge on different pieces and conflict on the same piece',()=>{let state=editProject(base,[{type:'block',id:'a',x:0,y:0},{type:'block',id:'b',x:80,y:0}]);const human=editProject(state,[{type:'update',id:'a',changes:{x:8}}]),agent=editProject(state,[{type:'update',id:'b',changes:{rotation:45}}]);const merged=applyDiff(agent,projectDiff(state,human));assert.equal(merged.objects[0].x,8);assert.equal(merged.objects[1].rotation,45);const clash=editProject(state,[{type:'update',id:'a',changes:{x:12}}]);assert.throws(()=>applyDiff(clash,projectDiff(state,human)),/Conflict/)});

test('layer changes, crop, opacity and locks survive agent edits and undo',()=>{let p=editProject(base,[{type:'block',id:'a'},{type:'block',id:'b'},{type:'block',id:'c'}]);const moved=editProject(p,[{type:'order',id:'a',direction:'front'},{type:'update',id:'a',changes:{opacity:.4,locked:true}}]);assert.deepEqual(moved.objects.map(o=>o.id),['b','c','a']);const merged=applyDiff(p,projectDiff(p,moved));assert.deepEqual(merged,moved);assert.deepEqual(applyDiff(merged,projectDiff(moved,p)),p);assert.throws(()=>editProject(moved,[{type:'update',id:'a',changes:{x:5}}]),/Unlock/);const deleted=editProject(p,[{type:'delete',ids:['b']}]);assert.deepEqual(applyDiff(deleted,projectDiff(deleted,p)),p);const concurrent=editProject(p,[{type:'block',id:'d'}]);assert.deepEqual(applyDiff(concurrent,projectDiff(p,moved)).objects.map(o=>o.id),['b','c','a','d']);const asset={id:'image',name:'Image',w:100,h:100,src:'data:image/png;base64,aGVsbG8='};p={...p,assets:[asset]};p=editProject(p,[{type:'place',id:'sprite',assetId:'image'},{type:'crop',id:'sprite',rect:{x:10,y:20,w:40,h:50}}]);assert.equal(p.objects.at(-1).w,40);assert.equal(p.objects.at(-1).crop.y,.2);p=editProject(p,[{type:'crop',id:'sprite',reset:true}]);assert.equal(p.objects.at(-1).w,100)});
test('MCP imports PNG, composes exact sheet, slices frames and undoes the batch',async()=>{
 const env={BUCKET:new Bucket()},origin='https://pixel.example';
 const call=async(path,data)=>agentFetch(new Request(origin+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(data)}),env);
 const room=await(await call('/api/rooms',base)).json(),url='/mcp/'+room.token;
 let rpcId=0;const tool=async(name,args)=>{const response=await call(url,{jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}});return(await response.json()).result};
 const red=dataURL(await encodePNG({w:2,h:2,pixels:Uint8Array.from([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255])}));
 let r=await tool('import_image',{revision:0,name:'red',dataUrl:red});assert.equal(r.structuredContent.revision,1);const first=r.structuredContent.assetIds[0];
 r=await tool('import_image',{revision:1,name:'red2',dataUrl:red});assert.equal(r.structuredContent.revision,2);
 r=await tool('create_spritesheet',{revision:2,assetIds:[first,r.structuredContent.assetIds[0]],columns:2,cellWidth:3,cellHeight:3,name:'sheet',includeImage:true});
 assert.deepEqual([r.structuredContent.width,r.structuredContent.height,r.structuredContent.frames],[6,3,2]);assert.equal(r.content[1].type,'image');
 const png=await decodePNG(pngBytes('data:image/png;base64,'+r.content[1].data));assert.equal(png.pixels[3],0);assert.equal(png.pixels[(1*6+0)*4],255);
 const sheet=r.structuredContent.assetIds[0];r=await tool('slice_spritesheet',{revision:3,assetId:sheet,columns:2,rows:1});assert.equal(r.structuredContent.assetIds.length,2);assert.equal(r.structuredContent.cellWidth,3);
 r=await tool('undo_level',{revision:4});assert.equal(r.structuredContent.assets.length,3);r=await tool('import_image',{revision:4,name:'stale',dataUrl:red});assert.equal(r.isError,true);
 const source=dataURL(await encodePNG({w:4,h:2,pixels:Uint8Array.from([255,0,0,255,0,0,0,0,0,0,0,0,0,0,255,255,255,0,0,255,0,0,0,0,0,0,0,0,0,0,255,255])}));
 r=await tool('import_image',{revision:5,name:'parts',dataUrl:source,split:true});assert.equal(r.structuredContent.assetIds.length,2);
 const level=await tool('get_level',{});assert.deepEqual(level.structuredContent.assets.slice(-2).map(a=>[a.w,a.h]),[[1,2],[1,2]]);
});
