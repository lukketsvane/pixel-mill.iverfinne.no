import {createProjectToken} from '../dist/project-state.mjs';
import {transferChunkBytes,transferContentType,transferHash,isTransfer,validTransferPart,packTransfer,unpackTransfer,transferMap} from '../dist/cloud-transfer.mjs';

const transferResponse=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const transferFailure=()=>transferResponse({error:'Cloud transfer was interrupted. Your local work is kept. Please retry.',code:'transfer_unavailable'},503);
async function transferKey(token){return'transfers/'+await transferHash(new TextEncoder().encode(token))}
async function removeTransfer(bucket,key,parts){await bucket.delete(Array.from({length:parts},(_,i)=>key+'/'+i))}
async function readTransferPart(bucket,key){
 const object=await bucket.get(key),part=object?await object.json():null;
 if(!part||typeof part.data!=='string'||!Number.isFinite(part.createdAt)||Date.now()-part.createdAt>30*60000)throw Error('Transfer expired.');
 return part.data;
}
export async function transferFetch(request,bucket,next,{streamResponses=false}={}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/transfers\/([a-f0-9]{64})(?:\/(\d{1,2}))?$/);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return transferResponse({error:'Origin not allowed'},403);
 if(match){
  if(!bucket)return transferFailure();
  try{
   const key=await transferKey(match[1]),index=match[2]===undefined?null:Number(match[2]);
   if(index!==null&&(index<0||index>=32))return transferResponse({error:'Invalid transfer part'},400);
   if(request.method==='GET'&&index!==null)return transferResponse({data:await readTransferPart(bucket,key+'/'+index)});
   if(request.method==='PUT'&&index!==null){
    const raw=await request.text();if(raw.length>1500000)return transferResponse({error:'Transfer part too large'},413);
    const value=JSON.parse(raw);if(!validTransferPart(value.data))return transferResponse({error:'Invalid transfer part'},400);
    const saved=await bucket.put(key+'/'+index,JSON.stringify({data:value.data,createdAt:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}});
    if(!saved&&await readTransferPart(bucket,key+'/'+index)!==value.data)return transferResponse({error:'Transfer part changed'},409);
    return transferResponse({ok:true});
   }
   if(request.method==='DELETE'&&index===null){const value=await request.json();if(!Number.isInteger(value.parts)||value.parts<1||value.parts>32)return transferResponse({error:'Invalid transfer'},400);await removeTransfer(bucket,key,value.parts);return transferResponse({ok:true})}
   return transferResponse({error:'Method not allowed'},405);
  }catch{return transferFailure()}
 }
 if(request.headers.get('content-type')?.split(';')[0]===transferContentType){
  if(!bucket)return transferFailure();
  try{
   const descriptor=await request.json();if(!isTransfer(descriptor))return transferResponse({error:'Invalid transfer'},400);
   const key=await transferKey(descriptor.token),parts=await transferMap(Array.from({length:descriptor.parts},(_,i)=>i),index=>readTransferPart(bucket,key+'/'+index));
   const body=await unpackTransfer(descriptor,parts),headers=new Headers(request.headers);headers.set('Content-Type','application/json');headers.delete('content-length');
   request=new Request(request.url,{method:request.method,headers,body,signal:request.signal});
   await removeTransfer(bucket,key,descriptor.parts);
  }catch{return transferFailure()}
 }
 const result=await next(request);
 if(streamResponses||!request.headers.get('accept')?.includes(transferContentType)||!bucket||!result.ok||!result.body||!result.headers.get('content-type')?.startsWith('application/json'))return result;
 const text=await result.text();if(new TextEncoder().encode(text).length<=3*transferChunkBytes)return new Response(text,{status:result.status,headers:result.headers});
 try{
  const packed=await packTransfer(text,createProjectToken()),key=await transferKey(packed.descriptor.token);
  await transferMap(packed.parts,async(data,index)=>{if(!await bucket.put(key+'/'+index,JSON.stringify({data,createdAt:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}}))throw Error('Transfer part changed.')});
  return transferResponse(packed.descriptor,result.status);
 }catch{return transferFailure()}
}
