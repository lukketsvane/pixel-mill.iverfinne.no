import {resolveProject,writeProject} from './project-store.mjs';
import {projectName} from '../dist/project-state.mjs';

// The previous version stored a roomToken beside a separate saved snapshot.
// Keep that old snapshot for recovery, but route ALL reads, streams, edits,
// deletion and restoration through its live room. No copy or last-write-wins
// replacement is involved. New projects already use a small explicit alias.
export async function resolveSavedProject(bucket,keyFor,token,{allowDeleted=false}={}){
 const original=await resolveProject(bucket,'projects/'+await keyFor(token),{allowDeleted}),saved=original.record;
 if(saved.projectToken||!saved.roomToken||saved.deleted||saved.deletedAt)return original;
 let live;
 try{live=await resolveProject(bucket,await keyFor(saved.roomToken),{allowDeleted})}
 catch(error){if(error.status===404)return original;throw error}
 for(let attempt=0;attempt<3;attempt++){
  const room=live.record;
  if(room.projectToken||room.deleted||room.deletedAt)return live;
  const next={...room,projectToken:token,roomToken:saved.roomToken,revision:room.revision+1};
  if(!projectName(next.project.name)&&projectName(saved.project?.name))next.project={...next.project,name:saved.project.name};
  try{const object=await writeProject(bucket,live.key,next,live.object.etag);return{...live,record:next,object}}
  catch(error){if(error.status!==409||attempt===2)throw error;live=await resolveProject(bucket,live.key,{allowDeleted})}
 }
}
