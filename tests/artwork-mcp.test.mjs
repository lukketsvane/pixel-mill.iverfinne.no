import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {agentFetch} from '../worker/api.mjs';
import {validateProject,platforms} from '../dist/engine.mjs';
import {projectDiff,applyDiff} from '../dist/agent.mjs';
import {encodePNG,dataURL,decodePNG,pngBytes} from '../dist/png.mjs';
import {designWithAgent} from '../worker/chat.mjs';

class ArtworkBucket {
 constructor(){this.data=new Map();this.version=0}
 async get(key){const value=this.data.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null}
 async put(key,text,{onlyIf}={}){const old=this.data.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.data.set(key,{text,etag});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.data.delete(key)}
}
async function png(w,h){const pixels=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([x%256,y%256,(x+y)%256,255],(y*w+x)*4);return dataURL(await encodePNG({w,h,pixels}))}
async function fixture(){return validateProject({format:'max-level-studio',version:1,name:'Semantic scene',spawn:{x:12,y:30},assets:[{id:'terrain',name:'Existing terrain',w:48,h:48,src:await png(48,48),selectedForGeneration:true,sheet:{tileSize:16}}],objects:[
 {id:'background',asset:null,name:'Blue backdrop',x:0,y:0,w:64,h:64,kind:'decor',role:'background',rotation:0,color:'#4488ff'},
 {id:'floor',asset:null,name:'Mint floor',x:0,y:48,w:64,h:16,kind:'solid',role:'platform',rotation:0,color:'#a8e8c8'},
 {id:'ledge',asset:null,name:'One-way ledge',x:16,y:24,w:32,h:8,kind:'platform',role:'platform',rotation:0,color:'#a8e8c8'},
 {id:'flower',asset:null,name:'Orange decoration',x:42,y:36,w:8,h:12,kind:'decor',role:'decoration',rotation:0,color:'#ff9933'}
 ]})}
const withoutArt=project=>project.objects.map(({artwork,...object})=>object);
const roots=project=>{const children=new Set(project.assets.flatMap(asset=>asset.spriteSheet?.frames.map(frame=>frame.sourceAssetId).filter(Boolean)||[]));return project.assets.filter(asset=>!asset.hidden&&!children.has(asset.id))};
async function httpRoom(t,project){
 const env={BUCKET:new ArtworkBucket()};
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await agentFetch(new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch(error){res.writeHead(500);res.end(error.message)}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const room=await(await fetch(origin+'/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(project)})).json();assert.ok(room.token);
 let id=0;
 const tool=async(name,args={})=>{const response=await fetch(origin+'/mcp/'+room.token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}})});assert.equal(response.status,200);return(await response.json()).result};
 const state=async()=> (await tool('get_level',{mode:'full'})).structuredContent;
 return {tool,state,rawState:async()=>(await(await fetch(origin+'/api/rooms/'+room.token)).json()).project};
}

