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
