import test from 'node:test';
import assert from 'node:assert/strict';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {blobBucket} from '../worker/vercel-blob.mjs';

test('room reads use current uncompressed bytes and keep the strong ETag',async t=>{
 const previous=getGlobalDispatcher(),agent=new MockAgent(),token=process.env.BLOB_READ_WRITE_TOKEN;
 agent.disableNetConnect();setGlobalDispatcher(agent);process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_teststore_testtoken';
 t.after(async()=>{setGlobalDispatcher(previous);await agent.close();if(token===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=token});
 const pool=agent.get('https://teststore.private.blob.vercel-storage.com');
 pool.intercept({path:'/rooms/test?cache=0',method:'GET',headers:{'accept-encoding':'identity'}}).reply(200,{revision:7},{headers:{etag:'"version-7"'}});
 const result=await blobBucket.get('rooms/test');
 assert.equal(result.etag,'"version-7"');assert.deepEqual(await result.json(),{revision:7});
 for(const etag of ['', 'W/"compressed"']){
  pool.intercept({path:'/rooms/test?cache=0',method:'GET'}).reply(200,{}, {headers:{etag}});
  await assert.rejects(blobBucket.get('rooms/test'),/strong version tag/);
 }
 agent.assertNoPendingInterceptors();
});

test('suspended storage is a retryable service error and server credentials stay private',async t=>{
 const previous=getGlobalDispatcher(),agent=new MockAgent(),token=process.env.BLOB_READ_WRITE_TOKEN,store=process.env.BLOB_STORE_ID,oidc=process.env.VERCEL_OIDC_TOKEN;
 agent.disableNetConnect();setGlobalDispatcher(agent);process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_teststore_testtoken';process.env.BLOB_STORE_ID='otherstore';process.env.VERCEL_OIDC_TOKEN='expired-oidc';
 t.after(async()=>{setGlobalDispatcher(previous);await agent.close();for(const [key,value]of Object.entries({BLOB_READ_WRITE_TOKEN:token,BLOB_STORE_ID:store,VERCEL_OIDC_TOKEN:oidc})){if(value===undefined)delete process.env[key];else process.env[key]=value}});
 agent.get('https://teststore.private.blob.vercel-storage.com').intercept({path:'/rooms/test?cache=0',method:'GET',headers:{authorization:'Bearer vercel_blob_rw_teststore_testtoken'}}).reply(403,'Forbidden');
 await assert.rejects(blobBucket.get('rooms/test'),error=>error.status===503&&error.code==='storage_unavailable'&&/quota or access/.test(error.message)&&!error.message.includes('testtoken'));
 agent.assertNoPendingInterceptors();
});

test('preview overwrites and conditional project writes use stable blob names',async t=>{
 const previous=getGlobalDispatcher(),agent=new MockAgent(),token=process.env.BLOB_READ_WRITE_TOKEN;
 agent.disableNetConnect();setGlobalDispatcher(agent);process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_teststore_testtoken';
 t.after(async()=>{setGlobalDispatcher(previous);await agent.close();if(token===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=token});
 const pool=agent.get('https://vercel.com');
 for(const [options,overwrite,match]of [[{},'1',undefined],[{onlyIf:{etagDoesNotMatch:'*'}},'0',undefined],[{onlyIf:{etagMatches:'"v1"'}},'1','"v1"']]){
  pool.intercept({path:'/api/blob/?pathname=rooms%2Ftest',method:'PUT',headers:{'x-add-random-suffix':'0','x-allow-overwrite':overwrite,...(match?{'x-if-match':match}:{})}}).reply(200,{url:'https://teststore.private.blob.vercel-storage.com/rooms/test',downloadUrl:'https://teststore.private.blob.vercel-storage.com/rooms/test',pathname:'rooms/test',contentType:'application/json',contentDisposition:'inline',etag:'"v2"'});
  assert.equal((await blobBucket.put('rooms/test','{}',options)).etag,'"v2"');
 }
 agent.assertNoPendingInterceptors();
});
