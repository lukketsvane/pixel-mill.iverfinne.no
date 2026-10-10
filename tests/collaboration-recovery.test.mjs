import test from 'node:test';
import assert from 'node:assert/strict';
import {agentFetch} from '../worker/api.mjs';
import {projectDiff,applyDiff,editProject} from '../dist/agent.mjs';
import {Autosave} from '../dist/autosave.mjs';
import {SharedLevel} from '../dist/shared.mjs';
import {LiveUpdates} from '../dist/live-updates.mjs';

class Bucket{
 constructor(){this.data=new Map();this.version=0}
 async get(key,options={}){const value=this.data.get(key);if(!value)return null;if(options.ifNoneMatch===value.etag)return{notModified:true,etag:value.etag};return{etag:value.etag,json:async()=>JSON.parse(value.text)}}
 async put(key,text,{onlyIf}={}){const old=this.data.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.data.set(key,{text,etag});return{etag}}
 async delete(key){this.data.delete(key)}
}
class Cache{
 constructor(){this.data=new Map()}
 async get(id){return structuredClone(this.data.get(id))}
 async put(record){this.data.set(record.id,structuredClone(record))}
 async list(){return[...this.data.values()].map(record=>structuredClone(record))}
 async active(){return this.get(this.id)}
 async select(id){this.id=id}
}
const base=()=>editProject({format:'max-level-studio',version:1,name:'Co-design',spawn:{x:0,y:0},assets:[],objects:[]},[{type:'block',id:'floor',width:80,height:16},{type:'block',id:'ledge',x:100,y:20}]);
const update=(project,id,changes)=>editProject(project,[{type:'update',id,changes}]);
function server(){const env={BUCKET:new Bucket()};return{env,call:(path,method='GET',data)=>agentFetch(new Request('https://pixel.test'+path,{method,headers:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env)}}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}

test('field merges preserve human movement, AI styling, unrelated deletion and concurrent layer order',()=>{
 const before=base(),human=update(before,'floor',{x:12}),ai=update(before,'floor',{color:'#aabbcc'}),merged=applyDiff(ai,projectDiff(before,human));
 assert.equal(merged.objects[0].x,12);assert.equal(merged.objects[0].color,'#aabbcc');
 const undone=applyDiff(merged,projectDiff(human,before));assert.equal(undone.objects[0].x,0);assert.equal(undone.objects[0].color,'#aabbcc');
 assert.throws(()=>applyDiff(update(before,'floor',{x:28}),projectDiff(before,human)),/Conflict: piece changed \(x\)/);
 assert.throws(()=>applyDiff(update(before,'floor',{locked:true}),projectDiff(before,human)),/locked/);
 assert.throws(()=>applyDiff(ai,projectDiff(before,{...before,objects:before.objects.slice(1)})),/Conflict/);
 const added=editProject(before,[{type:'block',id:'new',x:200}]),remote=editProject(before,[{type:'delete',ids:['ledge']}]);
 assert.deepEqual(applyDiff(remote,projectDiff(before,added)).objects.map(o=>o.id),['floor','new']);
 const reordered=editProject(before,[{type:'order',id:'floor',direction:'front'}]);
 assert.deepEqual(applyDiff(reordered,projectDiff(before,added)).objects.map(o=>o.id),['ledge','new','floor']);
 const removed={...before,objects:before.objects.slice(1)};assert.deepEqual(applyDiff(removed,projectDiff(removed,before)),before);
});

test('ChatGPT can rebase a recent stale edit, retry without duplication, and reject an actual overlap',async()=>{
 const {call}=server(),created=await json(await call('/api/rooms','POST',base()),201),path='/api/rooms/'+created.token;
 const tool=async(name,args)=>json(await call('/mcp/'+created.token,'POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}));
 await json(await call(path,'PATCH',{diff:projectDiff(created.project,update(created.project,'floor',{x:24})),mutationId:'human-move-00000001'}));
 const args={revision:0,mutationId:'chatgpt-style-000001',operations:[{type:'update',id:'floor',changes:{color:'#ffeeaa'}},{type:'block',x:200}],verify:true};
 const first=(await tool('edit_level',args)).result;assert.equal(first.isError,undefined);assert.equal(first.structuredContent.rebased,true);assert.equal(first.structuredContent.objects.find(o=>o.id==='floor').x,24);
 const again=(await tool('edit_level',args)).result;assert.equal(again.structuredContent.replayed,true);assert.equal(again.structuredContent.revision,2);assert.equal((await json(await call(path))).project.objects.length,3);
 const clash=(await tool('edit_level',{revision:0,operations:[{type:'update',id:'floor',changes:{x:80}}]})).result;assert.equal(clash.isError,true);assert.equal(clash.structuredContent.nextTool,'get_level');
 assert.equal((await json(await call(path))).project.objects[0].x,24);
 await tool('undo_level',{revision:2});const undone=await json(await call(path));assert.equal(undone.project.objects.length,2);assert.equal(undone.project.objects[0].x,24);assert.equal(undone.project.objects[0].color,undefined);
});

test('a lost save response survives reload and replays once before merging later human and AI work',async t=>{
 const {call,env}=server(),previous=globalThis.fetch,cache=new Cache();let state=base(),lost=false,offline=false,saves=0;
 globalThis.fetch=async(path,options={})=>{if(offline)throw Error('offline');const result=await call(path,options.method||'GET',options.body?JSON.parse(options.body):undefined);if(options.method==='PATCH'){saves++;if(lost){lost=false;throw Error('response lost')}}return result};t.after(()=>globalThis.fetch=previous);
 const make=()=>new Autosave({snapshot:()=>structuredClone(state),restore:async p=>state=structuredClone(p),status(){},link(){}},cache);
 const save=make();t.after(()=>save.stop());await save.init();save.changed();await save.flush();const path='/api/projects/'+save.record.token;
 state=update(state,'floor',{x:16});save.changed();lost=true;await save.flush();assert.equal(save.dirty,true);assert.ok((await cache.active()).pendingMutation);
 state=update(state,'floor',{x:32});save.changed();await save.cacheQueue;save.stop();
 const remote=await json(await call(path));await json(await call(path,'PATCH',{diff:projectDiff(remote.project,update(remote.project,'floor',{color:'#556677'})),mutationId:'remote-style-000001'}));
 offline=true;const resumed=make();t.after(()=>resumed.stop());await resumed.init();assert.equal(state.objects[0].x,32);offline=false;await resumed.retry();
 assert.equal(resumed.dirty,false);assert.equal(resumed.blocked,null);assert.equal(state.objects[0].x,32);assert.equal(state.objects[0].color,'#556677');assert.equal(resumed.record.pendingMutation,undefined);assert.equal(saves,3);
 const stored=[...env.BUCKET.data.values()].map(v=>JSON.parse(v.text)).find(v=>v.project);assert.equal(stored.history.length,3);assert.equal(stored.project.objects[0].x,32);
});

test('saved shared sessions use one durable writer and automatically recover from storage outages',async t=>{
 const {call}=server(),previous=globalThis.fetch;let state=base(),offline=false,patchPaths=[],save;
 globalThis.fetch=async(path,options={})=>{if(offline)return Response.json({error:'Storage unavailable'},{status:503});if(options.method==='PATCH')patchPaths.push(path);return call(path,options.method||'GET',options.body?JSON.parse(options.body):undefined)};t.after(()=>globalThis.fetch=previous);
 const shared=new SharedLevel({snapshot:()=>structuredClone(state),busy:()=>false,apply:async(p,{guard})=>{if(!guard())return false;state=structuredClone(p)},changed(){},setPlay(){},error(){},persist:()=>save?.record?.token?save.flush():null,localChanges:()=>!!(save?.dirty||save?.saving),accepted:(room,token)=>save.acceptRemote(room,token)});shared.capture=()=>{};t.after(()=>shared.detach());
 save=new Autosave({snapshot:()=>structuredClone(state),restore:async p=>state=structuredClone(p),shared:()=>shared,status(){},link(){}},new Cache());t.after(()=>save.stop());await save.init();save.changed();await save.flush();
 const room=await json(await call('/api/rooms','POST',{projectToken:save.record.token,revision:0}),201);shared.token=room.token;await shared.accept(room);
 const before=structuredClone(state);state=update(state,'floor',{x:16});save.changed();offline=true;await shared.push(before,state);assert.equal(save.dirty,true);assert.equal(shared.paused,false);
 offline=false;const remote=update(room.project,'floor',{color:'#778899'});await json(await call('/api/rooms/'+room.token,'PATCH',{diff:projectDiff(room.project,remote)}));
 await save.retry();assert.equal(save.dirty,false);assert.equal(shared.paused,false);assert.equal(state.objects[0].x,16);assert.equal(state.objects[0].color,'#778899');assert.equal(shared.applied,save.record.revision);assert.ok(patchPaths.every(path=>path.startsWith('/api/projects/')));
});

test('live failures back off and close streams instead of rapid reconnect loops',async t=>{
 const previous=globalThis.EventSource;let source;
 globalThis.EventSource=class{constructor(){source=this;this.events={}}addEventListener(name,fn){this.events[name]=fn}close(){this.closed=true}};t.after(()=>globalThis.EventSource=previous);
 const live=new LiveUpdates({revision:()=>0,refresh:async()=>{throw Object.assign(Error('Storage unavailable'),{status:503})}});t.after(()=>live.stop());live.start('/api/projects/test');
 source.onerror();assert.equal(source.closed,true);assert.equal(live.failures,1);assert.equal(live.timer._idleTimeout,4000);
 await live.pull();assert.equal(live.failures,2);assert.equal(live.timer._idleTimeout,8000);assert.equal(live.deferred,false);
});

test('scheduled stream renewal does not report an outage or apply a closed stream event',async t=>{
 const previous=globalThis.EventSource,sources=[],statuses=[];
 globalThis.EventSource=class{constructor(){this.events={};sources.push(this)}addEventListener(name,fn){this.events[name]=fn}close(){this.closed=true}};t.after(()=>globalThis.EventSource=previous);
 const live=new LiveUpdates({revision:()=>1,refresh:async()=>true,status:text=>statuses.push(text)});t.after(()=>live.stop());live.start('/api/projects/test');
 sources[0].events.change({data:'{"revision":1}'});sources[0].events.renew();sources[0].onerror();assert.equal(sources.length,2);assert.equal(sources[0].closed,true);assert.equal(live.failures,0);assert.deepEqual(statuses,['Live']);
});

test('a lost first-project response preserves edits made before retry without creating another project',async t=>{
 const {call,env}=server(),previous=globalThis.fetch,cache=new Cache();let state=base(),drop=true;
 globalThis.fetch=async(path,options={})=>{const response=await call(path,options.method||'GET',options.body?JSON.parse(options.body):undefined);if(path==='/api/projects'&&drop){drop=false;throw Error('response lost')}return response};t.after(()=>globalThis.fetch=previous);
 const save=new Autosave({snapshot:()=>structuredClone(state),restore:async p=>state=structuredClone(p),status(){},link(){}},cache);t.after(()=>save.stop());await save.init();save.changed();await save.flush();assert.ok(save.record.pendingProject);assert.equal(env.BUCKET.data.size,1);
 state=update(state,'floor',{x:64});save.changed();await save.retry();assert.equal(save.dirty,false);assert.equal(state.objects[0].x,64);assert.equal(env.BUCKET.data.size,1);assert.equal(save.record.pendingProject,undefined);
});
