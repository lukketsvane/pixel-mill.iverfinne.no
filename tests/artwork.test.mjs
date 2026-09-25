import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareArtwork,getArtworkRequest,applyArtwork,applyAssetSheet,semanticRole,ARTWORK_ROLES} from '../dist/artwork.mjs';
import {validateProject,platforms} from '../dist/engine.mjs';
import {drawObject} from '../dist/geometry.mjs';
import {dataURL,encodePNG,decodePNG,pngBytes} from '../dist/png.mjs';
import {projectDiff,applyDiff} from '../dist/agent.mjs';
import {groupSpriteSheet} from '../dist/spritesheets.mjs';
const makePNG=async(w,h,pixel=[36,88,145,255])=>{const pixels=new Uint8Array(w*h*4);for(let i=0;i<pixels.length;i+=4)pixels.set(pixel,i);return dataURL(await encodePNG({w,h,pixels}))};
const shape=(id,x,y,w,h,role='platform',extra={})=>({id,name:id,asset:null,x,y,w,h,kind:role==='platform'?'solid':'decor',role,inset:0,color:ARTWORK_ROLES[role],...extra});
const project=(objects,assets=[])=>validateProject({format:'max-level-studio',version:1,name:'Round trip',spawn:{x:0,y:-18},objects,assets});
const withoutArt=o=>{const {artwork,...source}=o;return source};

test('handoff carries an exact colored map and selected references without persisted image duplication',async()=>{
 const src=await makePNG(16,16),original=project([shape('background',0,0,64,48,'background'),shape('floor',0,32,64,16),shape('flower',8,16,8,16,'decoration')],[{id:'sheet',name:'Tiles',src,w:16,h:16,selectedForGeneration:true,sheet:{tileSize:16}}]);
 const result=await prepareArtwork(original,{id:'request'});assert.equal(result.request.width,64);assert.equal(result.request.height,48);assert.equal(result.request.references[0].src,src);assert.equal(result.project.artRequests[0].map,undefined);assert.equal(result.project.artRequests[0].references,undefined);
 const png=await decodePNG(pngBytes(result.request.map)),at=(x,y)=>[...png.pixels.slice((y*64+x)*4,(y*64+x)*4+4)];assert.deepEqual(at(1,1),[107,159,232,255]);assert.deepEqual(at(1,40),[145,232,193,255]);assert.deepEqual(at(10,20),[245,161,92,255]);
 const compact=await getArtworkRequest(result.project,{requestId:'request',includeImages:false});assert.equal(compact.map,undefined);assert.equal(compact.references[0].src,undefined);assert.match(compact.instructions,/Do not move/);assert.deepEqual(original.objects,result.project.objects);
});

test('generated atlas round trip preserves geometry, collision, source colors, and untouched region; exact upscale accepted',async()=>{
 const original=project([shape('floor',-16,32,64,16),shape('other',200,40,32,16),shape('rotated',8,8,16,16,'decoration',{rotation:33.25,flip:true})]);
 const prepared=await prepareArtwork(original,{objectIds:['floor','rotated'],id:'region'}),before=platforms(prepared.project.objects),result=await applyArtwork(prepared.project,{requestId:'region',dataUrl:await makePNG(prepared.request.width*2,prepared.request.height*2),id:'generated'});
 assert.deepEqual(platforms(result.project.objects),before);assert.deepEqual(result.project.objects.map(withoutArt),original.objects);assert.equal(result.project.objects[1].artwork,undefined);assert.equal(result.project.objects[2].artwork.transform.rotation,prepared.request.objects[1].rotation);assert.equal(result.project.objects[2].artwork.transform.flip,true);assert.equal(result.project.assets.length,1);assert.equal(result.project.artRequests[0].status,'applied');
 const saved=validateProject(JSON.parse(JSON.stringify(result.project)));assert.deepEqual(saved,result.project);await assert.rejects(()=>applyArtwork(result.project,{requestId:'region',assetId:'generated'}),/already applied/);
 const undone=applyDiff(result.project,projectDiff(result.project,prepared.project));assert.deepEqual(undone,prepared.project);
});