test('real HTTP MCP handoff, coherent PNG apply, region isolation, stale layout conflict, and one-step undo',async t=>{
 const original=await fixture(),{tool,state}=await httpRoom(t,original);
 let result=await tool('prepare_artwork',{revision:0,objectIds:['floor','ledge'],assetIds:['terrain'],prompt:'Use one coherent woodland treatment.'});
 assert.equal(result.isError,undefined);assert.equal(result.structuredContent.revision,1);assert.equal(result.content.length,1);
 const request=result.structuredContent.request;assert.ok(request.id);assert.deepEqual(request.objects.map(o=>o.id),['floor','ledge']);assert.equal(request.references[0].id,'terrain');assert.equal(JSON.stringify(result).includes('data:image'),false);
 result=await tool('get_artwork_request',{requestId:request.id,includeImages:true});assert.equal(result.content.filter(item=>item.type==='image').length,2);
 const map=await decodePNG(pngBytes('data:image/png;base64,'+result.content[1].data));assert.equal(map.w,request.width);assert.equal(map.h,request.height);
 const supplied=await png(request.width,request.height);
 result=await tool('apply_artwork',{revision:1,requestId:request.id,dataUrl:supplied,name:'Returned woodland'});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.revision,2);assert.equal(result.content.length,1);
 let applied=await state();assert.deepEqual(withoutArt(applied),withoutArt(original));assert.deepEqual(platforms(applied.objects),platforms(original.objects));assert.deepEqual(applied.spawn,original.spawn);
 assert.ok(applied.objects.find(o=>o.id==='floor').artwork);assert.ok(applied.objects.find(o=>o.id==='ledge').artwork);assert.equal(applied.objects.find(o=>o.id==='flower').artwork,undefined);assert.equal(applied.objects.find(o=>o.id==='background').artwork,undefined);
 assert.equal(applied.assets.find(a=>a.id==='terrain').src,undefined); // full reads omit source data
 assert.equal(applied.assets.find(a=>a.id==='terrain').selectedForGeneration,true);
 result=await tool('undo_level',{revision:2});assert.equal(result.isError,undefined);assert.deepEqual(withoutArt(result.structuredContent),withoutArt(original));assert.equal(result.structuredContent.objects.some(o=>o.artwork),false);assert.equal(result.structuredContent.assets.length,1);
 result=await tool('apply_artwork',{revision:2,requestId:request.id,dataUrl:supplied});assert.equal(result.isError,true);assert.match(result.content[0].text,/Conflict/);
 result=await tool('edit_level',{revision:3,operations:[{type:'update',id:'floor',changes:{x:8}}]});assert.equal(result.isError,undefined);
 const beforeConflict=await state();result=await tool('apply_artwork',{revision:4,requestId:request.id,dataUrl:supplied});assert.equal(result.isError,true);assert.match(result.content[0].text,/chang|stale|geometry|layout/i);assert.deepEqual(await state(),beforeConflict);
 // Request map comes from the saved snapshot, never a re-render of moved geometry.
 result=await tool('get_artwork_request',{requestId:request.id,includeImages:true});assert.equal(result.isError,undefined);const frozen=await decodePNG(pngBytes('data:image/png;base64,'+result.content[1].data));assert.deepEqual(frozen.pixels,map.pixels);
});

test('direct sheet treatment reuses the source and preserves geometry; metadata patches and undo survive',async t=>{
 const original=await fixture(),{tool,state}=await httpRoom(t,original);
 const roles={platform:{x:0,y:0,w:48,h:48,mode:'terrain'},background:{x:16,y:16,w:16,h:16,mode:'tile'},decoration:{x:32,y:0,w:16,h:16,mode:'stretch'}};
 let result=await tool('apply_asset_sheet',{revision:0,assetId:'terrain',roles});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.revision,1);
 const applied=await state();assert.equal(applied.assets.length,original.assets.length);assert.deepEqual(withoutArt(applied),withoutArt(original));assert.deepEqual(platforms(applied.objects),platforms(original.objects));assert.ok(applied.objects.every(o=>o.artwork));
 result=await tool('undo_level',{revision:1});assert.equal(result.structuredContent.objects.some(o=>o.artwork),false);
 const snapshot=structuredClone(original),changed=structuredClone(original);changed.assets[0].selectedForGeneration=false;changed.assets[0].sheet={tileSize:8};changed.objects[0].role='decoration';
 assert.deepEqual(applyDiff(snapshot,projectDiff(snapshot,changed)),validateProject(changed));
 result=await tool('edit_level',{revision:2,operations:[{type:'asset',id:'terrain',changes:{selectedForGeneration:false,sheet:{tileSize:8}}}]});assert.equal(result.isError,undefined);const info=await state();assert.equal(info.assets[0].selectedForGeneration,false);assert.equal(info.assets[0].sheet.tileSize,8);
});

