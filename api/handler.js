import {agentFetch} from '../worker/api.mjs';
import {blobBucket} from '../worker/vercel-blob.mjs';

// A single same-origin handler serves both the editor's API and MCP requests.
export default async function handler(request,response){
 try{
  // Vercel's Node runtime passes IncomingMessage, whose URL is relative,
  // and expects the response to be written to ServerResponse.
  const host=request.headers.host||request.headers['x-forwarded-host'];
  const url=new URL(request.url,`https://${host}`);
  const rawBody=request.body;
  const body=['GET','HEAD'].includes(request.method)?undefined:
   rawBody===undefined?request:
   typeof rawBody==='string'||Buffer.isBuffer(rawBody)?rawBody:JSON.stringify(rawBody);
  const webRequest=new Request(url,{method:request.method,headers:request.headers,
   ...(body===undefined?{}:{body,duplex:'half'})});
  const configured=!!(process.env.BLOB_READ_WRITE_TOKEN||
   (process.env.VERCEL_OIDC_TOKEN&&process.env.BLOB_STORE_ID));
  const result=await agentFetch(webRequest,{
   BUCKET:configured?blobBucket:null,
   OPENAI_API_KEY:process.env.OPENAI_API_KEY,
   OPENAI_MODEL:process.env.OPENAI_MODEL,
   CHAT_DAILY_LIMIT:process.env.CHAT_DAILY_LIMIT
  });
  response.writeHead(result.status,Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
 }catch(error){
  console.error('Pixel Mill API error',error);
  if(!response.headersSent){response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:'The level service is temporarily unavailable.'}))}
 }
}
