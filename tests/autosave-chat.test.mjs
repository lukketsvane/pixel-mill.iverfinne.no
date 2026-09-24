import test from 'node:test';
import assert from 'node:assert/strict';
import {Autosave} from '../dist/autosave.mjs';
import {agentFetch} from '../worker/api.mjs';
import {designWithAgent} from '../worker/chat.mjs';
class Bucket{constructor(){this.map=new Map();this.n=0}async get(k){const v=this.map.get(k);return v?{etag:v.etag,json:async()=>JSON.parse(v.text)}:null}async put(k,text,options={}){const old=this.map.get(k),c=options.onlyIf;if(c?.etagMatches&&old?.etag!==c.etagMatches||c?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.n);this.map.set(k,{text,etag});return{etag}}async delete(k){for(const key of Array.isArray(k)?k:[k])this.map.delete(key)}}
class Cache{constructor(){this.map=new Map()}async put(p){this.map.set(p.id,structuredClone(p))}async get(id){return structuredClone(this.map.get(id))}async list(){return[...this.map.values()]}async select(id){this.id=id}active(){return this.get(this.id)}}
const empty=()=>({format:'max-level-studio',version:1,name:'Untitled',spawn:{x:0,y:0},assets:[],objects:[]});
test('autosave persists to cloud, restores offline edits and forks conflicts without losing either version',async()=>{
 const env={BUCKET:new Bucket()},cache=new Cache();let project=empty(),online=true;const previous=globalThis.fetch;
 globalThis.fetch=(path,options)=>{if(!online)return Promise.reject(Error('Offline'));return agentFetch(new Request('https://pixel.example'+path,options),env)};
 const api={snapshot:()=>structuredClone(project),restore:async p=>project=structuredClone(p),status(){},link(){}};
 try{
  const save=new Autosave(api,cache);await save.init();project.name='First';save.changed();await save.flush();const token=save.record.token;assert.ok(token);assert.equal(save.dirty,false);
  const remote=await(await fetch('/api/projects/'+token)).json();assert.equal(remote.project.name,'First');
  online=false;project.name='Offline work';save.changed();await save.flush();assert.equal((await cache.active()).project.name,'Offline work');assert.equal((await cache.active()).dirty,true);
  project=empty();const restored=new Autosave(api,cache);await restored.init({token});await restored.saving;assert.equal(project.name,'Offline work');online=true;await restored.flush();assert.equal(restored.dirty,false);
  const old=await(await fetch('/api/projects/'+token)).json();await fetch('/api/projects/'+token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:old.revision,project:{...old.project,name:'Other device'}})});
  project.name='Local preserved';restored.changed();await restored.flush();assert.notEqual(restored.record.token,token);assert.equal((await(await fetch('/api/projects/'+token)).json()).project.name,'Other device');assert.equal((await(await fetch('/api/projects/'+restored.record.token)).json()).project.name,'Local preserved');
  project.name='Committed';restored.changed();project.name='Transient drag preview';await restored.flush();assert.equal((await(await fetch('/api/projects/'+restored.record.token)).json()).project.name,'Committed');
 }finally{globalThis.fetch=previous}
});
test('chat reports a missing provider honestly and uses validated, grid-snapped draft edits',async()=>{
 await assert.rejects(()=>designWithAgent({project:empty(),message:'Design a floor'},{}),/not connected/);
 let n=0;const input=empty(),result=await designWithAgent({project:input,message:'Design a floor',grid:4},{OPENAI_API_KEY:'test'},async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);return Response.json({status:'completed',output:n++===0?[{type:'function_call',call_id:'call1',name:'edit_level',arguments:JSON.stringify({revision:0,operations:[{type:'block',id:'floor',x:5.4,y:3.8,width:100,height:12,rotation:13}]})}]:[{type:'message',content:[{type:'output_text',text:'Added the floor.'}]}]})});assert.equal(input.objects.length,0);assert.deepEqual([result.project.objects[0].x,result.project.objects[0].y,result.project.objects[0].rotation],[4,4,15]);assert.equal(result.reply,'Added the floor.');
});
test('chat endpoint persists a successful draft as one undo and rejects a stale starting revision',async()=>{
 const env={BUCKET:new Bucket(),OPENAI_API_KEY:'test'},origin='https://pixel.example';
 const call=(path,data,method='POST')=>agentFetch(new Request(origin+path,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),env);
 const created=await(await call('/api/rooms',empty())).json();const previous=globalThis.fetch;let n=0;
 globalThis.fetch=async()=>Response.json({status:'completed',output:n++===0?[{type:'function_call',call_id:'draft',name:'edit_level',arguments:JSON.stringify({revision:0,operations:[{type:'block',id:'one'},{type:'block',id:'two',x:40}]})}]:[{type:'message',content:[{type:'output_text',text:'Added two platforms.'}]}]});
 try{const response=await call('/api/rooms/'+created.token+'/chat',{revision:0,message:'Two platforms',grid:4});assert.equal(response.status,200);const answer=await response.json();assert.equal(answer.room.project.objects.length,2);assert.equal(answer.room.revision,1);const stale=await call('/api/rooms/'+created.token+'/chat',{revision:0,message:'Move them'});assert.equal(stale.status,409);const undone=await(await call('/api/rooms/'+created.token,{name:'undo_level',arguments:{revision:1}})).json();assert.equal(undone.structuredContent.objects.length,0)}finally{globalThis.fetch=previous}
});
