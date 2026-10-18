import test from 'node:test';
import assert from 'node:assert/strict';
import {randomFillSync} from 'node:crypto';
import {cloudRequest} from '../dist/cloud-request.mjs';
import {createProjectToken} from '../dist/project-state.mjs';
import {packTransfer,transferChunkBytes,transferContentType,transferHash} from '../dist/cloud-transfer.mjs';
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

test('streaming hosts return exact large JSON responses without temporary storage writes',async()=>{
 const text=JSON.stringify({name:'Garden 🌿',pixels:'x'.repeat(7*1024*1024)}),bytes=new TextEncoder().encode(text);let writes=0;
 const bucket={put(){writes++;throw Error('Temporary storage is unavailable.')}},source=new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1024));controller.enqueue(bytes.subarray(1024));controller.close()}}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Project-Revision':'29'}});
 const result=await transferFetch(new Request('https://pixel.example/api/rooms/example',{headers:{Accept:transferContentType+', application/json'}}),bucket,()=>source,{streamResponses:true});
 assert.equal(result,source);assert.equal(result.bodyUsed,false);assert.equal(writes,0);assert.equal(result.headers.get('X-Project-Revision'),'29');assert.equal(await result.text(),text);
});

test('streaming hosts still verify and reassemble chunked uploads before returning large JSON directly',async()=>{
 const bucket=memoryBucket(),text=JSON.stringify({level:'🌿'.repeat(900000)}),packed=await packTransfer(text,createProjectToken());let commits=0,writes=0;
 const originalPut=bucket.put;bucket.put=async(...args)=>{writes++;return originalPut(...args)};
 for(let index=0;index<packed.parts.length;index++){
  const response=await transferFetch(new Request('https://pixel.example/api/transfers/'+packed.descriptor.token+'/'+index,{method:'PUT',body:JSON.stringify({data:packed.parts[index]})}),bucket,()=>{throw Error('Upload part reached the project handler.')},{streamResponses:true});assert.equal(response.status,200);
 }
 const result=await transferFetch(new Request('https://pixel.example/api/projects',{method:'POST',headers:{'Content-Type':transferContentType,Accept:transferContentType+', application/json'},body:JSON.stringify(packed.descriptor)}),bucket,async request=>{commits++;assert.equal(request.headers.get('content-type'),'application/json');assert.equal(await request.text(),text);return new Response(text,{headers:{'Content-Type':'application/json'}})},{streamResponses:true});
 assert.equal(result.status,200);assert.equal(await result.text(),text);assert.equal(commits,1);assert.equal(writes,packed.parts.length);assert.equal(bucket.records.size,0);
});

test('immutable part uploads retry transient errors and a lost reply with identical capabilities and bytes',async t=>{
 for(const failure of [502,503,504,'lost-reply','timeout'])await t.test(String(failure),async t=>{
  const bucket=memoryBucket(),body=JSON.stringify({pixels:'x'.repeat(3*transferChunkBytes+1)}),attempts=[];let commits=0;
  t.mock.method(globalThis,'fetch',async(path,options={})=>{
   const request=new Request(new URL(path,'https://pixel.example'),options),dispatch=()=>transferFetch(request,bucket,async request=>{commits++;assert.equal(await request.text(),body);return Response.json({saved:true})},{streamResponses:true});
   if(options.method==='PUT'&&path.endsWith('/3')){attempts.push({path,body:options.body});if(attempts.length===1){if(typeof failure==='string'){assert.equal((await dispatch()).status,200);throw failure==='lost-reply'?TypeError('Failed to fetch'):new DOMException('The request was aborted.','AbortError')}return Response.json({error:'Temporary transfer failure'},{status:failure})}}
   return dispatch();
  });
  assert.deepEqual(await cloudRequest('/api/projects',{method:'POST',body}),{saved:true});assert.equal(commits,1);assert.equal(attempts.length,2);assert.deepEqual(attempts[1],attempts[0]);assert.equal(bucket.records.size,0);
 });
});

test('part upload retries are bounded and reject conflicts and other client errors without committing local work',async t=>{
 for(const status of [503,409,413,401])await t.test(String(status),async t=>{
  const bucket=memoryBucket(),body=JSON.stringify({pixels:'x'.repeat(3*transferChunkBytes+1)}),attempts=[],pending=[];let commits=0;
  t.mock.method(globalThis,'fetch',(path,options={})=>{
   const work=(async()=>{if(options.method==='PUT'&&path.endsWith('/3')){attempts.push({path,body:options.body});return Response.json({error:'Cloud transfer failed. Your local work is kept.',code:'transfer_unavailable'},{status})}
   return transferFetch(new Request(new URL(path,'https://pixel.example'),options),bucket,()=>{commits++;return Response.json({saved:true})},{streamResponses:true})})();pending.push(work);return work;
  });
  await assert.rejects(()=>cloudRequest('/api/projects',{method:'POST',body}),error=>error.status===status&&/local work is kept/.test(error.message));await Promise.allSettled(pending);assert.equal(commits,0);assert.equal(attempts.length,status===503?3:1);for(const attempt of attempts)assert.deepEqual(attempt,attempts[0]);assert.equal(bucket.records.size,3);assert.equal(JSON.parse(body).pixels.length,3*transferChunkBytes+1);
 });
});

test('project commits are not automatically retried by the part upload recovery',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'Cloud saving is unavailable. Your local work is kept.'},{status:503})});await assert.rejects(()=>cloudRequest('/api/projects',{method:'POST',body:'{"project":{}}'}),error=>error.status===503);assert.equal(calls,1);
});
