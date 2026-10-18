import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAssetSheet,bindLiveAssetSheet} from '../dist/artwork.mjs';
import {validateProject,platforms} from '../dist/engine.mjs';
import {projectDiff,applyDiff} from '../dist/agent.mjs';
import {eraseStroke} from '../dist/paint-tools.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';
import {groupSpriteSheet} from '../dist/spritesheets.mjs';

const roles={platform:{x:0,y:0,w:48,h:48,mode:'terrain'},background:{x:0,y:48,w:16,h:16,mode:'tile'},decoration:{x:16,y:48,w:16,h:16,mode:'stretch'}};
const shape=(id,role='platform',extra={})=>({id,name:id,asset:null,x:64,y:0,w:16,h:16,kind:role==='platform'?'solid':'decor',role,inset:0,rotation:0,...extra});
async function fixture(objects=[]){const src=dataURL(await encodePNG({w:48,h:64,pixels:new Uint8Array(48*64*4).fill(255)}));return validateProject({format:'max-level-studio',version:1,name:'Live palette',spawn:{x:0,y:0},objects,assets:[{id:'atlas',name:'One atlas',w:48,h:64,src,sheet:{tileSize:16}}]})}
const geometry=objects=>objects.map(({artwork,...object})=>object);

test('one explicit atlas palette binds all matching new roles without creating images or artwork requests',async()=>{
 const original=await fixture([shape('existing','platform',{x:0,w:64})]),applied=applyAssetSheet(original,{assetId:'atlas',roles}),project=applied.project,source=original.assets[0].src;
 assert.equal(original.assets[0].sheet.live,undefined);assert.equal(project.assets.length,1);assert.equal(project.assets[0].sheet.live,true);assert.deepEqual(project.assets[0].sheet.roles,Object.fromEntries(Object.entries(roles).map(([role,mapping])=>[role,{...mapping,tileSize:16}])));assert.equal(project.artRequests,undefined);assert.equal(project.assets[0].src,source);
 const before=geometry(project.objects);for(const role of ['platform','background','decoration']){const object=shape('new-'+role,role),snapshot=structuredClone(object);assert.equal(bindLiveAssetSheet(project,object),true);assert.deepEqual(geometry([object]),[snapshot]);assert.equal(object.artwork.asset,'atlas');assert.deepEqual(object.artwork.source,{x:roles[role].x,y:roles[role].y,w:roles[role].w,h:roles[role].h});project.objects.push(object)}
 assert.deepEqual(project.objects.find(object=>object.id==='new-platform').artwork.joins.left,[[0,16]]);assert.deepEqual(geometry(project.objects).slice(0,1),before);assert.equal(validateProject(project).assets.length,1);assert.equal(project.assets[0].src,source);assert.equal(project.artRequests,undefined);
});

test('mask erasure, undo and JSON reopen preserve the live source and exact authored geometry',async()=>{
 const original=await fixture(),active=applyAssetSheet(original,{assetId:'atlas',roles}).project,stroke=shape('painted','platform',{w:8,h:8,mask:{w:8,h:8,runs:Array.from({length:8},(_,row)=>[row,0,8])}}),maskBefore=structuredClone(stroke.mask);assert.equal(bindLiveAssetSheet(active,stroke),true);active.objects.push(stroke);const before=validateProject(active),geometryBefore=geometry(before.objects),collisionBefore=platforms(before.objects),erased=structuredClone(before);
 assert.equal(eraseStroke(erased.objects[0],[{x:68,y:4,pressure:1}],{size:2,pressure:false}),true);const erasedGeometry=geometry(erased.objects);assert.notDeepEqual(erased.objects[0].mask,maskBefore);assert.deepEqual(erased.objects[0].artwork,before.objects[0].artwork);assert.equal(erased.assets[0].src,original.assets[0].src);assert.equal(erased.artRequests,undefined);assert.equal(erased.assets.length,1);
 const undo=applyDiff(erased,projectDiff(erased,before));assert.deepEqual(geometry(undo.objects),geometryBefore);assert.deepEqual(platforms(undo.objects),collisionBefore);const redo=applyDiff(undo,projectDiff(before,erased));assert.deepEqual(geometry(redo.objects),erasedGeometry);
 const reopened=validateProject(JSON.parse(JSON.stringify(redo))),newStroke=shape('after-reopen');assert.equal(bindLiveAssetSheet(reopened,newStroke),true);assert.deepEqual(reopened.assets[0].sheet,before.assets[0].sheet);assert.equal(newStroke.artwork.asset,'atlas');assert.equal(reopened.assets.length,1);assert.equal(reopened.artRequests,undefined);assert.deepEqual(applyDiff(before,projectDiff(before,original)),original);
});

