import test from 'node:test';
import assert from 'node:assert/strict';
import {Autosave} from '../dist/autosave.mjs';
import {editProject,projectDiff,applyDiff} from '../dist/agent.mjs';
import {prepareArtwork,applyArtwork} from '../dist/artwork.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';
import {agentFetch} from '../worker/api.mjs';

class DraftCache{
 constructor(){this.records=new Map()}
 async get(id){return structuredClone(this.records.get(id))}
 async put(record){this.records.set(record.id,structuredClone(record))}
 async list(){return[...this.records.values()].map(record=>structuredClone(record))}
 async select(id){this.id=id}
 async active(){return this.get(this.id)}
}
async function fixture(){
 const base=editProject({format:'max-level-studio',version:1,name:'Validation recovery',spawn:{x:0,y:0},assets:[],objects:[]},[{type:'stroke',id:'collision',width:8,points:[{x:0,y:0},{x:20,y:10}]},{type:'block',id:'floor',x:30,y:10,width:8,height:4,role:'platform'}]),prepared=await prepareArtwork(base,{includeImages:false}),src=dataURL(await encodePNG({w:prepared.request.width,h:prepared.request.height,pixels:new Uint8Array(prepared.request.width*prepared.request.height*4).fill(255)})),styled=(await applyArtwork(prepared.project,{requestId:prepared.request.id,dataUrl:src})).project;
 return{base,styled,src};
}
function editor(initial,cache=new DraftCache()){
 let state=structuredClone(initial);const statuses=[];
 const save=new Autosave({snapshot:()=>structuredClone(state),restore:async next=>{state=structuredClone(next)},status:text=>statuses.push(text),link(){}},cache);
 return{save,cache,statuses,get state(){return state},set state(next){state=next}};
}

test('invalid collision edits retain the canonical artwork and cache all later local strokes until a valid correction',async t=>{
 const {base,styled,src}=await fixture(),view=editor(base),{save,cache}=view;t.after(()=>save.stop());await save.init();save.record.project=structuredClone(styled);save.record.baseProject=structuredClone(styled);
 view.state.objects.find(object=>object.id==='collision').kind='decor';save.changed();await save.cacheQueue;
 assert.equal(save.blocked,'Invalid collision stroke. Local work kept.');assert.equal(save.validationBlocked,true);assert.deepEqual(save.record.project,styled);assert.deepEqual(save.viewProject,base);assert.equal((await cache.active()).draftProject.objects[0].kind,'decor');assert.deepEqual((await cache.active()).draftBaseProject,base);
 const added=editProject(base,[{type:'block',id:'new-stroke',x:70,y:30,width:9,height:3,role:'platform'}]).objects.at(-1);view.state.objects.push(added);view.state.assets.push({id:'new-import',name:'Imported while blocked',w:styled.assets[0].w,h:styled.assets[0].h,src});save.changed();await save.flush();await save.cacheQueue;
 assert.equal((await cache.active()).draftProject.objects.length,3);assert.equal((await cache.active()).draftProject.assets[0].id,'new-import');assert.deepEqual(save.record.project,styled);assert.equal(save.blocked,'Invalid collision stroke. Local work kept.');
 view.state.objects.find(object=>object.id==='collision').kind='solid';save.changed();await save.cacheQueue;
 assert.equal(save.blocked,null);assert.equal(save.validationBlocked,false);assert.equal(save.dirty,true);assert.equal(save.record.project.objects.length,3);assert.equal(save.record.project.assets.length,2);assert.deepEqual(save.record.project.objects.find(object=>object.id==='floor').artwork,styled.objects.find(object=>object.id==='floor').artwork);assert.deepEqual(save.record.project.artRequests,styled.artRequests);assert.ok(save.record.project.assets.some(asset=>asset.id==='new-import'));assert.equal((await cache.active()).draftProject,undefined);assert.equal((await cache.active()).draftBaseProject,undefined);
});

test('reloading an invalid cached draft restores its exact local view and retains the canonical merge anchor for correction',async t=>{
 const {base,styled}=await fixture(),view=editor(base),{save,cache}=view;t.after(()=>save.stop());await save.init();save.record.project=structuredClone(styled);save.record.baseProject=structuredClone(styled);view.state.objects[0].kind='platform';save.changed();view.state.objects.push(editProject(base,[{type:'block',id:'after-invalid',x:90,y:0}]).objects.at(-1));save.changed();await save.cacheQueue;const cached=await cache.active();save.stop();
 const reopened=editor(base,cache);t.after(()=>reopened.save.stop());await reopened.save.init();assert.deepEqual(reopened.state,cached.draftProject);assert.deepEqual(reopened.save.record.project,styled);assert.deepEqual(reopened.save.viewProject,base);assert.equal(reopened.save.blocked,'Invalid collision stroke. Local work kept.');assert.ok(reopened.statuses.includes('Invalid collision stroke. Local work kept.'));
 reopened.state.objects[0].kind='solid';reopened.save.changed();await reopened.save.cacheQueue;assert.equal(reopened.save.blocked,null);assert.ok(reopened.save.record.project.objects.some(object=>object.id==='after-invalid'));assert.deepEqual(reopened.save.record.project.objects.find(object=>object.id==='floor').artwork,styled.objects.find(object=>object.id==='floor').artwork);assert.equal((await cache.active()).draftError,undefined);
});

