import test from 'node:test';
import assert from 'node:assert/strict';
import {randomFillSync} from 'node:crypto';
import {cloudRequest} from '../dist/cloud-request.mjs';
import {createProjectToken} from '../dist/project-state.mjs';
import {packTransfer,transferContentType,transferHash} from '../dist/cloud-transfer.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';
import {transferFetch} from '../worker/transfer.mjs';
import {agentFetch} from '../worker/api.mjs';

function memoryBucket(){
 const records=new Map();let revision=0;
 return{records,async get(key){const record=records.get(key);return record?{etag:record.etag,json:async()=>JSON.parse(record.body)}:null},async put(key,body,options={}){const old=records.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&old||options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;const record={body,etag:String(++revision)};records.set(key,record);return{etag:record.etag}},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])records.delete(key)}};
}

test('large projects save and cold reopen through requests and responses below the provider limit',async t=>{
 const bucket=memoryBucket(),pending=[],sizes=[];
 t.mock.method(globalThis,'fetch',(path,options={})=>{
  const work=(async()=>{
   const request=new Request(new URL(path,'https://pixel.example'),options),input=await request.clone().arrayBuffer();
   assert.ok(input.byteLength<4500000);sizes.push(input.byteLength);
   const response=await transferFetch(request,bucket,r=>agentFetch(r,{BUCKET:bucket}));
   const output=await response.clone().arrayBuffer();assert.ok(output.byteLength<4500000);sizes.push(output.byteLength);return response;
  })();pending.push(work);return work;
 });
 const w=1152,h=1152,src=dataURL(await encodePNG({w,h,pixels:randomFillSync(new Uint8Array(w*h*4))}));
 const project={format:'max-level-studio',version:1,name:'Large garden 🌿',assets:[{id:'source',name:'Source',w,h,src}],objects:[{id:'floor',asset:'source',x:0,y:100,w:120,h:20,kind:'solid'}],spawn:{x:0,y:0}};
 const body=JSON.stringify({token:createProjectToken(),project});assert.ok(Buffer.byteLength(body)>6900000);
 const saved=await cloudRequest('/api/projects',{method:'POST',body});assert.equal(saved.project.assets[0].src,src);
 const opened=await cloudRequest('/api/projects/'+saved.token);assert.deepEqual(opened.project,saved.project);
 const retry=await cloudRequest('/api/projects',{method:'POST',body});assert.equal(retry.token,saved.token);assert.equal(retry.revision,0);
 await Promise.all(pending);
 assert.equal([...bucket.records.keys()].filter(key=>key.startsWith('transfers/')).length,0);
 assert.equal([...bucket.records.keys()].filter(key=>key.startsWith('projects/')).length,1);
 assert.ok(sizes.some(size=>size>1000000));
});

test('immutable transfer parts support retry and reject corrupt or missing payloads before committing',async()=>{
 const bucket=memoryBucket(),packed=await packTransfer(JSON.stringify({name:'🌿'.repeat(600000)}),createProjectToken());let commits=0;
 const call=(path,method,body,type='application/json')=>transferFetch(new Request('https://pixel.example'+path,{method,headers:{'Content-Type':type},body:JSON.stringify(body)}),bucket,async()=>{commits++;return Response.json({ok:true})});
 const partPath='/api/transfers/'+packed.descriptor.token+'/0';
 assert.equal((await call(partPath,'PUT',{data:packed.parts[0]})).status,200);
 assert.equal((await call(partPath,'PUT',{data:packed.parts[0]})).status,200);
 assert.equal((await call(partPath,'PUT',{data:btoa('changed')})).status,409);
 assert.equal((await call('/api/projects','POST',packed.descriptor,transferContentType)).status,503);assert.equal(commits,0);
 for(let i=1;i<packed.parts.length;i++)assert.equal((await call('/api/transfers/'+packed.descriptor.token+'/'+i,'PUT',{data:packed.parts[i]})).status,200);
 const bad={...packed.descriptor,hash:'0'.repeat(64)};
 assert.equal((await call('/api/projects','POST',bad,transferContentType)).status,503);assert.equal(commits,0);
 assert.equal((await call('/api/projects','POST',packed.descriptor,transferContentType)).status,200);assert.equal(commits,1);assert.equal(bucket.records.size,0);
});

test('expired downloads are retryable outages and do not masquerade as deleted projects',async t=>{
 const bucket=memoryBucket(),packed=await packTransfer('{"ok":true}',createProjectToken()),key='transfers/'+await transferHash(new TextEncoder().encode(packed.descriptor.token))+'/0';
 await bucket.put(key,JSON.stringify({data:packed.parts[0],createdAt:Date.now()-31*60000}));
 t.mock.method(globalThis,'fetch',async(path,options={})=>path==='/api/projects/example'?Response.json(packed.descriptor):transferFetch(new Request('https://pixel.example'+path,options),bucket,()=>Response.json({})));
 await assert.rejects(()=>cloudRequest('/api/projects/example'),error=>error.status===503&&error.code==='transfer_unavailable');
});

test('standard MCP responses retain their format and cross-origin transfer writes are refused',async()=>{
 const bucket=memoryBucket(),body={result:'x'.repeat(4*1024*1024)};
 const response=await transferFetch(new Request('https://pixel.example/mcp/example',{method:'POST',body:'{}'}),bucket,()=>Response.json(body));
 assert.deepEqual(await response.json(),body);assert.equal(bucket.records.size,0);
 const denied=await transferFetch(new Request('https://pixel.example/api/transfers/'+createProjectToken()+'/0',{method:'PUT',headers:{Origin:'https://other.example'},body:JSON.stringify({data:btoa('test')})}),bucket,()=>Response.json({}));
 assert.equal(denied.status,403);assert.equal(bucket.records.size,0);
});
