import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteBucket} from '../worker/remote-bucket.mjs';
import {createStorageHandler} from '../worker/storage-service.mjs';
import {createProjectToken,projectTokenPrefix} from '../dist/project-state.mjs';
import {agentFetch} from '../worker/api.mjs';
import {Autosave} from '../dist/autosave.mjs';

function storage(){
 const records=new Map();let version=0;
 const fetcher=async(_url,options)=>{
  const {operation,key,body,etag,createOnly}=JSON.parse(options.body),old=records.get(key);
  let result;
  if(operation==='get')result=!old?{status:404}:old.removed?{status:410}:etag===old.etag?{status:304,etag}:{status:200,...old};
  if(operation==='put'){
   if(etag&&(old?.etag!==etag||old.removed)||createOnly&&old)result={status:412};
   else{const next={body,etag:String(++version)};records.set(key,next);result={status:200,etag:next.etag}}
  }
  if(operation==='delete'){records.set(key,{removed:true});result={status:200}}
  return Response.json(result);
 };
 return{records,fetcher};
}

test('new cloud projects and agent links do not depend on suspended legacy storage',async()=>{
 const source=storage();let legacyReads=0;
 const bucket=createRemoteBucket({url:'https://storage.example',token:'server-secret',fetcher:source.fetcher,legacy:{get:async()=>{legacyReads++;throw Error('suspended')}}});
 const call=(path,method='GET',body)=>agentFetch(new Request('https://pixel.example'+path,{method,...(body?{body:JSON.stringify(body)}:{})}),{BUCKET:bucket});
 const project={format:'max-level-studio',version:1,name:'Cloud test',spawn:{x:0,y:0},assets:[],objects:[]};
 const pendingToken=createProjectToken();assert.equal(pendingToken.length,64);assert.ok(pendingToken.startsWith(projectTokenPrefix));
 const saved=await call('/api/projects','POST',{token:pendingToken,project});assert.equal(saved.status,201);const first=await saved.json();
 assert.equal((await call('/api/projects','POST',{token:pendingToken,project})).status,200);
 assert.equal((await call('/api/projects/'+first.token)).status,200);
 const room=await call('/api/rooms','POST',{projectToken:first.token,revision:0});assert.equal(room.status,201);
 assert.equal((await call('/api/rooms/'+(await room.json()).token)).status,200);
 assert.equal(await bucket.get('transfers/'+'0'.repeat(64)+'/0'),null);
 assert.equal(legacyReads,0);
 const missing=await call('/api/projects/'+'a'.repeat(64));assert.equal(missing.status,503);assert.equal((await missing.json()).code,'legacy_storage_unavailable');
 assert.equal((await call('/api/projects/'+'b'.repeat(64))).status,503);assert.equal(legacyReads,1);
});

test('legacy migration preserves one canonical record and deletion never resurrects an old copy',async()=>{
 const source=storage(),key='rooms/'+'1'.repeat(64);let legacyReads=0;
 const bucket=createRemoteBucket({url:'https://storage.example',token:'secret',fetcher:source.fetcher,legacy:{get:async()=>{legacyReads++;return{etag:'legacy',json:async()=>({revision:7})}}}});
 const migrated=await bucket.get(key);assert.deepEqual(await migrated.json(),{revision:7});
 assert.notEqual(migrated.etag,'legacy');assert.equal((await bucket.get(key,{ifNoneMatch:migrated.etag})).notModified,true);assert.equal(legacyReads,1);
 assert.equal(await bucket.put(key,'{"revision":99}',{onlyIf:{etagMatches:'stale'}}),null);
 await bucket.delete(key);assert.equal(await bucket.get(key),null);assert.equal(legacyReads,1);
});

test('storage service requires its own credential and never returns upstream secrets',async()=>{
 let calls=0;
 const handler=createStorageHandler({url:'https://db.example',secretKey:'private-service-key',fetcher:async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.match(body.p_token_hash,/^[a-f0-9]{64}$/);assert.notEqual(body.p_token_hash,'f'.repeat(64));assert.equal(options.headers.apikey,'private-service-key');return Response.json({message:'private-service-key'},{status:500})}});
 assert.equal((await handler(new Request('https://storage.example',{method:'POST',body:'{}'}))).status,401);assert.equal(calls,0);
 const result=await handler(new Request('https://storage.example',{method:'POST',headers:{authorization:'Bearer '+'f'.repeat(64)},body:JSON.stringify({operation:'get',key:'rooms/'+'0'.repeat(64)})}));
 assert.equal(result.status,503);assert.equal((await result.text()).includes('private-service-key'),false);assert.equal(calls,1);
});

test('a clean cached project exposes cloud recovery after a failed legacy read',async t=>{
 const project={format:'max-level-studio',version:1,name:'Local work',spawn:{x:0,y:0},assets:[],objects:[]};
 const original={id:'original',token:'a'.repeat(64),revision:5,project,dirty:false};
 const records=new Map([['original',structuredClone(original)]]),cache={list:async()=>[...records.values()],get:async id=>records.get(id),active:async()=>records.get('original'),put:async value=>records.set(value.id,structuredClone(value)),select:async()=>{},deleted:async()=>[]};
 let state=project;
 const save=new Autosave({snapshot:()=>structuredClone(state),restore:async value=>state=value,status:()=>{},link:()=>{}},cache);t.after(()=>save.stop());
 save.request=async()=>{throw Object.assign(Error('Previous cloud unavailable'),{status:503,code:'legacy_storage_unavailable'})};
 await save.init({token:original.token});assert.equal(save.cloudError,'legacy_storage_unavailable');assert.equal(save.dirty,false);assert.equal(save.blocked,null);assert.deepEqual(state,project);
 let savedToken;
 save.request=async(path,options)=>{assert.equal(path,'/api/projects');const value=JSON.parse(options.body);savedToken=value.token;return{token:value.token,revision:0,project:value.project}};
 await save.start({...state,name:'Recovered work'});await save.flush();
 assert.ok(savedToken.startsWith(projectTokenPrefix));assert.equal(save.cloudError,null);assert.equal(save.dirty,false);assert.deepEqual(records.get('original').project,project);assert.equal(records.get('original').token,original.token);
});