test('stale request rejects target geometry changes but allows unrelated changes',async()=>{
 const prepared=await prepareArtwork(project([shape('a',0,0,32,16),shape('b',64,0,32,16)]),{objectIds:['a'],id:'target'}),dataUrl=await makePNG(64,32);
 const moved=structuredClone(prepared.project);moved.objects[0].x++;await assert.rejects(()=>applyArtwork(moved,{requestId:'target',dataUrl}),/sketch changed/);assert.equal(moved.assets.length,0);
 const unrelated=structuredClone(prepared.project);unrelated.objects[1].x++;const result=await applyArtwork(unrelated,{requestId:'target',dataUrl});assert.equal(result.project.objects[1].x,65);
 await assert.rejects(()=>applyArtwork(prepared.project,{requestId:'target',dataUrl:undefined}),/Supply one/);
 await assert.rejects(()=>applyArtwork(prepared.project,{requestId:'missing',dataUrl}),/not found/);
 const distorted=await makePNG(32,32);await assert.rejects(()=>applyArtwork(prepared.project,{requestId:'target',dataUrl:distorted}),/aspect ratio/);
});

test('request snapshot and image references cannot silently change after handoff',async()=>{
 const prepared=await prepareArtwork(project([shape('a',0,0,16,16)],[{id:'ref',name:'ref',w:16,h:16,src:await makePNG(16,16),selectedForGeneration:true}]),{id:'frozen'}),moved=structuredClone(prepared.project);moved.objects[0].x+=100;
 assert.equal((await getArtworkRequest(moved,{requestId:'frozen'})).map,prepared.request.map);
 moved.assets[0].src=await makePNG(16,16,[255,0,0,255]);await assert.rejects(()=>getArtworkRequest(moved,{requestId:'frozen'}),/reference changed/);
});

test('direct sheet application selects terrain edges and joins, preserves source pixels, and needs no generated asset',async()=>{
 const src=await makePNG(48,48),base=project([shape('left',0,0,32,32),shape('right',32,0,32,32),shape('bg',0,-32,64,32,'background')],[{id:'tiles',name:'Terrain',w:48,h:48,src,sheet:{tileSize:16,role:'platform',terrain:{x:0,y:0,tileSize:16}}}]),result=applyAssetSheet(base,{assetId:'tiles'});
 assert.equal(result.project.assets.length,1);assert.equal(result.project.assets[0].src,src);assert.deepEqual(platforms(result.project.objects),platforms(base.objects));assert.deepEqual(result.project.objects.map(withoutArt),base.objects);assert.equal(result.project.objects[0].artwork.mode,'terrain');assert.deepEqual(result.project.objects[0].artwork.joins.right,[[0,32]]);assert.deepEqual(result.project.objects[1].artwork.joins.left,[[0,32]]);assert.equal(result.project.objects[2].artwork,undefined);
 const draw=[],ctx={save(){},restore(){},translate(){},rotate(){},scale(){},beginPath(){},rect(){},clip(){},drawImage(...args){draw.push(args)}};drawObject(ctx,result.project.objects[0],{width:48,height:48});assert.equal(draw.length,4);assert.deepEqual(draw[0].slice(1,5),[0,0,16,16]);assert.deepEqual(draw[1].slice(1,5),[16,0,16,16]);assert.deepEqual(draw[3].slice(1,5),[16,32,16,16]);
});

test('multiple selected sheets apply atomically by role and explicit role overrides color inference',async()=>{
 const base=project([shape('floor',0,32,32,16),shape('bg',0,0,32,32,'background'),shape('deco',0,16,16,16,'decoration')],[{id:'terrain',name:'Terrain',w:16,h:16,src:await makePNG(16,16),sheet:{tileSize:16,role:'platform'}},{id:'backdrop',name:'Backdrop',w:16,h:16,src:await makePNG(16,16,[10,20,30,255]),sheet:{tileSize:16,role:'background'}}]);
 const result=applyAssetSheet(base,{assetIds:['terrain','backdrop']});assert.deepEqual(result.project.objects.map(o=>o.artwork?.asset),['terrain','backdrop',undefined]);assert.deepEqual(result.project.objects.map(withoutArt),base.objects);assert.equal(semanticRole({kind:'solid',color:ARTWORK_ROLES.background}),'background');assert.equal(semanticRole({kind:'solid',role:'decoration',color:ARTWORK_ROLES.background}),'decoration');assert.throws(()=>applyAssetSheet(base,{assetIds:['terrain','missing']}),/no longer exists/);assert.equal(base.objects[0].artwork,undefined);
});

