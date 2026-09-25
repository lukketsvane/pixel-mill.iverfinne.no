import test from 'node:test';
import assert from 'node:assert/strict';
import {agentFetch} from '../worker/api.mjs';
import {Autosave} from '../dist/autosave.mjs';
import {SharedLevel} from '../dist/shared.mjs';
class Bucket{constructor(){this.data=new Map();this.n=0}async get(k){const v=this.data.get(k);return v?{etag:v.etag,json:async()=>JSON.parse(v.text)}:null}async put(k,text,{onlyIf}={}){const v=this.data.get(k);if(onlyIf?.etagMatches&&v?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&v)return null;const etag=String(++this.n);this.data.set(k,{text,etag});return{etag}}}
class Cache{constructor(){this.data=new Map()}async get(id){return structuredClone(this.data.get(id))}async put(r){this.data.set(r.id,structuredClone(r))}async select(id){this.id=id}async active(){const r=await this.get(this.id);return r&&!r.deletedAt?r:null}async records(){return [...this.data.values()].filter(r=>!r.deletedAt)}async list(){return (await this.records()).filter(r=>!r.draft)}}
const project=name=>({format:'max-level-studio',version:1,name,spawn:{x:0,y:0},assets:[],objects:[]});
test('named saves, reversible deletion, stale writers and room identity use one project',async t=>{
 const env={BUCKET:new Bucket()};t.mock.method(globalThis,'fetch',(path,options)=>agentFetch(new Request('https://pixel.test'+path,options),env));
 let state=project('Untitled');const cache=new Cache(),api={snapshot:()=>structuredClone(state),restore:async p=>state=structuredClone(p),status(){},link(){}};
 const save=new Autosave(api,cache);await save.init();save.changed();await save.flush();assert.equal(env.BUCKET.data.size,0);assert.equal((await cache.list()).length,0);
 let response=await fetch('/api/projects',{method:'POST',body:JSON.stringify({project:state})});assert.equal(response.status,400);
 state.name='Nattruinane';save.changed();await save.flush();const id=save.record.id,token=save.record.token;assert.ok(token);assert.equal((await cache.list()).length,1);
 const roomToken='a'.repeat(64);await save.bindRoom(roomToken);await save.flush();const cloud=await (await fetch('/api/projects/'+token)).json();assert.equal(cloud.roomToken,roomToken);
 const reopened=new Autosave(api,cache);await reopened.init({roomToken,skipRestore:true});assert.equal(reopened.record.id,id);assert.equal(reopened.record.token,token);assert.equal((await cache.list()).length,1);
 assert.equal(await reopened.remove(id),true);assert.equal((await cache.list()).length,0);assert.equal((await fetch('/api/projects/'+token)).status,410);
 response=await fetch('/api/projects/'+token,{method:'PUT',body:JSON.stringify({revision:cloud.revision,project:state})});assert.equal(response.status,409);
 await reopened.restoreDeleted();assert.equal((await cache.list()).length,1);assert.equal((await fetch('/api/projects/'+token)).status,200);assert.equal((await cache.get(id)).project.name,'Nattruinane');
});
test('incoming edits wait for gestures and never replace a newer applied revision',async()=>{
 let state=project('Live'),busy=true;const statuses=[];
 const shared=new SharedLevel({snapshot:()=>structuredClone(state),busy:()=>busy,apply:async(next,{guard})=>{if(!guard())return false;state=next},status:s=>statuses.push(s),changed(){},setPlay(){},error(){}});shared.capture=()=>{};shared.token='test';
 const newer={revision:2,project:project('From GPT'),canUndo:true};await shared.accept(newer);assert.equal(state.name,'Live');assert.equal(shared.incoming.revision,2);assert.ok(statuses.includes('Changes waiting…'));
 busy=false;await shared.accept(shared.incoming);assert.equal(state.name,'From GPT');assert.equal(shared.applied,2);
 await shared.accept({revision:1,project:project('Old'),canUndo:false});assert.equal(state.name,'From GPT');assert.equal(statuses.at(-1),'Live');shared.detach();
});
