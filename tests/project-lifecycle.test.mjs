import test from 'node:test';
import assert from 'node:assert/strict';
import {agentFetch} from '../worker/api.mjs';
import {projectEvents} from '../worker/project-store.mjs';
import {projectName} from '../dist/project-state.mjs';
import {projectDiff,editProject} from '../dist/agent.mjs';
import {Autosave} from '../dist/autosave.mjs';
import {LiveUpdates} from '../dist/live-updates.mjs';

class Bucket{
 constructor(){this.data=new Map();this.version=0;this.reads=0;this.conditional=0}
 async get(key,options={}){const value=this.data.get(key);if(!value)return null;if(options.ifNoneMatch===value.etag){this.conditional++;return{notModified:true,etag:value.etag}}return{etag:value.etag,json:async()=>{this.reads++;return JSON.parse(value.text)}}}
 async put(key,text,{onlyIf}={}){const old=this.data.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.data.set(key,{text,etag});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.data.delete(key)}
}
class Cache{
 constructor(){this.data=new Map()}
 async get(id){return structuredClone(this.data.get(id))}
 async put(p){this.data.set(p.id,structuredClone(p))}
 async list(){return [...this.data.values()].filter(p=>!p.deletedAt&&!p.draft).map(p=>structuredClone(p))}
 async deleted(){return [...this.data.values()].filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt)}
 async active(){return this.get(this.selected)}
 async select(id){this.selected=id}
 async remove(id){this.data.delete(id);if(this.selected===id)this.selected=null}
}
const base=(name='Garden')=>({format:'max-level-studio',version:1,name,spawn:{x:0,y:0},assets:[],objects:[]});
function harness(){const env={BUCKET:new Bucket()},origin='https://pixel.example';return{env,call:(path,method='GET',data)=>agentFetch(new Request(origin+path,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env)}}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}

test('saved projects require a meaningful name in create, replace and patch endpoints',async()=>{
 const {call,env}=harness();for(const name of ['', '   ', 'Untitled', 'untitled 2', '\u200b', 'x'.repeat(61)]){assert.equal(projectName(name),null);assert.equal((await call('/api/projects','POST',{project:base(name)})).status,400)}assert.equal(env.BUCKET.data.size,0);
 const saved=await json(await call('/api/projects','POST',{project:base('Pølge · Frostpasset')}),201);const path='/api/projects/'+saved.token;
 assert.equal(saved.project.name,'Pølge · Frostpasset');assert.equal((await call(path,'PUT',{project:base(''),revision:0})).status,400);
 assert.equal((await call(path,'PATCH',{diff:projectDiff(saved.project,base('Untitled'))})).status,400);assert.equal((await json(await call(path))).revision,0);
});

