import {requireProjectName} from '../dist/project-state.mjs';
export const PROJECT_TTL=7*86400000;
const projectListeners=new Map();
export const privateToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export function projectError(message,status){return Object.assign(Error(message),{status})}
export function assertStoredProject(record){if(!record||record.deleted||record.deletedAt)throw projectError('Project was deleted. Your local work is kept.',410)}
// Project and MCP capabilities resolve to ONE revisioned record. Existing
// rooms are adopted with an alias, never by copying a potentially stale image.
export async function resolveProject(bucket,entryKey,{allowDeleted=false}={}){
 const entry=await bucket.get(entryKey);
 if(!entry)throw projectError('Project or agent link not found.',404);
 const alias=await entry.json();if(!allowDeleted)assertStoredProject(alias);
 const key=alias.ref||entryKey,object=alias.ref?await bucket.get(key):entry;
 if(!object)throw projectError('Project was deleted.',410);
 const record=alias.ref?await object.json():alias;if(!allowDeleted)assertStoredProject(record);
 return{key,object,record};
}
export function assertRoomAccess(record,token){
 assertStoredProject(record);
 if(record.projectToken&&record.roomToken!==token)throw projectError('Agent link is inactive.',410);
 if(record.expires&&record.expires<Date.now())throw projectError('Agent link expired. Create a new link in the editor.',410);
}
export async function writeProject(bucket,key,record,etag){
 if(record.projectToken&&!record.deleted)requireProjectName(record.project);
 const text=JSON.stringify(record);
 if(new TextEncoder().encode(text).length>32*1024*1024)throw Error('Agent project is full. Save locally or use fewer images.');
 const result=await bucket.put(key,text,{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 if(!result)throw projectError('Conflict: another edit arrived. Read the current revision and try again.',409);
 for(const notify of projectListeners.get(key)||[])notify(record,result.etag);
 return result;
}
// Revision-only SSE. Conditional origin reads avoid downloading unchanged
// PNGs. Bounded streams reconnect automatically and close on browser abort.
export function projectEvents(request,bucket,key,{record,object},roomToken=null,{interval=3000,lifetime=55000}={}){
 let timer,controller,stopped=false,etag=object.etag,current=record,delay=interval;
 const started=Date.now(),encoder=new TextEncoder();
 const finish=()=>{if(stopped)return;stopped=true;clearTimeout(timer);const listeners=projectListeners.get(key);listeners?.delete(changed);if(!listeners?.size)projectListeners.delete(key);request.signal.removeEventListener('abort',finish);try{controller.close()}catch{}};
 const send=(event,data)=>{if(!stopped)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))};
 const changed=(value,version)=>{
  if(stopped||value.revision<current.revision)return;
  try{assertStoredProject(value);if(roomToken)assertRoomAccess(value,roomToken);current=value;etag=version;delay=interval;send('change',{revision:value.revision})}
  catch(error){send('gone',{message:error.message});finish()}
 };
 const check=async()=>{
  if(stopped)return;
  try{
   if(roomToken)assertRoomAccess(current,roomToken);
   if(Date.now()-started>=lifetime){send('renew',{});finish();return}
   const next=await bucket.get(key,{ifNoneMatch:etag,signal:request.signal});
   if(stopped)return;
   if(!next){send('gone',{message:'Project was deleted.'});finish();return}
   if(!next.notModified&&next.etag!==etag){
    const value=await next.json();changed(value,next.etag);
   }else{delay=Math.min(15000,delay*2);controller.enqueue(encoder.encode(': keepalive\n\n'))}
  }catch(error){if(!stopped){send([404,410].includes(error.status)?'gone':'retry',{message:error.status?error.message:'Connection interrupted.'});finish()}return}
  if(!stopped)timer=setTimeout(check,Math.min(delay,Math.max(0,lifetime-(Date.now()-started))));
 };
 const stream=new ReadableStream({start(c){controller=c;let listeners=projectListeners.get(key);if(!listeners)projectListeners.set(key,listeners=new Set());listeners.add(changed);c.enqueue(encoder.encode('retry: 5000\n\n'));send('change',{revision:record.revision});request.signal.addEventListener('abort',finish,{once:true});if(request.signal.aborted)finish();else timer=setTimeout(check,Math.min(interval,lifetime))},cancel:finish});
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','Referrer-Policy':'no-referrer'}});
}
