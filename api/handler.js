import {agentFetch} from '../worker/api.mjs';
import {blobBucket} from '../worker/vercel-blob.mjs';

// A single same-origin handler serves both the editor's API and MCP requests.
export default async function handler(request){
 try{
  const configured=!!(process.env.BLOB_READ_WRITE_TOKEN||
   (process.env.VERCEL_OIDC_TOKEN&&process.env.BLOB_STORE_ID));
  return await agentFetch(request,{
   BUCKET:configured?blobBucket:null,
   OPENAI_API_KEY:process.env.OPENAI_API_KEY,
   OPENAI_MODEL:process.env.OPENAI_MODEL,
   CHAT_DAILY_LIMIT:process.env.CHAT_DAILY_LIMIT
  });
 }catch(error){
  console.error('Pixel Mill API error',error);
  return Response.json({error:'The level service is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
