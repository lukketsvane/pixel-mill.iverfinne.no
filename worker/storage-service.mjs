const encoder=new TextEncoder();
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export function createStorageHandler({url,secretKey,fetcher=fetch}){
 return async request=>{
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)return reply({error:'Unauthorized'},401);
  try{
   if(Number(request.headers.get('content-length'))>34*1024*1024)return reply({error:'Request too large'},413);
   const raw=await request.text();if(encoder.encode(raw).length>34*1024*1024)return reply({error:'Request too large'},413);
   const input=JSON.parse(raw);
   if(!['get','put','delete'].includes(input.operation)||typeof input.key!=='string'||input.key.length>300||input.body!==undefined&&typeof input.body!=='string'||input.etag!==undefined&&typeof input.etag!=='string')return reply({error:'Invalid storage request'},400);
   const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),n=>n.toString(16).padStart(2,'0')).join('');
   const upstream=await fetcher(url+'/rest/v1/rpc/pixel_mill_storage',{method:'POST',headers:{apikey:secretKey,...(secretKey?.startsWith('eyJ')?{Authorization:'Bearer '+secretKey}:{}),'Content-Type':'application/json'},body:JSON.stringify({p_token_hash:tokenHash,p_operation:input.operation,p_key:input.key,p_body:input.body??null,p_etag:input.etag??null,p_create_only:input.createOnly===true}),signal:AbortSignal.timeout(12000),redirect:'error'});
   if(!upstream.ok){const error=await upstream.json().catch(()=>({}));return reply({error:error.code==='42501'?'Unauthorized':'Storage is temporarily unavailable'},error.code==='42501'?401:503)}
   const result=await upstream.json();
   if(![200,304,400,404,410,412,413].includes(result?.status))return reply({error:'Storage is temporarily unavailable'},503);
   return reply(result);
  }catch(error){return reply({error:error instanceof SyntaxError?'Invalid JSON':'Storage is temporarily unavailable'},error instanceof SyntaxError?400:503)}
 };
}