test('invalid artwork bindings and sheet crops reject atomically; bounded semantic maps are compact',async()=>{
 const base=project([shape('a',0,0,8192,8192)],[{id:'small',name:'small',w:16,h:16,src:await makePNG(16,16)}]);
 assert.throws(()=>applyAssetSheet(base,{assetId:'small',terrain:{x:0,y:0,tileSize:16}}),/fit inside/);assert.throws(()=>validateProject({...base,objects:[{...base.objects[0],artwork:{asset:'missing',mode:'tile'}}]}),/artwork binding/);
 const prepared=await prepareArtwork(base,{id:'large',includeImages:false});assert.ok(prepared.request.width*prepared.request.height<=4_000_000);assert.equal(prepared.request.map,undefined);assert.equal(prepared.request.width,2000);
});

test('generation carries structured character groups; direct treatment skips characters and metadata edits invalidate handoff',async()=>{
 const character=await groupSpriteSheet({id:'hero',name:'Hero',w:32,h:32,src:await makePNG(32,32)},{cellWidth:16,cellHeight:16,grouping:'row',sheetType:'character'});character.selectedForGeneration=true;
 const environment={id:'environment',name:'Environment',w:16,h:16,src:await makePNG(16,16),selectedForGeneration:true,sheet:{tileSize:16,role:'platform'}},base=project([shape('floor',0,0,32,16)],[character,environment]);
 const prepared=await prepareArtwork(base,{id:'characters'});assert.equal(prepared.request.references[0].type,'sprite_sheet');assert.equal(prepared.request.references[0].spriteSheet.type,'character');assert.equal(prepared.request.references[0].spriteSheet.groups.length,2);assert.equal(prepared.request.references[0].spriteSheet.frames.length,4);assert.equal(prepared.project.artRequests[0].references,undefined);
 const changed=structuredClone(prepared.project);changed.assets[0].spriteSheet.groups[0].name='Renamed animation';await assert.rejects(()=>getArtworkRequest(changed,{requestId:'characters',includeImages:false}),/reference changed/);
 assert.throws(()=>applyAssetSheet(base,{assetId:'hero'}),/environment sheet/);assert.throws(()=>applyAssetSheet(base,{assetIds:['hero']}),/environment sheets/);const applied=applyAssetSheet(base,{assetIds:['hero','environment']});assert.deepEqual(applied.details.assetIds,['environment']);assert.equal(applied.project.objects[0].artwork.asset,'environment');assert.equal(applied.project.assets[0].src,character.src);
});