test('project and MCP use one revision; disjoint edits merge and overlapping edits do not overwrite',async()=>{
 const {call}=harness();const saved=await json(await call('/api/projects','POST',{project:base()}),201),path='/api/projects/'+saved.token;
 const room=await json(await call('/api/rooms','POST',{projectToken:saved.token,revision:saved.revision}),201);assert.equal(room.revision,1);assert.equal(room.projectToken,saved.token);
 const read=await json(await call(path));assert.equal(read.roomToken,room.token);assert.equal(read.revision,1);
 const rpc=await json(await call('/mcp/'+room.token,'POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'edit_level',arguments:{revision:1,operations:[{type:'block',id:'platform',x:24,y:16}]}}}));assert.equal(rpc.result.isError,undefined);
 const merged=await json(await call(path,'PATCH',{diff:projectDiff(read.project,{...read.project,name:'Human name'})}));assert.equal(merged.project.objects[0].id,'platform');assert.equal(merged.project.name,'Human name');assert.equal(merged.revision,3);
 assert.equal((await call(path,'PATCH',{diff:projectDiff(read.project,{...read.project,name:'Stale name'})})).status,409);
 const current=await json(await call('/api/rooms/'+room.token));assert.equal(current.project.name,'Human name');assert.equal(current.revision,3);
 assert.equal((await call(path+'?revision=3')).status,304);
});

test('adopting an existing room does not copy its project; revoking a room retains the saved project',async()=>{
 const {call,env}=harness();const room=await json(await call('/api/rooms','POST',base('Legacy room')),201);const originalKey=[...env.BUCKET.data.keys()][0];
 const saved=await json(await call('/api/projects','POST',{roomToken:room.token}),201),path='/api/projects/'+saved.token;
 const records=[...env.BUCKET.data.values()].map(o=>JSON.parse(o.text));assert.equal(records.filter(o=>o.project).length,1);assert.ok(records.some(o=>o.ref===originalKey));
 const again=await json(await call('/api/projects','POST',{roomToken:room.token}));assert.equal(again.token,saved.token);
 await json(await call('/api/rooms/'+room.token,'DELETE'));assert.equal((await call('/api/rooms/'+room.token)).status,410);
 const current=await json(await call(path));assert.equal(current.project.name,'Legacy room');assert.equal(current.roomToken,null);
 const next=await json(await call('/api/rooms','POST',{projectToken:saved.token,revision:current.revision}),201);assert.notEqual(next.token,room.token);
});

test('deletion checks the revision, removes project bytes and cannot be undone by an in-flight save',async()=>{
 const {call,env}=harness();const saved=await json(await call('/api/projects','POST',{project:base()}),201),path='/api/projects/'+saved.token;
 const room=await json(await call('/api/rooms','POST',{projectToken:saved.token,revision:0}),201);
 assert.equal((await call(path,'DELETE',{revision:0})).status,409);assert.equal((await call(path)).status,200);
 const key=[...env.BUCKET.data.keys()].find(key=>key.startsWith('projects/')),prior=env.BUCKET.data.get(key);
 await json(await call(path,'DELETE',{revision:room.revision}));assert.equal((await call(path)).status,410);assert.equal((await call('/api/rooms/'+room.token)).status,410);
 assert.equal((await call(path,'PUT',{revision:room.revision,project:base('Resurrect')})).status,410);assert.equal((await call('/api/projects','POST',{token:saved.token,project:base('Retry')})).status,410);
 assert.equal(await env.BUCKET.put(key,prior.text,{onlyIf:{etagMatches:prior.etag}}),null);
 assert.deepEqual(Object.keys(JSON.parse(env.BUCKET.data.get(key).text)).sort(),['deleted','recoveryKey','revision']);
});

test('unnamed drafts remain local; offline deletion preserves recovery and successful deletion removes it',async t=>{
 const {call,env}=harness(),oldFetch=globalThis.fetch,cache=new Cache();let state=base('Untitled'),offline=false;
 globalThis.fetch=(path,options={})=>{if(offline)throw Error('offline');return call(path,options.method||'GET',options.body?JSON.parse(options.body):undefined)};t.after(()=>globalThis.fetch=oldFetch);
 const save=new Autosave({snapshot:()=>structuredClone(state),restore:async p=>state=structuredClone(p),status:()=>{},link:()=>{}},cache);t.after(()=>save.stop());
 await save.init();save.changed();await save.flush();assert.equal(env.BUCKET.data.size,0);assert.equal(save.record.token,null);assert.equal(cache.data.size,1);
 state.name='Named draft';save.changed();await save.flush();const id=save.record.id;assert.ok(save.record.token);assert.equal(save.dirty,false);
 offline=true;await assert.rejects(save.remove(id),/offline/);assert.ok(await cache.get(id));assert.equal(save.ready,true);
 offline=false;assert.equal(await save.remove(id),true);assert.ok((await cache.get(id)).deletedAt);assert.equal((await cache.list()).length,0);assert.equal(save.record,null);await save.restoreDeleted();assert.equal((await cache.list()).length,1);
});

test('a saved editor receives remote updates, defers during a gesture and never silently forks a conflict',async t=>{
 const {call,env}=harness(),oldFetch=globalThis.fetch;let state=base(),busy=false;
 globalThis.fetch=(path,options={})=>call(path,options.method||'GET',options.body?JSON.parse(options.body):undefined);t.after(()=>globalThis.fetch=oldFetch);
 const save=new Autosave({snapshot:()=>structuredClone(state),restore:async p=>state=structuredClone(p),apply:async(p,{guard})=>{if(!guard())return false;state=structuredClone(p)},busy:()=>busy,status:()=>{},link:()=>{}},new Cache());t.after(()=>save.stop());await save.init();save.changed();await save.flush();const token=save.record.token,path='/api/projects/'+token;
 let remote=await json(await call(path));await json(await call(path,'PATCH',{diff:projectDiff(remote.project,{...remote.project,name:'From GPT'})}));
 busy=true;assert.equal(await save.pull(),false);assert.equal(state.name,'Garden');busy=false;await save.pull();assert.equal(state.name,'From GPT');
 remote=await json(await call(path));await json(await call(path,'PATCH',{diff:projectDiff(remote.project,{...remote.project,name:'Other tab'})}));state.name='Local work';save.changed();const count=env.BUCKET.data.size;await save.flush();
 assert.equal(save.record.token,token);assert.equal(save.record.project.name,'Local work');assert.equal(save.dirty,true);assert.match(save.blocked,/Conflict/);assert.equal(env.BUCKET.data.size,count);assert.equal((await json(await call(path))).project.name,'Other tab');
});

test('revision streams send small notifications, use conditional reads and stop on abort',async()=>{
 const bucket=new Bucket(),record={project:base(),revision:0},stored=await bucket.put('project',JSON.stringify(record)),abort=new AbortController();
 const response=projectEvents(new Request('https://pixel.example/events',{signal:abort.signal}),bucket,'project',{record,object:stored},null,{interval:5,lifetime:1000}),reader=response.body.getReader(),decoder=new TextDecoder();
 try{
  assert.equal(response.headers.get('content-type'),'text/event-stream');let text=decoder.decode((await reader.read()).value);text+=decoder.decode((await reader.read()).value);assert.match(text,/"revision":0/);assert.doesNotMatch(text,/assets|objects/);
  const heartbeat=decoder.decode((await reader.read()).value);assert.match(heartbeat,/keepalive/);assert.ok(bucket.conditional>0);
  await bucket.put('project',JSON.stringify({...record,revision:1}),{onlyIf:{etagMatches:stored.etag}});let event='';while(!event.includes('"revision":1')){const next=await reader.read();assert.equal(next.done,false);event+=decoder.decode(next.value)}assert.doesNotMatch(event,/assets|objects/);
  abort.abort();while(!(await reader.read()).done){}const reads=bucket.reads;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(bucket.reads,reads);
 }finally{abort.abort();await reader.cancel()}
});

test('live client retries deferred drawing updates and ignores events from an old project',async t=>{
 const old=globalThis.EventSource,sources=[];class Source{constructor(path){this.path=path;this.events={};sources.push(this)}addEventListener(name,fn){this.events[name]=fn}close(){this.closed=true}}
 globalThis.EventSource=Source;t.after(()=>globalThis.EventSource=old);let revision=0,calls=0;
 const live=new LiveUpdates({revision:()=>revision,refresh:async()=>{calls++;if(calls===1)return false;revision=2;return true}});t.after(()=>live.stop());
 live.start('/api/projects/first');sources[0].events.change({data:JSON.stringify({revision:2})});await live.inflight;assert.equal(live.deferred,true);await new Promise(resolve=>setTimeout(resolve,420));assert.equal(revision,2);
 const oldSource=sources[0];live.start('/api/projects/second');const count=calls;oldSource.events.change({data:'{"revision":99}'});await Promise.resolve();assert.equal(calls,count);assert.equal(oldSource.closed,true);live.stop();assert.equal(sources[1].closed,true);
});
