import {createProjectToken} from './project-state.mjs';
import {transferChunkBytes,transferContentType,isTransfer,packTransfer,unpackTransfer,transferMap} from './cloud-transfer.mjs';

async function cloudNetwork(path,options={}){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
 try{
  const response=await fetch(path,{...options,signal:abort.signal,headers:{'Content-Type':'application/json','Accept':transferContentType+', application/json',...options.headers}});
  if(response.status===304)return null;
  let data;try{data=await response.json()}catch{throw Object.assign(Error('Cloud saving is temporarily unavailable. Your local work is kept.'),{status:response.status>=400?response.status:503})}
  if(!response.ok||data.isError)throw Object.assign(Error(data.error||data.content?.[0]?.text||'Cloud saving is unavailable. Your local work is kept.'),{status:response.status,code:data.code});
  return data;
 }catch(error){if(error.name==='AbortError')throw Object.assign(Error('Cloud saving timed out. Your local work is kept.'),{status:503});throw error}
 finally{clearTimeout(timer)}
}
async function uploadTransferPart(token,index,data){
 const path='/api/transfers/'+token+'/'+index,options={method:'PUT',body:JSON.stringify({data})};
 for(let attempt=0;;attempt++)try{return await cloudNetwork(path,options)}catch(error){if(attempt===2||![502,503,504].includes(error.status)&&!(error instanceof TypeError))throw error;await new Promise(resolve=>setTimeout(resolve,500*2**attempt))}
}
export async function cloudRequest(path,options={}){
 if(typeof options.body==='string'&&new TextEncoder().encode(options.body).length>3*transferChunkBytes){
  const packed=await packTransfer(options.body,createProjectToken());
  await transferMap(packed.parts,(data,index)=>uploadTransferPart(packed.descriptor.token,index,data));
  options={...options,headers:{...options.headers,'Content-Type':transferContentType},body:JSON.stringify(packed.descriptor)};
 }
 const data=await cloudNetwork(path,options);
 if(!isTransfer(data))return data;
 try{
  const parts=await transferMap(Array.from({length:data.parts},(_,i)=>i),async index=>(await cloudNetwork('/api/transfers/'+data.token+'/'+index)).data);
  const result=JSON.parse(await unpackTransfer(data,parts));
  void cloudNetwork('/api/transfers/'+data.token,{method:'DELETE',body:JSON.stringify({parts:data.parts})}).catch(()=>{});
  return result;
 }catch{throw Object.assign(Error('Cloud transfer was interrupted. Your local work is kept. Please retry.'),{status:503,code:'transfer_unavailable'})}
}