test('virtual family references carry only selected groups; scoped generated frames preserve parents, siblings and geometry',async()=>{
 const {groupWorkspaceSprites,exportSpriteSheet}=await import('../dist/spritesheets.mjs'),{prepareAssetArtwork,getAssetArtworkRequest,applyAssetArtwork,getAssetReference}=await import('../dist/artwork.mjs');
 const sources=await Promise.all(['red','green','blue'].map(async(id,index)=>({id,name:id,w:16,h:16,selectedForGeneration:true,src:await makePNG(16,16,[index*60,30,200,255])}))),base=project([shape('floor',0,0,32,16)],sources),grouped=await groupWorkspaceSprites(base,{assetIds:['red','green','blue'],columns:2,name:'Family',id:'family'}),parent=grouped.project.assets.at(-1);parent.referenceSelection={groupIds:[parent.spriteSheet.groups[0].id]};parent.selectedForGeneration=true;
 const clean=validateProject(grouped.project),ref=await getAssetReference(clean,'family');assert.equal(parent.src,undefined);assert.deepEqual([ref.w,ref.h],[32,16]);assert.equal(ref.spriteSheet.groups.length,1);assert.equal(ref.spriteSheet.frames.length,2);assert.equal(ref.referenceLayout.length,2);
 const levelRequest=await prepareArtwork(clean,{id:'parent-only',includeImages:false});assert.deepEqual(levelRequest.request.assetIds,['family']);assert.equal(levelRequest.request.references.length,1);const explicitSource=await prepareArtwork(clean,{id:'explicit-source',assetIds:['red'],includeImages:false});assert.deepEqual(explicitSource.request.assetIds,['red']);
 const siblingRequest=await prepareAssetArtwork(clean,{assetId:'family',groupId:parent.spriteSheet.groups[1].id,id:'sibling-with-ref',includeImages:false});assert.equal(siblingRequest.request.references.length,1);assert.equal(siblingRequest.request.references[0].id,'family');assert.deepEqual(siblingRequest.request.references[0].spriteSheet.frames.map(f=>f.id),parent.spriteSheet.groups[0].frameIds);assert.deepEqual(siblingRequest.request.target.frameIds,parent.spriteSheet.groups[1].frameIds);
 const prepared=await prepareAssetArtwork(clean,{assetId:'family',frameIds:[parent.spriteSheet.frames[0].id],id:'one-frame',includeImages:false}),request=await getAssetArtworkRequest(prepared.project,{requestId:'one-frame'});assert.deepEqual([request.width,request.height],[16,16]);assert.equal(request.placements.length,1);assert.equal(prepared.project.assetRequests[0].map,undefined);
 const png=await makePNG(32,32,[255,99,0,255]),applied=await applyAssetArtwork(prepared.project,{requestId:'one-frame',dataUrl:png,id:'new-frame'}),updated=applied.project.assets.find(a=>a.id==='family');assert.equal(updated.src,undefined);assert.deepEqual(updated.spriteSheet.frames.slice(1),parent.spriteSheet.frames.slice(1));assert.equal(updated.spriteSheet.frames[0].sourceAssetId,'red');assert.equal(updated.spriteSheet.frames[0].artwork.asset,'new-frame');assert.equal(applied.project.assets.at(-1).src,png);assert.equal(applied.project.assets.at(-1).hidden,true);assert.equal(applied.project.assets.at(-1).parentAssetId,'family');assert.deepEqual(applied.project.objects,clean.objects);for(const source of sources)assert.equal(applied.project.assets.find(a=>a.id===source.id).src,source.src);
 const exported=await exportSpriteSheet(updated,{frameId:updated.spriteSheet.frames[0].id},applied.project.assets),pixels=await decodePNG(pngBytes(exported.src));assert.deepEqual([pixels.w,pixels.h],[16,16]);assert.deepEqual([...pixels.pixels.slice(0,4)],[255,99,0,255]);assert.deepEqual(applyDiff(applied.project,projectDiff(applied.project,prepared.project)),prepared.project);
});

test('virtual asset validation rejects missing pixels and cycles; changed source invalidates asset generation',async()=>{
 const {groupWorkspaceSprites}=await import('../dist/spritesheets.mjs'),{prepareAssetArtwork,applyAssetArtwork}=await import('../dist/artwork.mjs');const src=await makePNG(16,16),base=project([],[{id:'source',name:'Source',w:16,h:16,src}]),grouped=await groupWorkspaceSprites(base,{assetIds:['source'],id:'parent'}),clean=validateProject(grouped.project);
 const missing=structuredClone(clean);missing.assets=missing.assets.filter(a=>a.id!=='source');assert.throws(()=>validateProject(missing),/source/);const cycle=structuredClone(clean);cycle.assets[1].spriteSheet.frames[0].sourceAssetId='parent';assert.throws(()=>validateProject(cycle),/itself/);
 const prepared=await prepareAssetArtwork(clean,{assetId:'parent',id:'stale-asset',includeImages:false}),changed=structuredClone(prepared.project);changed.assets[0].src=await makePNG(16,16,[1,2,3,255]);await assert.rejects(()=>applyAssetArtwork(changed,{requestId:'stale-asset',dataUrl:src}),/target frames changed/);assert.equal(changed.assets.length,2);
});
