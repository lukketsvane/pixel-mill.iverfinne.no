export async function cloudRequest(path,options={}){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
 try{
  const response=await fetch(path,{...options,signal:abort.signal,headers:{'Content-Type':'application/json',...options.headers}});
  if(response.status===304)return null;
  let data;try{data=await response.json()}catch{throw Object.assign(Error('Cloud saving is temporarily unavailable. Your local work is kept.'),{status:response.status>=400?response.status:503})}
  if(!response.ok||data.isError)throw Object.assign(Error(data.error||data.content?.[0]?.text||'Cloud saving is unavailable. Your local work is kept.'),{status:response.status,code:data.code});
  return data;
 }catch(error){if(error.name==='AbortError')throw Object.assign(Error('Cloud saving timed out. Your local work is kept.'),{status:503});throw error}
 finally{clearTimeout(timer)}
}