test('embedded chat sees selected sheet references once and applies existing pixels atomically',async()=>{
 const project=await fixture();let round=0;
 const answer=await designWithAgent({project,message:'Apply this sheet to the floor',assetIds:['terrain'],objectIds:['floor']},{OPENAI_API_KEY:'fixture'},async(url,options)=>{
  const body=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(body.tools.some(tool=>tool.name==='apply_asset_sheet'));
  assert.equal(body.input.filter(item=>item.role==='user').flatMap(item=>item.content).filter(item=>item.type==='input_image').length,1);
  return Response.json({status:'completed',output:round++===0?[{type:'function_call',call_id:'reuse',name:'apply_asset_sheet',arguments:JSON.stringify({revision:0,assetId:'terrain',roles:{platform:{x:0,y:0,w:48,h:48,mode:'terrain'}}})}]:[{type:'message',content:[{type:'output_text',text:'Applied the existing terrain sheet to the floor.'}]}]});
 });
 assert.ok(answer.project.objects.find(o=>o.id==='floor').artwork);assert.equal(answer.project.objects.find(o=>o.id==='ledge').artwork,undefined);assert.deepEqual(withoutArt(answer.project),withoutArt(project));assert.equal(answer.project.assets.length,project.assets.length);
});

test('HTTP MCP sheet hierarchy preserves blank frames, source pixels, ordered groups, export and undo',async t=>{
 const project=await fixture(),pixels=new Uint8Array(32*32*4);
 for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(x<16||y<16)pixels.set([x<16?255:0,y<16?0:255,80,255],(y*32+x)*4);
 const src=dataURL(await encodePNG({w:32,h:32,pixels}));project.assets=[{id:'player',name:'Player',w:32,h:32,src}];
 const {tool,state}=await httpRoom(t,project);
 let result=await tool('group_sprite_sheet',{revision:0,assetId:'player',cellWidth:16,cellHeight:16,sheetType:'character'});assert.equal(result.isError,undefined);const sheet=result.structuredContent.spriteSheet;assert.equal(sheet.groups.length,2);assert.equal(sheet.frameCount,4);assert.equal(sheet.frames,undefined);assert.equal(result.content.length,1);
 result=await tool('inspect_sprite_sheet',{assetId:'player',includeFrames:true});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.spriteSheet.frames.at(-1).empty,true);assert.equal(result.structuredContent.spriteSheet.groups[1].frameIds.length,2);
 const source=await tool('get_asset_image',{id:'player'});assert.equal(source.content[1].data,src.split(',')[1]);
 result=await tool('edit_sprite_sheet',{revision:1,assetId:'player',operations:[{type:'rename_group',groupId:sheet.groups[0].id,name:'Walk'},{type:'reorder_groups',groupIds:[sheet.groups[1].id,sheet.groups[0].id]}]});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.spriteSheet.groups[1].name,'Walk');
 result=await tool('export_sprite_sheet',{assetId:'player',groupId:sheet.groups[1].id});assert.equal(result.isError,undefined);assert.equal(result.content[1].type,'image');const exported=await decodePNG(pngBytes('data:image/png;base64,'+result.content[1].data));assert.deepEqual([exported.w,exported.h],[32,16]);assert.equal(exported.pixels[(16*4)+3],0);
 result=await tool('undo_level',{revision:2});assert.equal(result.isError,undefined);assert.deepEqual(result.structuredContent.assets[0].spriteSheet.groups,sheet.groups);assert.equal((await state()).objects.length,project.objects.length);
});

async function solidPNG(r,g,b){const pixels=new Uint8Array(16*16*4);for(let i=0;i<pixels.length;i+=4)pixels.set([r,g,b,255],i);return dataURL(await encodePNG({w:16,h:16,pixels}))}
async function looseFixture(){const assets=await Promise.all([[255,0,0],[0,255,0],[0,0,255]].map(async(color,index)=>({id:'loose-'+index,name:'Sprite '+index,w:16,h:16,src:await solidPNG(...color)})));return validateProject({format:'max-level-studio',version:1,name:'Loose sources',spawn:{x:0,y:0},assets,objects:[]})}

