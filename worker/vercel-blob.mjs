// Private Vercel Blob adapter for the Worker bucket interface.
// The opaque room token is hashed by api.mjs before it reaches this store.
import {get,put,del,BlobPreconditionFailedError} from '@vercel/blob';

export const blobBucket={
 async get(key){
  const result=await get(key,{access:'private',useCache:false});
  if(!result)return null;
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