test('an in-flight save acknowledgement preserves an invalid local draft until correction and keeps remote artwork',async t=>{
 const {base,styled}=await fixture(),view=editor(base),{save,cache}=view,acknowledgements=[];t.after(()=>save.stop());await save.init();save.record.token='a'.repeat(64);save.record.baseProject=structuredClone(base);
 let release,entered,calls=0,canonical=structuredClone(styled);const started=new Promise(resolve=>entered=resolve),pendingReply=new Promise(resolve=>release=resolve);canonical.name='Pending save';save.api.shared=()=>({acknowledge:(room,applied)=>acknowledgements.push(applied)});
 save.request=async(path,options)=>{calls++;if(calls===1){entered();await pendingReply}else canonical=applyDiff(canonical,JSON.parse(options.body).diff);return{project:structuredClone(canonical),revision:calls}};
 view.state.name='Pending save';save.changed();const pending=save.flush();await started;view.state.objects[0].kind='decor';view.state.objects.push(editProject(base,[{type:'block',id:'during-save',x:120}]).objects.at(-1));save.changed();const draft=structuredClone(view.state);release();await pending;await save.cacheQueue;
 assert.deepEqual(view.state,draft);assert.deepEqual(save.record.draftProject,draft);assert.deepEqual((await cache.active()).draftProject,draft);assert.equal((await cache.active()).dirty,true);assert.equal(save.dirty,true);assert.equal(save.blocked,'Invalid collision stroke. Local work kept.');assert.equal(view.statuses.at(-1),save.blocked);assert.deepEqual(acknowledgements,[false]);assert.deepEqual(save.record.project,canonical);
 view.state.objects[0].kind='solid';save.changed();await save.flush();assert.equal(save.blocked,null);assert.equal(save.dirty,false);assert.equal(canonical.objects.length,3);assert.equal(canonical.objects[0].kind,'solid');assert.ok(canonical.objects.some(object=>object.id==='during-save'));assert.deepEqual(canonical.objects.find(object=>object.id==='floor').artwork,styled.objects.find(object=>object.id==='floor').artwork);assert.deepEqual(canonical.assets,styled.assets);assert.deepEqual(view.state,canonical);assert.equal((await cache.active()).draftProject,undefined);
});

test('a successful later edit does not clear a real overlapping-edit conflict',async t=>{
 const {base}=await fixture(),view=editor(base),{save}=view;t.after(()=>save.stop());await save.init();save.record.project=editProject(base,[{type:'update',id:'floor',changes:{x:80}}]);view.state=editProject(base,[{type:'update',id:'floor',changes:{x:40}}]);save.changed();assert.equal(save.blocked,'Conflict · local copy kept');assert.equal(save.validationBlocked,false);assert.equal(save.record.draftProject,undefined);
 view.state=editProject(view.state,[{type:'block',id:'another-local-stroke',x:100}]);save.changed();assert.equal(save.blocked,'Conflict · local copy kept');assert.equal(save.record.project.objects.at(-1).id,'another-local-stroke');
 view.state.objects[0].kind='decor';save.changed();await save.cacheQueue;assert.equal(save.blocked,'Conflict · local copy kept');assert.equal(save.validationBlocked,false);const reopened=editor(base,view.cache);t.after(()=>reopened.save.stop());await reopened.save.init();assert.equal(reopened.save.blocked,'Conflict · local copy kept');reopened.state.objects[0].kind='solid';reopened.save.changed();assert.equal(reopened.save.blocked,'Conflict · local copy kept');assert.equal(reopened.save.validationBlocked,false);
});

test('a corrected draft saves to the same cloud project with remote artwork and later human strokes intact',async t=>{
 const {base,styled}=await fixture(),records=new Map();let revision=0;const env={BUCKET:{async get(key){const value=records.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null},async put(key,text,{onlyIf}={}){const old=records.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++revision);records.set(key,{etag,text});return{etag}}}},previous=globalThis.fetch;
 globalThis.fetch=(path,options={})=>agentFetch(new Request(new URL(path,'https://pixel.example'),options),env);t.after(()=>globalThis.fetch=previous);
 const view=editor(base),{save}=view;t.after(()=>save.stop());await save.init();save.changed();await save.flush();const token=save.record.token,path='/api/projects/'+token;
 const response=await fetch(path,{method:'PATCH',body:JSON.stringify({diff:projectDiff(base,styled)})});assert.equal(response.status,200);const remote=await response.json();save.record.project=structuredClone(remote.project);save.record.baseProject=structuredClone(remote.project);save.record.revision=remote.revision;
 view.state.objects[0].kind='decor';save.changed();view.state.objects.push(editProject(base,[{type:'block',id:'human-after-invalid',x:140}]).objects.at(-1));save.changed();await save.flush();assert.equal(save.validationBlocked,true);assert.equal((await(await fetch(path)).json()).project.objects.length,2);
 view.state.objects[0].kind='solid';save.changed();await save.flush();const persisted=await(await fetch(path)).json();assert.equal(save.record.token,token);assert.equal(save.blocked,null);assert.equal(save.dirty,false);assert.equal(persisted.project.objects.length,3);assert.equal(persisted.project.objects[0].kind,'solid');assert.ok(persisted.project.objects.some(object=>object.id==='human-after-invalid'));assert.deepEqual(persisted.project.objects.find(object=>object.id==='floor').artwork,styled.objects.find(object=>object.id==='floor').artwork);assert.deepEqual(persisted.project.assets,styled.assets);assert.equal(view.state.objects.find(object=>object.id==='floor').artwork.asset,styled.assets[0].id);
});