test('HTTP MCP groups loose sources without raster duplication, lazily exports, preserves timing and reversibly releases children',async t=>{
 const project=await looseFixture(),{tool,state,rawState}=await httpRoom(t,project);
 let result=await tool('group_workspace_sprites',{revision:0,assetIds:['loose-0','loose-1','loose-0','loose-2'],columns:2,name:'Actor'});assert.equal(result.isError,undefined);const parentId=result.structuredContent.assetId;assert.ok(parentId);
 const raw=await rawState(),parent=raw.assets.find(a=>a.id===parentId);assert.equal(parent.src,undefined);assert.equal(parent.spriteSheet.source,'assets');assert.deepEqual(parent.spriteSheet.frames.map(frame=>frame.sourceAssetId),['loose-0','loose-1','loose-0','loose-2']);
 assert.equal(raw.assets.length,4);for(const source of project.assets)assert.equal(raw.assets.find(a=>a.id===source.id).src,source.src);
 assert.equal(roots(raw).length,1);const firstGroup=parent.spriteSheet.groups[0].id;
 result=await tool('get_asset_image',{id:parentId});assert.equal(result.isError,undefined);const image=await decodePNG(pngBytes('data:image/png;base64,'+result.content[1].data));assert.deepEqual([image.w,image.h],[32,32]);assert.deepEqual([...image.pixels.slice(0,4)],[255,0,0,255]);assert.deepEqual([...image.pixels.slice(16*4,16*4+4)],[0,255,0,255]);
 result=await tool('edit_sprite_sheet',{revision:1,assetId:parentId,operations:[{type:'rename_group',groupId:firstGroup,name:'Walk'},{type:'group_settings',groupId:firstGroup,fps:12,loop:false,origin:{x:8,y:16}}]});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.spriteSheet.groups[0].fps,12);assert.equal(result.structuredContent.spriteSheet.groups[0].loop,false);
 result=await tool('ungroup_sprite_sheet',{revision:2,assetId:parentId});assert.equal(result.isError,undefined);let current=await rawState();assert.equal(current.assets.length,3);assert.equal(roots(current).length,3);assert.deepEqual(current.assets.map(a=>a.src),project.assets.map(a=>a.src));
 result=await tool('undo_level',{revision:3});assert.equal(result.isError,undefined);current=await rawState();assert.equal(current.assets.find(a=>a.id===parentId).src,undefined);assert.equal(current.assets.find(a=>a.id===parentId).spriteSheet.groups[0].fps,12);assert.equal((await tool('get_level')).structuredContent.assets.find(a=>a.id===parentId).virtual,true);
});

test('HTTP MCP scoped asset handoff attaches replacements to exact group frames, leaves original sources and other frames intact, and undoes atomically',async t=>{
 const project=await looseFixture(),{tool,rawState}=await httpRoom(t,project);
 let result=await tool('group_workspace_sprites',{revision:0,assetIds:['loose-0','loose-1','loose-2'],columns:2,name:'Actor'});assert.equal(result.isError,undefined);const parentId=result.structuredContent.assetId;
 let raw=await rawState(),parent=raw.assets.find(a=>a.id===parentId),group=parent.spriteSheet.groups[0],unaffected=structuredClone(parent.spriteSheet.frames.filter(frame=>!group.frameIds.includes(frame.id)));
 result=await tool('edit_level',{revision:1,operations:[{type:'asset',id:parentId,changes:{selectedForGeneration:true,referenceSelection:{groupIds:[group.id]}}}]});assert.equal(result.isError,undefined);
 result=await tool('prepare_asset_artwork',{revision:2,assetId:parentId,groupId:group.id,assetIds:[parentId],prompt:'Keep these two poses; apply one material treatment.'});assert.equal(result.isError,undefined);assert.equal(result.content.length,1);const request=result.structuredContent.request;assert.deepEqual(request.target.frameIds,group.frameIds);assert.equal(request.references[0].spriteSheet.frames.length,group.frameIds.length);assert.equal(JSON.stringify(result).includes('data:image/png'),false);
 result=await tool('get_asset_artwork_request',{requestId:request.id,includeImages:true});assert.equal(result.isError,undefined);assert.equal(result.content.filter(item=>item.type==='image').length,2);
 const replacement=await png(request.width,request.height);result=await tool('apply_asset_artwork',{revision:3,requestId:request.id,dataUrl:replacement,name:'Walk treatment'});assert.equal(result.isError,undefined);
 raw=await rawState();parent=raw.assets.find(a=>a.id===parentId);assert.equal(parent.src,undefined);assert.deepEqual(parent.spriteSheet.frames.filter(frame=>!group.frameIds.includes(frame.id)),unaffected);assert.ok(parent.spriteSheet.frames.filter(frame=>group.frameIds.includes(frame.id)).every(frame=>frame.artwork));assert.deepEqual(parent.spriteSheet.groups.map(g=>g.id),['row-01','row-02']);
 const generated=raw.assets.find(a=>a.id===result.structuredContent.sourceAssetId);assert.ok(generated);assert.equal(generated.hidden,true);assert.equal(generated.parentAssetId,parentId);assert.equal(generated.src,replacement);assert.equal(roots(raw).length,1);
 for(const source of project.assets)assert.equal(raw.assets.find(a=>a.id===source.id).src,source.src);
 result=await tool('export_sprite_sheet',{assetId:parentId,groupId:group.id});assert.equal(result.isError,undefined);const decoded=await decodePNG(pngBytes('data:image/png;base64,'+result.content[1].data)),provided=await decodePNG(pngBytes(replacement));assert.deepEqual(decoded.pixels,provided.pixels);
 result=await tool('undo_level',{revision:4});assert.equal(result.isError,undefined);raw=await rawState();assert.equal(raw.assets.length,4);assert.equal(raw.assets.find(a=>a.id===parentId).spriteSheet.frames.some(frame=>frame.artwork),false);assert.equal(raw.assetRequests[0].status,'prepared');
 result=await tool('edit_sprite_sheet',{revision:5,assetId:parentId,operations:[{type:'reorder_frames',groupId:group.id,frameIds:[...group.frameIds].reverse()}]});assert.equal(result.isError,undefined);const beforeConflict=await rawState();result=await tool('apply_asset_artwork',{revision:6,requestId:request.id,dataUrl:replacement});assert.equal(result.isError,true);assert.deepEqual(await rawState(),beforeConflict);
});

