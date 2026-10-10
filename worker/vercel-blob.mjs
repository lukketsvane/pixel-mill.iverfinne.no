import {get,put,del,BlobPreconditionFailedError} from '@vercel/blob';
import {createImageStorage} from './image-storage.mjs';

const imageStorage=createImageStorage();
const credentials=()=>process.env.BLOB_READ_WRITE_TOKEN?{token:process.env.BLOB_READ_WRITE_TOKEN}:{};
function storageError(error){
 if(error?.name==='AbortError')return error;
 const denied=/403|forbidden|suspend|quota|limit.exceeded/i.test(error.message||'');
 return Object.assign(Error(denied?'Cloud storage is unavailable. The storage quota or access needs attention. Your local work is kept.':'Cloud storage is temporarily unavailable. Your local work is kept.'),{status:503,code:denied?'storage_unavailable':'storage_retry',cause:error});
}
export const blobBucket={
 async get(key,options={}){
  try{
   const result=await get(key,{...credentials(),access:'private',useCache:false,headers:{'accept-encoding':'identity'},...(options.ifNoneMatch?{ifNoneMatch:options.ifNoneMatch}:{}),...(options.signal?{abortSignal:options.signal}:{})});
   if(!result)return null;
   if(result.statusCode===304)return{etag:result.blob.etag,notModified:true};
   if(!result.blob.etag||result.blob.etag.startsWith('W/'))throw Error('Storage did not return a strong version tag.');
   return{etag:result.blob.etag,json:async()=>{try{return await imageStorage.decode(JSON.parse(await new Response(result.stream).text()))}catch(error){throw storageError(error)}}};
  }catch(error){if(error.message==='Storage did not return a strong version tag.')throw error;throw storageError(error)}
 },
 async put(key,text,options={}){
  const previous=options.onlyIf?.etagMatches;
  try{
   const stored=await imageStorage.encode(text,{offload:!key.endsWith('/preview')});
   const result=await put(key,stored,{...credentials(),access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:!!previous||!options.onlyIf,...(previous?{ifMatch:previous}:{})});
   return{etag:result.etag};
  }catch(error){
   if(error instanceof BlobPreconditionFailedError||error?.name==='BlobAlreadyExistsError')return null;
   throw storageError(error);
  }
 },
 async delete(keys){try{await del(Array.isArray(keys)?keys:[keys],credentials())}catch(error){throw storageError(error)}}
};
