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

test('agent mask edits persist through storage, compact/full reads, independent merges and one-step undo',async()=>{
 const env={BUCKET:new Bucket()},origin='https://pixel.example',call=async(path,data)=>agentFetch(new Request(origin+path,{method:data?'POST':'GET',headers:{'content-type':'application/json',origin},...(data?{body:JSON.stringify(data)}:{})}),env),initial=editProject(base,[{type:'block',id:'mask',width:4,height:4}]),room=await(await call('/api/rooms',initial)).json();
 let id=0;const tool=async(name,args={})=>(await(await call('/mcp/'+room.token,{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})).json()).result,mask={w:4,h:4,runs:[[0,0,4],[1,0,1],[1,3,4],[2,0,1],[2,3,4],[3,0,4]]};
 const edited=await tool('edit_level',{revision:0,operations:[{type:'update',id:'mask',changes:{mask}}]});assert.equal(edited.isError,undefined);assert.equal(edited.structuredContent.revision,1);
 const compact=(await tool('get_level')).structuredContent;assert.deepEqual(compact.objects[0].mask,{w:4,h:4,runCount:6,pixelCount:12});
 const full=(await tool('get_level',{mode:'full'})).structuredContent;assert.deepEqual(full.objects[0].mask,mask);assert.deepEqual((await(await call('/api/rooms/'+room.token)).json()).project.objects[0].mask,mask);
 const moved=editProject(initial,[{type:'update',id:'mask',changes:{x:8}}]),merged=applyDiff(moved,projectDiff(initial,full));assert.equal(merged.objects[0].x,8);assert.deepEqual(merged.objects[0].mask,mask);
 const invalid=await tool('edit_level',{revision:1,operations:[{type:'update',id:'mask',changes:{mask:{...mask,runs:[[0,0,5]]}}}]});assert.equal(invalid.isError,true);assert.equal((await tool('get_level')).structuredContent.revision,1);
 const undone=await tool('undo_level',{revision:1});assert.equal(undone.structuredContent.objects[0].mask,undefined);assert.equal(undone.structuredContent.revision,2);
});

test('layer changes, crop, opacity and locks survive agent edits and undo',()=>{let p=editProject(base,[{type:'block',id:'a'},{type:'block',id:'b'},{type:'block',id:'c'}]);const moved=editProject(p,[{type:'order',id:'a',direction:'front'},{type:'update',id:'a',changes:{opacity:.4,locked:true}}]);assert.deepEqual(moved.objects.map(o=>o.id),['b','c','a']);const merged=applyDiff(p,projectDiff(p,moved));assert.deepEqual(merged,moved);assert.deepEqual(applyDiff(merged,projectDiff(moved,p)),p);assert.throws(()=>editProject(moved,[{type:'update',id:'a',changes:{x:5}}]),/Unlock/);const deleted=editProject(p,[{type:'delete',ids:['b']}]);assert.deepEqual(applyDiff(deleted,projectDiff(deleted,p)),p);const concurrent=editProject(p,[{type:'block',id:'d'}]);assert.deepEqual(applyDiff(concurrent,projectDiff(p,moved)).objects.map(o=>o.id),['b','c','a','d']);const asset={id:'image',name:'Image',w:100,h:100,src:'data:image/png;base64,aGVsbG8='};p={...p,assets:[asset]};p=editProject(p,[{type:'place',id:'sprite',assetId:'image'},{type:'crop',id:'sprite',rect:{x:10,y:20,w:40,h:50}}]);assert.equal(p.objects.at(-1).w,40);assert.equal(p.objects.at(-1).crop.y,.2);p=editProject(p,[{type:'crop',id:'sprite',reset:true}]);assert.equal(p.objects.at(-1).w,100)});
test('shared undo and redo restore exact mask artwork in one step and a new human edit clears redo',async()=>{
 const env={BUCKET:new Bucket()},origin='https://pixel.example',call=async(path,method='GET',data)=>agentFetch(new Request(origin+path,{method,headers:{'content-type':'application/json',origin},...(data?{body:JSON.stringify(data)}:{})}),env),mask={w:4,h:4,runs:[[0,0,4],[1,0,1],[1,3,4],[2,0,1],[2,3,4],[3,0,4]]},initial=editProject(base,[{type:'block',id:'mask',width:4,height:4,role:'platform'},{type:'update',id:'mask',changes:{mask}}]),room=await(await call('/api/rooms','POST',initial)).json(),roomPath='/api/rooms/'+room.token;
 let id=0;const tool=async(name,args={})=>(await(await call('/mcp/'+room.token,'POST',{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})).json()).result,read=async()=>await(await call(roomPath)).json();
 const listed=await(await call('/mcp/'+room.token,'POST',{jsonrpc:'2.0',id:++id,method:'tools/list'})).json();assert.ok(listed.result.tools.some(tool=>tool.name==='redo_level'));
 const prepared=await tool('prepare_artwork',{revision:0}),requestId=prepared.structuredContent.request.id,sketch=(await read()).project,request=(await tool('get_artwork_request',{requestId})).structuredContent.request,src=dataURL(await encodePNG({w:request.width,h:request.height,pixels:new Uint8Array(request.width*request.height*4).fill(255)}));
 let result=await tool('apply_artwork',{revision:1,requestId,dataUrl:src});assert.equal(result.isError,undefined);const applied=(await read()).project;assert.deepEqual(applied.objects[0].mask,mask);assert.ok(applied.objects[0].artwork);
 for(const [name,revision,expected]of [['undo_level',2,sketch],['redo_level',3,applied],['undo_level',4,sketch],['undo_level',5,{...initial,artRequests:[]}],['redo_level',6,sketch],['redo_level',7,applied]]){result=await tool(name,{revision});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.revision,revision+1);assert.deepEqual((await read()).project,expected)}
 result=await tool('redo_level',{revision:7});assert.equal(result.isError,true);assert.equal((await read()).revision,8);assert.deepEqual((await read()).project,applied);
 await tool('undo_level',{revision:8});let current=await read();assert.equal(current.canRedo,true);const moved=editProject(current.project,[{type:'update',id:'mask',changes:{x:20}}]),patched=await call(roomPath,'PATCH',{diff:projectDiff(current.project,moved)});assert.equal(patched.status,200);current=await patched.json();assert.equal(current.revision,10);assert.equal(current.canRedo,false);assert.deepEqual(current.project,moved);
 result=await tool('redo_level',{revision:10});assert.equal(result.isError,true);assert.match(result.content[0].text,/Nothing to redo/);assert.deepEqual((await read()).project,moved);assert.equal((await read()).revision,10);
});
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