test('MCP import automatically groups a confident transparent grid while retaining one exact source asset',async t=>{
 const pixels=new Uint8Array(32*32*4);for(let row=0;row<2;row++)for(let col=0;col<2;col++)for(let y=4;y<12;y++)for(let x=4;x<12;x++)pixels.set([row*200,col*200,170,255],((row*16+y)*32+col*16+x)*4);
 const src=dataURL(await encodePNG({w:32,h:32,pixels})),project=await looseFixture(),{tool,rawState}=await httpRoom(t,project);
 let result=await tool('import_image',{revision:0,name:'Pose grid',dataUrl:src});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.assetIds.length,1);const id=result.structuredContent.assetIds[0],raw=await rawState(),asset=raw.assets.find(a=>a.id===id);assert.equal(asset.src,src);assert.equal(asset.spriteSheet.groups.length,2);assert.equal(asset.spriteSheet.frames.length,4);assert.equal(raw.assets.length,project.assets.length+1);
 result=await tool('import_image',{revision:1,name:'Plain grid',dataUrl:src,autoGroup:false});assert.equal(result.isError,undefined);assert.equal((await rawState()).assets.find(a=>a.id===result.structuredContent.assetIds[0]).spriteSheet,undefined);
});

test('embedded chat defaults to selected parent references without duplicating their selected children and honors explicit source references',async()=>{
 const {groupWorkspaceSprites}=await import('../dist/spritesheets.mjs'),original=await looseFixture();for(const asset of original.assets)asset.selectedForGeneration=true;
 const grouped=await groupWorkspaceSprites(original,{assetIds:original.assets.map(a=>a.id),columns:2}),parentId=grouped.details.assetId;
 for(const selection of [undefined,['loose-0']]){
  await designWithAgent({project:grouped.project,message:'Describe this family',assetIds:selection},{OPENAI_API_KEY:'fixture'},async(url,options)=>{
   const input=JSON.parse(options.body).input[0].content,refs=input.filter(item=>item.type==='input_text').map(item=>{try{return JSON.parse(item.text)}catch{return null}}).filter(value=>value?.referenceAssetId);
   assert.deepEqual(refs.map(ref=>ref.referenceAssetId),selection||[parentId]);assert.equal(input.filter(item=>item.type==='input_image').length,1);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'The selected reference is ready.'}]}]});
  });
 }
});
