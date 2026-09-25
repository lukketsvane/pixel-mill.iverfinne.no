import {validateProject} from '../dist/engine.mjs';
import {applyDiff} from '../dist/agent.mjs';
import {requireProjectName} from '../dist/project-state.mjs';
import {privateToken,projectError,assertStoredProject,assertRoomAccess,resolveProject,writeProject,projectEvents,PROJECT_TTL} from './project-store.mjs';

export async function commitProjectPatch(bucket,key,record,etag,diff,commit,access=()=>{}){
 for(let attempt=0;attempt<3;attempt++){
  assertStoredProject(record);access(record);const next=applyDiff(record.project,diff);if(record.projectToken)requireProjectName(next);commit(record,next);
  try{await writeProject(bucket,key,record,etag);return record}catch(error){
   if(!error.message.startsWith('Conflict:')||attempt===2)throw error;
   const fresh=await bucket.get(key);if(!fresh)throw projectError('Project was deleted.',410);
   record=await fresh.json();etag=fresh.etag;
  }
 }
}

export async function projectRoute(request,env,{body,keyFor,response,publicRoom,revisionCheck,commitRoom}){
 const url=new URL(request.url),path=url.pathname,bucket=env.BUCKET;
 if(path==='/api/projects'&&request.method==='POST'){
  const value=await body(request);
  if(value.roomToken){
   if(!/^[a-f0-9]{64}$/.test(value.roomToken))throw Error('Invalid agent link.');
   const found=await resolveProject(bucket,await keyFor(value.roomToken)),room=found.record;
   assertRoomAccess(room,value.roomToken);requireProjectName(room.project);
   if(room.projectToken)return response({token:room.projectToken,...publicRoom(room)});
   const token=privateToken(),alias='projects/'+await keyFor(token);
   await writeProject(bucket,alias,{ref:found.key});
   room.projectToken=token;room.roomToken=value.roomToken;room.revision++;
   try{await writeProject(bucket,found.key,room,found.object.etag)}catch(error){
    if(!error.message.startsWith('Conflict:'))throw error;
    const latest=await resolveProject(bucket,found.key);assertRoomAccess(latest.record,value.roomToken);
    if(!latest.record.projectToken)throw error;
    return response({token:latest.record.projectToken,...publicRoom(latest.record)});
   }
   return response({token,...publicRoom(room)},201);
  }
  requireProjectName(value.project);const project=validateProject(value.project);
  if(value.token!==undefined&&!/^[a-f0-9]{64}$/.test(value.token))throw Error('Invalid project key.');
  const token=value.token||privateToken(),key='projects/'+await keyFor(token);
  // The browser persists this random key before sending. A lost response can
  // therefore be retried without creating duplicate saved projects.
  if(value.token&&await bucket.get(key)){const existing=await resolveProject(bucket,key);return response({token,...publicRoom(existing.record)})}
  const saved={project,revision:0,history:[],projectToken:token};
  await writeProject(bucket,key,saved);return response({token,...publicRoom(saved)},201);
 }
 const match=path.match(/^\/api\/projects\/([a-f0-9]{64})(\/events)?$/);
 if(match){
  const found=await resolveProject(bucket,'projects/'+await keyFor(match[1]),{allowDeleted:request.method==='POST'}),{key,object,record:saved}=found;saved.projectToken??=match[1];
  if(request.method==='POST'){
   const value=await body(request);revisionCheck(saved,value.revision);
   if(!value.restore||!saved.deleted&&!saved.deletedAt)throw Error('No deleted project to restore.');
   const backup=saved.recoveryKey?await bucket.get(saved.recoveryKey):null;
   const original=backup?await backup.json():saved.project?saved:null;
   if(!original?.project)throw Error('The recovery copy is unavailable.');
   const next={...original,deleted:false,deletedAt:undefined,recoveryKey:undefined,revision:saved.revision+1,projectToken:match[1],roomToken:null};
   await writeProject(bucket,key,next,object.etag);if(saved.recoveryKey)await bucket.delete(saved.recoveryKey);
   return response({restored:true,...publicRoom(next)});
  }
  if(match[2])return request.method==='GET'?projectEvents(request,bucket,key,found):response({error:'Method not allowed'},405);
  if(request.method==='GET'){if(url.searchParams.get('revision')===String(saved.revision))return response(null,304);return response(publicRoom(saved))}
  if(request.method==='DELETE'){
   const value=await body(request);revisionCheck(saved,value.revision);
   // Conditional tombstone removes the bytes, invalidates every alias and
   // stops already-running saves from resurrecting the deleted project.
   const revision=saved.revision+1,recoveryKey=key+'/deleted/'+privateToken();
   // Keep an inaccessible recovery copy for explicit Undo delete. The root
   // tombstone still invalidates every capability and every stale writer.
   await writeProject(bucket,recoveryKey,saved);
   try{await writeProject(bucket,key,{deleted:true,revision,recoveryKey},object.etag)}catch(error){await bucket.delete(recoveryKey);throw error}
   await bucket.delete(key+'/preview');return response({deleted:true,revision});
  }
  if(!['PUT','PATCH'].includes(request.method))return response({error:'Method not allowed'},405);
  const value=await body(request);
  if(request.method==='PUT'){
   revisionCheck(saved,value.revision);requireProjectName(value.project);commitRoom(saved,validateProject(value.project));
   await writeProject(bucket,key,saved,object.etag);return response(publicRoom(saved,value.knownAssets||[]));
  }
  const updated=await commitProjectPatch(bucket,key,saved,object.etag,value.diff,commitRoom);
  return response(publicRoom(updated,value.knownAssets||[]));
 }
 if(path==='/api/rooms'&&request.method==='POST'){
  const value=await body(request);
  if(value.projectToken){
   if(!/^[a-f0-9]{64}$/.test(value.projectToken))throw Error('Invalid project link.');
   const found=await resolveProject(bucket,'projects/'+await keyFor(value.projectToken)),room=found.record;
   requireProjectName(room.project);revisionCheck(room,value.revision);
   if(room.roomToken&&room.expires>Date.now())return response({token:room.roomToken,...publicRoom(room)});
   const token=privateToken();await writeProject(bucket,await keyFor(token),{ref:found.key});
   room.projectToken=value.projectToken;room.roomToken=token;room.revision++;room.expires=Date.now()+PROJECT_TTL;
   await writeProject(bucket,found.key,room,found.object.etag);return response({token,...publicRoom(room)},201);
  }
  // Legacy temporary room links remain supported. Saving one requires a name.
  const project=validateProject(value),token=privateToken(),key=await keyFor(token),room={project,revision:0,history:[],expires:Date.now()+PROJECT_TTL};
  await writeProject(bucket,key,room);return response({token,...publicRoom(room)},201);
 }
 return null;
}