test('scoped sheet treatment leaves the live palette unchanged while explicit whole-level replacement is undoable',async()=>{
 const original=await fixture([shape('paint')]);original.assets.push({...original.assets[0],id:'alternate',name:'Alternate'});const active=applyAssetSheet(original,{assetId:'atlas',roles}).project,scoped=applyAssetSheet(active,{assetId:'alternate',objectIds:['paint'],roles:{platform:roles.platform}}).project;
 assert.equal(scoped.assets[0].sheet.live,true);assert.equal(scoped.assets[1].sheet.live,undefined);assert.deepEqual(scoped.assets[0].sheet.roles,active.assets[0].sheet.roles);const next=shape('after-scope');bindLiveAssetSheet(scoped,next);assert.equal(next.artwork.asset,'atlas');
 const replacement=applyAssetSheet(scoped,{assetId:'alternate',roles:{platform:roles.platform}}).project;assert.equal(replacement.assets[0].sheet.live,undefined);assert.equal(replacement.assets[1].sheet.live,true);assert.equal(bindLiveAssetSheet(replacement,shape('no-background','background')),false);const current=shape('new-current');bindLiveAssetSheet(replacement,current);assert.equal(current.artwork.asset,'alternate');assert.deepEqual(applyDiff(replacement,projectDiff(replacement,scoped)),scoped);
});

test('live binding skips locked, collision, stamped, atlas-treated, hidden and character sources',async()=>{
 const active=applyAssetSheet(await fixture(),{assetId:'atlas',roles:{platform:roles.platform}}).project;
 for(const object of [shape('locked','platform',{locked:true}),shape('collision','platform',{collisionOnly:true}),shape('stamp','platform',{asset:'atlas'}),shape('generated','platform',{artwork:{mode:'atlas',asset:'atlas'}}),shape('unmatched','background')]){const before=structuredClone(object);assert.equal(bindLiveAssetSheet(active,object),false);assert.deepEqual(object,before)}
 active.assets[0].hidden=true;assert.equal(bindLiveAssetSheet(active,shape('hidden-source')),false);delete active.assets[0].hidden;active.assets[0]=await groupSpriteSheet(active.assets[0],{cellWidth:16,cellHeight:16,sheetType:'character'});assert.equal(bindLiveAssetSheet(active,shape('character-source')),false);
});

test('live mappings validate exact crop bounds, modes, tile sizes and roles',async()=>{
 const active=applyAssetSheet(await fixture(),{assetId:'atlas',roles}).project;
 for(const mutate of [sheet=>sheet.live='yes',sheet=>delete sheet.roles,sheet=>sheet.roles.platform.x=.5,sheet=>sheet.roles.platform.w=47,sheet=>sheet.roles.background.x=40,sheet=>sheet.roles.decoration.mode='atlas',sheet=>sheet.roles.water=sheet.roles.background]){const invalid=structuredClone(active);mutate(invalid.assets[0].sheet);assert.throws(()=>validateProject(invalid))}
 const scoped=await fixture([shape('only-background','background')]);assert.throws(()=>applyAssetSheet(scoped,{assetId:'atlas',objectIds:['only-background'],roles:{platform:roles.platform}}),/No unlocked/);assert.equal(scoped.assets[0].sheet.live,undefined);
});

test('reapplying a saved palette preserves its exact roles while explicit new tile settings take effect',async()=>{
 const active=applyAssetSheet(await fixture(),{assetId:'atlas',roles}).project,reused=applyAssetSheet(active,{assetId:'atlas',tileSize:16}).project;assert.deepEqual(reused.assets[0].sheet.roles,active.assets[0].sheet.roles);
 const changed=applyAssetSheet(reused,{assetId:'atlas',tileSize:8}).project,object=shape('smaller-tile');assert.equal(changed.assets[0].sheet.tileSize,8);assert.equal(bindLiveAssetSheet(changed,object),true);assert.deepEqual(object.artwork.source,{x:0,y:0,w:8,h:8});assert.equal(object.artwork.tileSize,8);
});
