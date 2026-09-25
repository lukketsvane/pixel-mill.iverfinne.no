import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectDiff,applyDiff} from '../dist/agent.mjs';
import {validateProject} from '../dist/engine.mjs';
import {groupSpriteSheet,editSpriteSheet} from '../dist/spritesheets.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';
import {agentFetch} from '../worker/api.mjs';

async function fixture(seed=0){
 const w=64,h=32,pixels=new Uint8Array(w*h*4);for(let i=0;i<pixels.length;i+=4)pixels.set([(i*71+seed)%256,(i*17+seed)%251,(i*43+seed)%241,255],i);
 const asset=await groupSpriteSheet({id:'sheet',name:'Player sheet',w,h,src:dataURL(await encodePNG({w,h,pixels}))},{cellWidth:16,cellHeight:16});
 return validateProject({format:'max-level-studio',version:1,name:'Compact history',spawn:{x:0,y:0},assets:[asset],objects:[]});
}
const transport=value=>JSON.parse(JSON.stringify(value));

test('sheet group edits omit PNG bytes, use SHA-256 source guards, and round-trip undo and redo',async()=>{
 const before=await fixture(),after=structuredClone(before);after.assets[0]=editSpriteSheet(after.assets[0],[{type:'rename_group',groupId:'row-01',name:'Walk'},{type:'reorder_frames',groupId:'row-01',frameIds:['frame-0-3','frame-0-2','frame-0-1','frame-0-0']}]);
 const patch=transport(projectDiff(before,after)),inverse=transport(projectDiff(after,before)),source=before.assets[0].src;
 assert.equal(patch.assets[0].before.src,undefined);assert.equal(patch.assets[0].after.src,undefined);assert.equal(JSON.stringify(patch).includes('data:image/png'),false);
 assert.equal(patch.assets[0].reuseSource,createHash('sha256').update(source).digest('hex'));
 assert.equal(inverse.assets[0].reuseSource,patch.assets[0].reuseSource);assert.ok(JSON.stringify(patch).length<source.length);
 const applied=applyDiff(before,patch);assert.deepEqual(applied,after);assert.equal(applied.assets[0].src,source);
 const undone=applyDiff(applied,inverse);assert.deepEqual(undone,before);assert.deepEqual(applyDiff(undone,patch),after);
});

test('compact patches reject changed sources and metadata conflicts without partially applying',async()=>{
 const before=await fixture(),after=structuredClone(before);after.name='Changed name';after.assets[0].name='Renamed';const patch=transport(projectDiff(before,after)),changed=await fixture(1),snapshot=structuredClone(changed);
 assert.throws(()=>applyDiff(changed,patch),/Conflict: image source changed/);assert.deepEqual(changed,snapshot);
 const stale=structuredClone(before);stale.assets[0].name='Concurrent name';assert.throws(()=>applyDiff(stale,patch),/Conflict: piece changed/);
 const missing=structuredClone(before);missing.assets=[];assert.throws(()=>applyDiff(missing,patch),/Conflict: image source changed/);
 for(const variant of [
  {...patch.assets[0],reuseSource:'not-a-hash'},
  {...patch.assets[0],before:null},
  {...patch.assets[0],after:null},
  {...patch.assets[0],before:{...patch.assets[0].before,src:before.assets[0].src}},
  {...patch.assets[0],after:{...patch.assets[0].after,src:before.assets[0].src}}
 ])assert.throws(()=>applyDiff(before,{assets:[variant]}),/Invalid source-preserving edit patch/);
 assert.deepEqual(before,await fixture());
});

test('add, remove and replaced-source patches keep required PNGs; legacy full patches still work',async()=>{
 const before=await fixture(),replacement=await fixture(2),changed=structuredClone(before);changed.assets[0].src=replacement.assets[0].src;
 let patch=transport(projectDiff(before,changed));assert.equal(patch.assets[0].reuseSource,undefined);assert.equal(patch.assets[0].before.src,before.assets[0].src);assert.equal(patch.assets[0].after.src,changed.assets[0].src);assert.deepEqual(applyDiff(before,patch),changed);assert.deepEqual(applyDiff(changed,transport(projectDiff(changed,before))),before);
 const empty={...before,assets:[]};patch=transport(projectDiff(empty,before));assert.equal(patch.assets[0].before,null);assert.equal(patch.assets[0].after.src,before.assets[0].src);assert.deepEqual(applyDiff(empty,patch),before);
 const removed=applyDiff(before,transport(projectDiff(before,empty)));assert.deepEqual(removed,empty);assert.deepEqual(applyDiff(removed,patch),before);
 const renamed=structuredClone(before);renamed.assets[0].name='Legacy edit';const legacy={assets:[{id:'sheet',before:structuredClone(before.assets[0]),after:structuredClone(renamed.assets[0])}]};assert.deepEqual(applyDiff(before,legacy),renamed);
});

test('persisted MCP sheet-edit history contains one source PNG across edits and undo',async()=>{
 class Bucket {constructor(){this.records=new Map();this.version=0}async get(key){const item=this.records.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.text)}:null}async put(key,text,{onlyIf}={}){const old=this.records.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches)return null;const etag=String(++this.version);this.records.set(key,{text,etag});return{etag}}}
 const project=await fixture(),env={BUCKET:new Bucket()},request=async(path,body)=>agentFetch(new Request('https://pixel.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env);
 const room=await(await request('/api/rooms',project)).json();let revision=0;
 const tool=async(name,args)=>{const result=await(await request('/api/rooms/'+room.token,{name,arguments:{revision,...args}})).json();assert.equal(result.isError,undefined);revision=result.structuredContent.revision;return result};
 for(let i=0;i<3;i++)await tool('edit_sprite_sheet',{assetId:'sheet',operations:[{type:'rename_group',groupId:'row-01',name:'Walk '+i}]});
 let saved=JSON.parse([...env.BUCKET.records.values()][0].text);assert.equal(saved.history.length,3);assert.equal(JSON.stringify(saved.history).includes('data:image/png'),false);assert.equal(saved.project.assets[0].src,project.assets[0].src);
 await tool('undo_level');saved=JSON.parse([...env.BUCKET.records.values()][0].text);assert.equal(saved.project.assets[0].spriteSheet.groups[0].name,'Walk 1');assert.equal(saved.project.assets[0].src,project.assets[0].src);assert.equal(JSON.stringify(saved.history).includes('data:image/png'),false);
});
