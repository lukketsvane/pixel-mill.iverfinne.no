import test from 'node:test';
import assert from 'node:assert/strict';
import {agentFetch} from '../worker/api.mjs';
import {projectDiff,patchSourceHash} from '../dist/agent.mjs';
import {SharedLevel} from '../dist/shared.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';

async function source(red){return dataURL(await encodePNG({w:1,h:1,pixels:Uint8Array.of(red,100,40,255)}))}
const project=src=>({format:'max-level-studio',version:1,name:'Source cache',spawn:{x:0,y:0},assets:[{id:'stable-id',name:'Editable source',w:1,h:1,src}],objects:[]});
class Bucket {constructor(){this.entries=new Map();this.version=0}async get(key){const item=this.entries.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.text)}:null}async put(key,text,{onlyIf}={}){const old=this.entries.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches)return null;const etag=String(++this.version);this.entries.set(key,{text,etag});return{etag}}}

test('room reads and PATCH replies suppress only matching source fingerprints, never same-ID replacements or legacy ID caches',async()=>{
 const oldSource=await source(50),newSource=await source(220),env={BUCKET:new Bucket()};
 const call=(path,body,method=body?'POST':'GET')=>agentFetch(new Request('https://pixel.test'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
 const created=await(await call('/api/rooms',project(oldSource))).json(),path='/api/rooms/'+created.token,oldHash=patchSourceHash(oldSource),newHash=patchSourceHash(newSource),query=pairs=>'?assetVersions='+encodeURIComponent(JSON.stringify(pairs));
 let room=await(await call(path+query([['stable-id',oldHash]]))).json();assert.equal(room.project.assets[0].src,undefined);assert.equal(room.project.assets[0].sourceHash,oldHash);
 room=await(await call(path+'?assets=stable-id')).json();assert.equal(room.project.assets[0].src,oldSource);
 const next=structuredClone(created.project);next.assets[0].src=newSource;
 room=await(await call(path,{diff:projectDiff(created.project,next),knownAssets:[['stable-id',oldHash]]},'PATCH')).json();assert.equal(room.project.assets[0].src,newSource);assert.equal(room.project.assets[0].sourceHash,undefined);
 room=await(await call(path+query([['stable-id',oldHash]]))).json();assert.equal(room.project.assets[0].src,newSource);
 room=await(await call(path+query([['stable-id',newHash]]))).json();assert.equal(room.project.assets[0].src,undefined);assert.equal(room.project.assets[0].sourceHash,newHash);
 const renamed=structuredClone(next);renamed.name='Metadata edit';room=await(await call(path,{diff:projectDiff(next,renamed),knownAssets:['stable-id']},'PATCH')).json();assert.equal(room.project.assets[0].src,newSource);
});

function client(initial){let state=structuredClone(initial),reads=0,previews=0;const shared=new SharedLevel({snapshot:()=>structuredClone(state),busy:()=>false,async apply(next,{guard}){if(!guard())return false;state=next},changed(){},setPlay(){},error(message){throw Error(message)}});shared.token='cache-room';shared.capture=()=>previews++;return{shared,state:()=>state,replace:value=>state=structuredClone(value),reads:()=>reads,previews:()=>previews,reply(value){shared.request=async path=>{assert.equal(path,'/api/rooms/cache-room');reads++;return structuredClone(value)}}}}
const room=(revision,value)=>({revision,project:value,canUndo:false});

test('shared client verifies omitted sources, refetches a changed cache, and never fills a virtual parent from a stale raster',async()=>{
 const first=await source(40),latest=await source(190),before=project(first),harness=client(before),{shared}=harness;
 const omitted=project(first);delete omitted.assets[0].src;omitted.assets[0].sourceHash=patchSourceHash(first);
 await shared.accept(room(1,structuredClone(omitted)));assert.equal(harness.state().assets[0].src,first);assert.equal(harness.state().assets[0].sourceHash,undefined);assert.equal(harness.reads(),0);
 harness.replace(project(latest));harness.reply(room(3,project(latest)));await shared.accept(room(2,omitted));assert.equal(harness.reads(),1);assert.equal(harness.state().assets[0].src,latest);assert.equal(shared.applied,3);
 const virtual=project(first);virtual.assets[0]={id:'stable-id',name:'Virtual parent',w:16,h:16,type:'sprite_sheet',spriteSheet:{source:'assets',frames:[]}};
 await shared.accept(room(4,virtual));assert.equal(harness.state().assets[0].src,undefined);assert.equal(harness.reads(),1);
});

test('source changes used by a level refresh its preview; poll cache claims use bounded fingerprint pairs',async()=>{
 const before=project(await source(20));before.objects=[{id:'placed',asset:'stable-id',x:0,y:0,w:1,h:1}];const harness=client(before),{shared}=harness,after=structuredClone(before);after.assets[0].src=await source(200);
 await shared.accept(room(1,after));assert.equal(harness.previews(),1);
 const large=structuredClone(after);large.assets=Array.from({length:100},(_,index)=>({...after.assets[0],id:'source-'+index}));harness.replace(large);let inspected=false;
 shared.request=async path=>{const url=new URL(path,'https://pixel.test'),claims=JSON.parse(url.searchParams.get('assetVersions'));assert.equal(url.searchParams.has('assets'),false);assert.ok(path.length<6200);assert.ok(claims.length>0&&claims.length<100);assert.ok(claims.every(([id,hash])=>id.startsWith('source-')&&hash===patchSourceHash(after.assets[0].src)));inspected=true;return null};
 await shared.poll();shared.detach();assert.equal(inspected,true);
});
