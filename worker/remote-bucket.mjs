import {createImageStorage} from './image-storage.mjs';

const unavailable=()=>Object.assign(Error('Cloud saving is temporarily unavailable. Your local work is kept.'),{status:503,code:'storage_unavailable'});
export function createRemoteBucket({url,token,legacy=null,fetcher=fetch,images=createImageStorage()}={}){
 let legacyRetryAt=0;
 const call=async(operation,key,values={},signal)=>{
  try{
   const timeout=AbortSignal.timeout(15000);
   const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({operation,key,...values}),signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:'error'});
   if(!response.ok)throw unavailable();
   const result=await response.json();if(![200,304,404,410,412].includes(result?.status))throw unavailable();return result;
  }catch(error){if(signal?.aborted)throw error;throw unavailable()}
 };
 const read=result=>{
  if(typeof result.etag!=='string'||!result.etag||result.etag.startsWith('W/'))throw unavailable();
  return{etag:result.etag,...(result.status===304?{notModified:true}:{json:async()=>{try{return await images.decode(JSON.parse(result.body))}catch{throw unavailable()}}})};
 };
 const bucket={
  async get(key,options={}){
   const result=await call('get',key,options.ifNoneMatch?{etag:options.ifNoneMatch}:{},options.signal);
   if([200,304].includes(result.status))return read(result);
   if(result.status===410||!legacy||/^(projects\/)?v2\//.test(key))return null;
   const legacyError=()=>Object.assign(Error('The previous cloud copy is unavailable. Open Projects to save your local work as a new cloud project.'),{status:503,code:'legacy_storage_unavailable'});
   if(Date.now()<legacyRetryAt)throw legacyError();
   let old;
   try{old=await legacy.get(key,{signal:options.signal})}catch(error){if(options.signal?.aborted)throw error;legacyRetryAt=Date.now()+60000;throw legacyError()}
   if(!old)return null;
   const stored=await bucket.put(key,JSON.stringify(await old.json()),{onlyIf:{etagDoesNotMatch:'*'}});
   const migrated=await call('get',key,options.ifNoneMatch?{etag:options.ifNoneMatch}:{},options.signal);
   if(migrated.status===410)return null;
   if(![200,304].includes(migrated.status)||!stored&&migrated.status===404)throw unavailable();
   return read(migrated);
  },
  async put(key,text,options={}){
   const body=await images.encode(text,{offload:!key.endsWith('/preview')});
   const result=await call('put',key,{body,...(options.onlyIf?.etagMatches?{etag:options.onlyIf.etagMatches}:{}),createOnly:options.onlyIf?.etagDoesNotMatch==='*'});
   if(result.status===412)return null;if(result.status!==200||!result.etag)throw unavailable();return{etag:result.etag};
  },
  async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){const result=await call('delete',key);if(result.status!==200)throw unavailable()}}
 };
 return bucket;
}
