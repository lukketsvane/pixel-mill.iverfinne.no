import {cloudRequest} from './cloud-request.mjs';
import {projectDiff,applyDiff} from './agent.mjs';
import {projectName,hasProjectChanges,projectSourceVersions,projectVersionQuery,hydrateProject,createProjectToken} from './project-state.mjs';
import {LiveUpdates} from './live-updates.mjs';

export class ProjectCache{
 async open(){if(this.db)return this.db;this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pixel-mill-projects',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return this.db}
 async transaction(mode,action){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('projects',mode),request=action(tx.objectStore('projects'));tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
 get(id){return this.transaction('readonly',s=>s.get(id))}
 put(record){return this.transaction('readwrite',s=>s.put(record))}
 async list(){return(await this.transaction('readonly',s=>s.getAll())).filter(p=>p.id!=='active'&&!p.deletedAt&&!p.draft).sort((a,b)=>b.updatedAt-a.updatedAt)}
 async deleted(){return(await this.transaction('readonly',s=>s.getAll())).filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt)}
 async active(){const meta=await this.get('active'),record=meta?await this.get(meta.projectId):null;return record&&!record.deletedAt?record:null}
 select(id){return this.put({id:'active',projectId:id})}
 remove(id){return this.transaction('readwrite',s=>{s.delete(id);const active=s.get('active');active.onsuccess=()=>{if(active.result?.projectId===id)s.delete('active')};return active})}
}

export class Autosave{
 constructor(api,cache=new ProjectCache()){
  this.api=api;this.cache=cache;this.record=null;this.dirty=false;this.generation=0;this.epoch=0;this.saving=null;this.cacheQueue=Promise.resolve();this.cacheWarned=false;this.timer=null;this.ready=false;this.blocked=null;this.validationBlocked=false;this.retryAt=0;this.failures=0;
  this.live=new LiveUpdates({revision:()=>this.record?.revision??-1,refresh:guard=>this.pull(guard),status:text=>{if(!this.dirty&&!this.blocked)this.status(text)},gone:text=>this.unavailable(text)});
 }
 status(text){this.api.status(text)}
 get shared(){return this.api.shared?.()}
 request(path,options={}){return cloudRequest(path,options)}
 async init({token,roomToken,skipRestore=false,preferredId}={}){
  this.live.stop();this.epoch++;this.blocked=null;this.validationBlocked=false;this.cloudError=null;this.retryAt=0;this.failures=0;let saved,remote,all=[];
  try{all=await this.cache.list();saved=preferredId?await this.cache.get(preferredId):token?all.find(p=>p.token===token):roomToken?all.find(p=>p.roomToken===roomToken):await this.cache.active()}catch{this.warnCache()}
  if(skipRestore&&!roomToken)saved=null;if(saved?.sharedPending)saved.dirty=true;
  try{
   if(roomToken){remote=await this.request('/api/rooms/'+roomToken);if(!remote.projectToken&&saved?.token)remote=await this.request('/api/projects/'+saved.token);else if(!remote.projectToken&&projectName(remote.project.name))remote=await this.request('/api/projects',{method:'POST',body:JSON.stringify({roomToken})});token=remote.projectToken||remote.token||null;saved??=all.find(p=>token&&p.token===token)}
   else if(token||saved?.token){token=token||saved.token;remote=await this.request('/api/projects/'+token)}
  }catch(error){if(!saved)throw error;if([404,410].includes(error.status)){saved.deleted=true;this.blocked='Project deleted · recovery kept'}else{this.cloudError=error.code||'storage_unavailable';this.status('Cached · cloud unavailable')}}
  if(remote?.projectToken)token=remote.projectToken;
  if(remote&&!saved?.dirty)saved={...(saved||{}),id:saved?.id||crypto.randomUUID(),token:token||null,roomToken:remote.roomToken||roomToken||null,revision:remote.revision,project:remote.project,baseProject:remote.project,dirty:false,deleted:false,updatedAt:Date.now()};
  this.record=saved||{id:crypto.randomUUID(),token:null,revision:0,project:this.api.snapshot(),dirty:false,updatedAt:Date.now()};
  if(this.record.deleted||this.record.deletedAt)this.blocked='Project deleted · recovery kept';
  const draft=this.record.draftProject;if(draft&&!this.blocked){this.validationBlocked=!this.record.draftBlock;this.blocked=this.record.draftBlock||(this.record.draftError||'Invalid edit.')+' Local work kept.'}
  this.dirty=!!this.record.dirty;this.viewProject=structuredClone(draft?this.record.draftBaseProject||this.record.project:this.record.project);await this.api.restore(draft||this.record.project);this.ready=true;this.generation++;if(draft&&this.blocked)this.status(this.blocked);
  await this.cacheCurrent();this.lastDeleted=(await this.cache.deleted?.())?.[0]||null;if(this.record.token)this.api.link(this.record.token);
  if(this.dirty)await this.flush();this.watch();return saved;
 }
 warnCache(){if(!this.cacheWarned){this.cacheWarned=true;this.status('Recovery cache unavailable')}}
 cacheCurrent(){if(!this.record)return Promise.resolve();const record=structuredClone({...this.record,draft:!projectName(this.record.project.name),dirty:this.dirty,updatedAt:Date.now()});this.record.updatedAt=record.updatedAt;
  this.cacheQueue=this.cacheQueue.then(async()=>{await this.cache.put(record);await this.cache.select(record.id)}).catch(()=>this.warnCache());return this.cacheQueue;
 }
 watch(){const path=this.ready&&this.record?.token&&!this.shared?.token&&!this.blocked?'/api/projects/'+this.record.token:null;if(this.live.path!==path){this.live.stop();if(path)this.live.start(path)}}
 changed(){if(!this.ready||!this.record)return;const view=this.api.snapshot();this.generation++;
  // A server acknowledgement can arrive while a pointer gesture is active.
  // Rebase only that gesture's delta, not the stale canvas's entire snapshot.
  try{this.record.project=this.viewProject?applyDiff(this.record.project,projectDiff(this.viewProject,view)):view;this.viewProject=structuredClone(view);if(this.validationBlocked&&this.blocked===(this.record.draftError||'Invalid edit.')+' Local work kept.')this.blocked=null;this.validationBlocked=false;delete this.record.draftProject;delete this.record.draftBaseProject;delete this.record.draftError;delete this.record.draftBlock}catch(error){if(error.message.startsWith('Conflict:')){this.record.project=view;this.viewProject=structuredClone(view);this.validationBlocked=false;delete this.record.draftProject;delete this.record.draftBaseProject;delete this.record.draftError;delete this.record.draftBlock;this.blocked='Conflict · local copy kept'}else{if(this.blocked&&(!this.validationBlocked||this.blocked!==(this.record.draftError||'Invalid edit.')+' Local work kept.'))this.record.draftBlock=this.blocked;this.record.draftProject=structuredClone(view);this.record.draftBaseProject??=structuredClone(this.viewProject||this.record.project);this.record.draftError=error.message;this.validationBlocked=!this.record.draftBlock;this.blocked=this.record.draftBlock||error.message+' Local work kept.'}}
  this.dirty=true;void this.cacheCurrent();clearTimeout(this.timer);
  this.status(this.blocked||(!projectName(view.name)?'Name project to save':this.shared?.paused?'Conflict · local copy kept':'Saving…'));
  if(!this.blocked&&projectName(view.name))this.timer=setTimeout(()=>void this.flush(),750);
 }
 async applyView(next,generation=this.generation,externalGuard=()=>true){const record=this.record,epoch=this.epoch;
  const guard=()=>this.record===record&&epoch===this.epoch&&generation===this.generation&&!this.api.busy?.()&&externalGuard();
  if(!guard())return false;
  const ok=this.api.apply?await this.api.apply(next,{guard,remote:true}):await this.api.restore(next);
  if(ok===false||!guard())return false;this.viewProject=structuredClone(next);return true;
 }
 async retry(){this.retryAt=0;this.failures=0;await this.flush();if(!this.dirty)await(this.shared?.token?this.shared.poll():this.pull())}
 async flush(){
  clearTimeout(this.timer);if(!this.ready||!this.dirty&&!(this.shared?.token&&!this.record.token&&projectName(this.record.project.name)))return this.cacheQueue;if(this.saving)return this.saving;
  if(Date.now()<this.retryAt)return this.cacheQueue;
  if(this.shared?.token&&!this.record.token){const current=this.record,epoch=this.epoch;await this.shared.queue;if(current!==this.record||epoch!==this.epoch)return;if(this.saving)return this.saving;if(!projectName(this.record.project.name))return this.cacheCurrent();this.dirty=true}
  if(this.blocked||!projectName(this.record.project.name))return this.cacheCurrent();
  const epoch=this.epoch,record=this.record;
  this.saving=(async()=>{while(this.dirty&&epoch===this.epoch&&record===this.record&&!this.blocked){
   const base=record.baseProject;
   let project=structuredClone(record.project);
   if(!projectName(project.name))break;
   try{
    let response;
    if(record.token){
     const diff=record.pendingMutation?.diff||(base?projectDiff(base,project):null);
     if(diff&&!hasProjectChanges(diff)){this.dirty=false;await this.cacheCurrent();break}
     if(diff){
      record.pendingMutation??={id:crypto.randomUUID(),diff};
      project=applyDiff(base,diff);await this.cacheCurrent();
     }
     response=await this.request('/api/projects/'+record.token,{method:diff?'PATCH':'PUT',body:JSON.stringify({revision:record.revision,...(diff?{diff,mutationId:record.pendingMutation.id}:{project}),knownAssets:projectSourceVersions(project.assets)})});
    }else if(this.shared?.token){
     response=await this.request('/api/projects',{method:'POST',body:JSON.stringify({roomToken:this.shared.token,knownAssets:projectSourceVersions(project.assets)})});
    }else{
     record.pendingToken??=createProjectToken();record.pendingProject??=structuredClone(project);project=structuredClone(record.pendingProject);await this.cacheCurrent();
     response=await this.request('/api/projects',{method:'POST',body:JSON.stringify({project,token:record.pendingToken,knownAssets:projectSourceVersions(project.assets)})});
    }
    if(epoch!==this.epoch||record!==this.record)return;
    const canonical=response.project?hydrateProject(response.project,project):project;
    const pending=projectDiff(project,record.project),rebased=applyDiff(canonical,pending);
    record.token=response.projectToken||response.token||record.token;record.revision=response.revision;record.roomToken=response.roomToken||null;record.baseProject=structuredClone(canonical);delete record.pendingToken;delete record.pendingProject;delete record.pendingMutation;
    record.project=rebased;this.dirty=!!record.draftProject||hasProjectChanges(projectDiff(canonical,rebased));this.cloudError=null;this.retryAt=0;this.failures=0;
    const applied=record.draftProject?false:await this.applyView(record.project);this.shared?.acknowledge?.({...response,project:canonical},applied!==false&&!this.dirty);
    this.api.link(record.token);await this.cacheCurrent();this.status(this.blocked||(this.dirty?'Saving…':'Saved'));this.watch();
   }catch(error){
    if(epoch!==this.epoch||record!==this.record)return;
    this.cloudError=error.code||'storage_unavailable';
    if(error.status===409||error.message.startsWith('Conflict:'))this.blocked='Conflict · local copy kept';
    else if([404,410].includes(error.status)){record.deleted=true;this.blocked='Project deleted · recovery kept'}
    else this.retryAt=Date.now()+Math.min(60000,2000*2**Math.min(this.failures++,5));
    this.status(this.blocked||(this.cacheWarned?'Not saved · connection needed':'Cached · cloud unavailable'));await this.cacheCurrent();break;
   }
  }})().finally(()=>this.saving=null);return this.saving;
 }
 async pull(guard=()=>true){
  if(!this.ready||!this.record?.token||this.shared?.token||this.blocked)return;
  if(this.api.busy?.()||this.saving)return false;
  if(this.dirty){await this.flush();return !this.dirty||!!this.retryAt}
  const record=this.record,generation=this.generation,epoch=this.epoch;
  let remote;
  try{remote=await this.request('/api/projects/'+record.token+'?revision='+record.revision+'&'+projectVersionQuery(record.project.assets))}catch(error){if(record===this.record&&epoch===this.epoch)this.cloudError=error.code||'storage_unavailable';throw error}
  if(!guard()||record!==this.record||epoch!==this.epoch)return;
  this.cloudError=null;
  if(!remote){if(JSON.stringify(this.viewProject)!==JSON.stringify(record.project))return this.applyView(record.project,generation,guard);return true}
  if(generation!==this.generation||this.api.busy?.())return false;
  remote.project=hydrateProject(remote.project,record.project);
  if(await this.applyView(remote.project,generation,guard)===false)return false;
  if(!guard()||record!==this.record)return;
  record.project=structuredClone(remote.project);record.baseProject=structuredClone(remote.project);record.revision=remote.revision;record.roomToken=remote.roomToken||null;
  await this.cacheCurrent();this.status('Live · r'+record.revision);return true;
 }
 acceptRemote(room,roomToken){
  if(!this.ready||!this.record)return;
  if(this.record.token&&room.projectToken&&this.record.token!==room.projectToken)return;
  this.generation++;this.dirty=false;this.blocked=null;this.validationBlocked=false;this.cloudError=null;delete this.record.draftProject;delete this.record.draftBaseProject;delete this.record.draftError;delete this.record.draftBlock;
  Object.assign(this.record,{token:room.projectToken||this.record.token,roomToken,revision:room.revision,project:structuredClone(room.project),baseProject:structuredClone(room.project),deleted:false});
  this.viewProject=structuredClone(room.project);void this.cacheCurrent();this.watch();this.status('Live · r'+room.revision);
 }
 unavailable(message){this.live.stop();this.blocked='Project unavailable · recovery kept';if(this.record){this.record.deleted=true;void this.cacheCurrent()}this.status(this.blocked);this.api.error?.(message)}
 async start(project){await this.flush();await this.cacheCurrent();this.live.stop();this.epoch++;clearTimeout(this.timer);this.blocked=null;this.validationBlocked=false;this.cloudError=null;this.retryAt=0;this.failures=0;
  this.record={id:crypto.randomUUID(),token:null,revision:0,project,dirty:true,updatedAt:Date.now()};this.viewProject=structuredClone(project);await this.api.restore(project);this.ready=true;this.dirty=true;this.generation++;await this.cacheCurrent();void this.flush();this.status(projectName(project.name)?'Saving…':'Name project to save');
 }
 async load(id){await this.flush();await this.cacheCurrent();const saved=await this.cache.get(id);if(!saved)throw Error('Saved project is unavailable.');await this.cache.select(id);return this.init({token:saved.token,preferredId:id})}
 async remove(id){
  const selected=this.record?.id===id?this.record:await this.cache.get(id);if(!selected)return false;
  const key=selected.token||selected.pendingToken,active=this.record?.id===id||!!key&&key===(this.record?.token||this.record?.pendingToken);
  if(active){await this.flush();await this.saving;this.ready=false;this.epoch++;this.live.stop();clearTimeout(this.timer)}
  await this.cacheQueue;const record=structuredClone(active?this.record:selected),recoveryDirty=active?this.dirty:!!selected.dirty;
  try{
   const token=record.token||record.pendingToken;
   if(token&&!record.deleted)try{let revision=record.revision;for(let attempt=0;;attempt++){try{const result=await this.request('/api/projects/'+token,{method:'DELETE',body:JSON.stringify({revision})});record.token=token;record.revision=result.revision;break}catch(error){if(error.status!==409||attempt===2)throw error;revision=(await this.request('/api/projects/'+token+'?'+projectVersionQuery(record.project.assets))).revision}}}catch(error){if(![404,410].includes(error.status))throw error;record.token=null}
   record.deletedAt=Date.now();record.dirty=false;if(recoveryDirty)record.recoveryDirty=true;delete record.pendingToken;
   for(const saved of await this.cache.list())if(saved.id===record.id||token&&(saved.token||saved.pendingToken)===token)await this.cache.put({...saved,...record,id:saved.id});
   await this.cache.put(record);this.lastDeleted=record;
   if(active){this.record=null;this.dirty=false;this.blocked=null;await this.cache.select(null)}return active;
  }catch(error){if(active){this.ready=true;this.watch()}if(error.status===409)throw Error('Project is still updating. Try deleting again.');throw error}
 }
 async restoreDeleted(){
  const old=this.lastDeleted;if(!old)return;let remote;
  if(old.token)remote=await this.request('/api/projects/'+old.token,{method:'POST',body:JSON.stringify({restore:true,revision:old.revision})});
  const record={...old,deleted:false,deletedAt:undefined,roomToken:null,dirty:!!old.recoveryDirty,...(remote?{...(!old.recoveryDirty?{project:remote.project,baseProject:remote.project}:{}),revision:remote.revision}:{})};delete record.recoveryDirty;
  await this.cache.put(record);this.lastDeleted=(await this.cache.deleted?.())?.[0]||null;return record.id;
 }

 list(){return this.cache.list()}
 stop(){clearTimeout(this.timer);this.live.stop();this.epoch++}
}
