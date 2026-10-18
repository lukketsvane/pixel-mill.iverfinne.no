import {validateProject} from '../dist/engine.mjs';
import {resolveSavedProject} from './legacy-projects.mjs';
import {applyDiff,patchSourceHash} from '../dist/agent.mjs';
import {requireProjectName} from '../dist/project-state.mjs';
import {privateToken,projectError,assertStoredProject,assertRoomAccess,resolveProject,writeProject,projectEvents,PROJECT_TTL} from './project-store.mjs';

export async function commitProjectPatch(bucket,key,record,etag,diff,commit,access=()=>{},mutationId){
 if(mutationId!==undefined&&(typeof mutationId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(mutationId)))throw Error('Invalid edit identifier.');
 const fingerprint=mutationId?patchSourceHash(JSON.stringify(diff)):null;
 for(let attempt=0;attempt<3;attempt++){
  assertStoredProject(record);access(record);
  const receipt=record.mutations?.find(item=>item.id===mutationId);
  if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('An edit identifier cannot be reused for different changes.');return record}
  const next=applyDiff(record.project,diff);if(record.projectToken)requireProjectName(next);
  if(JSON.stringify(next)!==JSON.stringify(record.project))commit(record,next);else if(!mutationId)return record;
  if(mutationId)record.mutations=[...(record.mutations||[]),{id:mutationId,fingerprint}].slice(-128);
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
  if(value.token&&await bucket.get(key)){const existing=await resolveSavedProject(bucket,keyFor,token);return response({token,...publicRoom(existing.record,value.knownAssets||[])})}
  const saved={project,revision:0,history:[],projectToken:token};
  await writeProject(bucket,key,saved);return response({token,...publicRoom(saved,value.knownAssets||[])},201);
 }
 const match=path.match(/^\/api\/projects\/([a-f0-9]{64})(\/events)?$/);
 if(match){
  const found=await resolveSavedProject(bucket,keyFor,match[1],{allowDeleted:request.method==='POST'}),{key,object,record:saved}=found;saved.projectToken??=match[1];
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
  if(request.method==='GET'){if(url.searchParams.get('revision')===String(saved.revision))return response(null,304);const known=url.searchParams.has('assetVersions')?JSON.parse(url.searchParams.get('assetVersions')):[];return response(publicRoom(saved,known))}
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
  const updated=await commitProjectPatch(bucket,key,saved,object.etag,value.diff,commitRoom,undefined,value.mutationId);
  return response(publicRoom(updated,value.knownAssets||[]));
 }
 if(path==='/api/rooms'&&request.method==='POST'){
  const value=await body(request);
  if(value.projectToken){
   if(!/^[a-f0-9]{64}$/.test(value.projectToken))throw Error('Invalid project link.');
   for(let attempt=0;attempt<3;attempt++){
    const found=await resolveSavedProject(bucket,keyFor,value.projectToken),room=found.record;
    requireProjectName(room.project);
    if(room.roomToken&&room.expires>Date.now())return response({token:room.roomToken,...publicRoom(room)});
    const token=privateToken(),alias=await keyFor(token);await writeProject(bucket,alias,{ref:found.key});
    room.projectToken=value.projectToken;room.roomToken=token;room.revision++;room.expires=Date.now()+PROJECT_TTL;
    try{await writeProject(bucket,found.key,room,found.object.etag);return response({token,...publicRoom(room)},201)}catch(error){if(!error.message.startsWith('Conflict:'))throw error;await bucket.delete(alias);if(attempt===2)throw error}
   }
  }
  if(value.connectionToken){
   if(typeof value.connectionToken!=='string'||!/^706d763200000001[a-f0-9]{48}$/.test(value.connectionToken))throw Error('Invalid connection identifier.');
   const token=value.connectionToken,key=await keyFor(token),project=validateProject(value.project);
   try{const existing=await resolveProject(bucket,key);assertRoomAccess(existing.record,token);return response({token,...publicRoom(existing.record)})}catch(error){if(error.status!==404)throw error}
   const room={project,revision:0,history:[],expires:Date.now()+PROJECT_TTL};
   try{await writeProject(bucket,key,room);return response({token,...publicRoom(room)},201)}catch(error){if(!error.message.startsWith('Conflict:'))throw error;const existing=await resolveProject(bucket,key);assertRoomAccess(existing.record,token);return response({token,...publicRoom(existing.record)})}
  }
  // Legacy temporary room links remain supported. Saving one requires a name.
  const project=validateProject(value),token=privateToken(),key=await keyFor(token),room={project,revision:0,history:[],expires:Date.now()+PROJECT_TTL};
  await writeProject(bucket,key,room);return response({token,...publicRoom(room)},201);
 }
 return null;
}
