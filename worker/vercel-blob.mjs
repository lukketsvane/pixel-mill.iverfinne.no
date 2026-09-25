// Private Vercel Blob adapter for the Worker bucket interface.
// The opaque room token is hashed by api.mjs before it reaches this store.
import {get,put,del,BlobPreconditionFailedError} from '@vercel/blob';

export const blobBucket={
 async get(key,options={}){
  const result=await get(key,{access:'private',useCache:false,headers:{'accept-encoding':'identity'},...(options.ifNoneMatch?{ifNoneMatch:options.ifNoneMatch}:{}),...(options.signal?{abortSignal:options.signal}:{})});
  if(!result)return null;
  if(result.statusCode===304)return{etag:result.blob.etag,notModified:true};
  // Conditional writes need the strong ETag of the stored bytes, not a compressed response.
  if(!result.blob.etag||result.blob.etag.startsWith('W/'))throw Error('Storage did not return a strong version tag.');
  return {etag:result.blob.etag,json:async()=>JSON.parse(await new Response(result.stream).text())};
 },
 async put(key,text,options={}){
  const previous=options.onlyIf?.etagMatches;
  try{
   const result=await put(key,text,{
    access:'private',contentType:'application/json',
    allowOverwrite:!!previous,...(previous?{ifMatch:previous}:{})
   });
   return {etag:result.etag};
  }catch(error){
   // Matches the R2 conditional-write contract expected by api.mjs.
   if(error instanceof BlobPreconditionFailedError||error?.name==='BlobAlreadyExistsError')return null;
   throw error;
  }
 },
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])await del(key)}
};
