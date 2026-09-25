import {once} from 'node:events';
import {agentFetch} from '../worker/api.mjs';
import {blobBucket} from '../worker/vercel-blob.mjs';

// Buffering arrayBuffer() hides live events until the entire stream finishes.
export default async function handler(request,response){
 const abort=new AbortController(),closed=()=>abort.abort();
 request.once('aborted',closed);response.once('close',closed);
 try{
  const host=request.headers.host||request.headers['x-forwarded-host'];
  const url=new URL(request.url,`https://${host}`),rawBody=request.body;
  const body=['GET','HEAD'].includes(request.method)?undefined:rawBody===undefined?request:typeof rawBody==='string'||Buffer.isBuffer(rawBody)?rawBody:JSON.stringify(rawBody);
  const webRequest=new Request(url,{method:request.method,headers:request.headers,signal:abort.signal,...(body===undefined?{}:{body,duplex:'half'})});
  const configured=!!(process.env.BLOB_READ_WRITE_TOKEN||(process.env.VERCEL_OIDC_TOKEN&&process.env.BLOB_STORE_ID));
  const result=await agentFetch(webRequest,{BUCKET:configured?blobBucket:null,OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_MODEL:process.env.OPENAI_MODEL,CHAT_DAILY_LIMIT:process.env.CHAT_DAILY_LIMIT});
  response.writeHead(result.status,Object.fromEntries(result.headers));
  if(result.headers.get('content-type')?.startsWith('text/event-stream'))response.flushHeaders();
  if(result.body){
   const reader=result.body.getReader();
   try{while(!abort.signal.aborted){const {done,value}=await reader.read();if(done)break;if(!response.write(Buffer.from(value)))await once(response,'drain',{signal:abort.signal})}}
   finally{if(abort.signal.aborted)await reader.cancel().catch(()=>{});reader.releaseLock()}
  }
  if(!response.destroyed)response.end();
 }catch(error){
  if(!abort.signal.aborted){console.error('Pixel Mill API error',error);if(!response.headersSent){response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:'The level service is temporarily unavailable.'}))}else response.destroy()}
 }finally{request.removeListener('aborted',closed);response.removeListener('close',closed);abort.abort()}
}
