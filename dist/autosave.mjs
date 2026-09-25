import {projectDiff,applyDiff} from './agent.mjs';
import {projectName,hasProjectChanges,projectSourceVersions,hydrateProject} from './project-state.mjs';
import {LiveUpdates} from './live-updates.mjs';

export class ProjectCache{
 async open(){if(this.db)return this.db;this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pixel-mill-projects',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return this.db}
 async transaction(mode,action){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('projects',mode),request=action(tx.objectStore('projects'));tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
 get(id){return this.transaction('readonly',s=>s.get(id))}
 put(record){return this.transaction('readwrite',s=>s.put(record))}
 async list(){return(await this.transaction('readonly',s=>s.getAll())).filter(p=>p.id!=='active').sort((a,b)=>b.updatedAt-a.updatedAt)}
 async active(){const meta=await this.get('active');return meta?this.get(meta.projectId):null}
 select(id){return this.put({id:'active',projectId:id})}
 remove(id){return this.transaction('readwrite',s=>{s.delete(id);const active=s.get('active');active.onsuccess=()=>{if(active.result?.projectId===id)s.delete('active')};return active})}
}

export class Autosave{
 constructor(api,cache=new ProjectCache()){
  this.api=api;this.cache=cache;this.record=null;this.dirty=false;this.generation=0;this.epoch=0;this.saving=null;this.cacheQueue=Promise.resolve();this.cacheWarned=false;this.timer=null;this.ready=false;this.blocked=null;
  this.live=new LiveUpdates({revision:()=>this.record?.revision??-1,refresh:guard=>this.pull(guard),status:text=>{if(!this.dirty&&!this.blocked)this.status(text)},gone:text=>this.unavailable(text)});
 }
 status(text){this.api.status(text)}
 get shared(){return this.api.shared?.()}
 async request(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json'}});if(r.status===304)return null;const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Cloud saving is unavailable.'),{status:r.status});return data}
 async init({token,roomToken,skipRestore=false,preferredId}={}){
  this.live.stop();this.epoch++;this.blocked=null;let saved,remote,all=[];
  try{all=await this.cache.list();saved=preferredId?await this.cache.get(preferredId):token?all.find(p=>p.token===token):roomToken?all.find(p=>p.roomToken===roomToken):await this.cache.active()}catch{this.warnCache()}
  if(skipRestore)saved=null;
  try{
   if(roomToken){remote=await this.request('/api/rooms/'+roomToken);if(!remote.projectToken&&projectName(remote.project.name))remote=await this.request('/api/projects',{method:'POST',body:JSON.stringify({roomToken})});token=remote.projectToken||remote.token||null;saved??=all.find(p=>token&&p.token===token)}
   else if(token||saved?.token){token=token||saved.token;remote=await this.request('/api/projects/'+token)}
  }catch(error){if(!saved)throw error;if([404,410].includes(error.status)){saved.deleted=true;this.blocked='Project deleted · recovery kept'}else this.status('Cached · offline')}
  if(remote&&!saved?.dirty)saved={...(saved||{}),id:saved?.id||crypto.randomUUID(),token:token||null,roomToken:remote.roomToken||roomToken||null,revision:remote.revision,project:remote.project,baseProject:remote.project,dirty:false,deleted:false,updatedAt:Date.now()};
  this.record=saved||{id:crypto.randomUUID(),token:null,revision:0,project:this.api.snapshot(),dirty:false,updatedAt:Date.now()};
  if(this.record.deleted)this.blocked='Project deleted · recovery kept';
  this.dirty=!!this.record.dirty;this.viewProject=structuredClone(this.record.project);await this.api.restore(this.record.project);this.ready=true;this.generation++;
  await this.cacheCurrent();if(this.record.token)this.api.link(this.record.token);
  if(this.dirty)await this.flush();this.watch();return saved;
 }
 warnCache(){if(!this.cacheWarned){this.cacheWarned=true;this.status('Recovery cache unavailable')}}
 cacheCurrent(){if(!this.record)return Promise.resolve();const record=structuredClone({...this.record,dirty:this.dirty,updatedAt:Date.now()});this.record.updatedAt=record.updatedAt;
  this.cacheQueue=this.cacheQueue.then(async()=>{await this.cache.put(record);await this.cache.select(record.id)}).catch(()=>this.warnCache());return this.cacheQueue;
 }
 watch(){const path=this.ready&&this.record?.token&&!this.shared?.token&&!this.blocked?'/api/projects/'+this.record.token:null;if(this.live.path!==path){this.live.stop();if(path)this.live.start(path)}}
 changed(){if(!this.ready||!this.record)return;const view=this.api.snapshot();this.generation++;
  // A server acknowledgement can arrive while a pointer gesture is active.
  // Rebase only that gesture's delta, not the stale canvas's entire snapshot.
  try{this.record.project=this.viewProject?applyDiff(this.record.project,projectDiff(this.viewProject,view)):view}catch{this.record.project=view;this.blocked='Conflict · local copy kept'}
  this.viewProject=structuredClone(view);this.dirty=true;void this.cacheCurrent();clearTimeout(this.timer);
  this.status(this.blocked||(!projectName(view.name)?'Name project to save':this.shared?.paused?'Conflict · local copy kept':'Saving…'));
  if(!this.shared?.token&&!this.blocked&&projectName(view.name))this.timer=setTimeout(()=>void this.flush(),750);
 }
 async applyView(next,generation=this.generation,externalGuard=()=>true){const record=this.record,epoch=this.epoch;
  const guard=()=>this.record===record&&epoch===this.epoch&&generation===this.generation&&!this.api.busy?.()&&externalGuard();
  if(!guard())return false;
  const ok=this.api.apply?await this.api.apply(next,{guard,remote:true}):await this.api.restore(next);
  if(ok===false||!guard())return false;this.viewProject=structuredClone(next);return true;
 }
 async flush(){
  clearTimeout(this.timer);if(!this.ready||!this.dirty)return this.cacheQueue;if(this.saving)return this.saving;
  if(this.shared?.token){await this.shared.queue;return this.cacheCurrent()}
  if(this.blocked||!projectName(this.record.project.name))return this.cacheCurrent();
  const epoch=this.epoch,record=this.record;
  this.saving=(async()=>{while(this.dirty&&epoch===this.epoch&&record===this.record&&!this.blocked){
   const generation=this.generation,project=structuredClone(record.project),base=record.baseProject;
   if(!projectName(project.name))break;
   try{
    let response;
    if(record.token){
     const diff=base?projectDiff(base,project):null;
     if(diff&&!hasProjectChanges(diff)){this.dirty=false;await this.cacheCurrent();break}
     response=await this.request('/api/projects/'+record.token,{method:diff?'PATCH':'PUT',body:JSON.stringify({revision:record.revision,...(diff?{diff}:{project}),knownAssets:projectSourceVersions(project.assets)})});
    }else{
     record.pendingToken??=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');await this.cacheCurrent();
     response=await this.request('/api/projects',{method:'POST',body:JSON.stringify({project,token:record.pendingToken})});
    }
    if(epoch!==this.epoch||record!==this.record)return;
    const canonical=response.project?hydrateProject(response.project,project):project;
    const pending=projectDiff(project,record.project);record.token=response.projectToken||response.token||record.token;record.revision=response.revision;record.roomToken=response.roomToken||null;record.baseProject=structuredClone(canonical);delete record.pendingToken;
    record.project=applyDiff(canonical,pending);this.dirty=generation!==this.generation;
    await this.applyView(record.project);this.api.link(record.token);await this.cacheCurrent();this.status(this.dirty?'Saving…':'Saved');this.watch();
   }catch(error){
    if(epoch!==this.epoch||record!==this.record)return;
    if(error.status===409||error.message.startsWith('Conflict:'))this.blocked='Conflict · local copy kept';
    else if([404,410].includes(error.status)){record.deleted=true;this.blocked='Project deleted · recovery kept'}
    this.status(this.blocked||(this.cacheWarned?'Not saved · connection needed':'Cached · cloud unavailable'));await this.cacheCurrent();break;
   }
  }})().finally(()=>this.saving=null);return this.saving;
 }
 async pull(guard=()=>true){
  if(!this.ready||!this.record?.token||this.shared?.token||this.blocked)return;
  if(this.api.busy?.()||this.saving)return false;
  if(this.dirty){await this.flush();return !this.dirty}
  const record=this.record,generation=this.generation,epoch=this.epoch;
  const remote=await this.request('/api/projects/'+record.token+'?revision='+record.revision);
  if(!guard()||record!==this.record||epoch!==this.epoch)return;
  if(!remote){if(JSON.stringify(this.viewProject)!==JSON.stringify(record.project))return this.applyView(record.project,generation,guard);return true}
  if(generation!==this.generation||this.api.busy?.())return false;
  if(await this.applyView(remote.project,generation,guard)===false)return false;
  if(!guard()||record!==this.record)return;
  record.project=structuredClone(remote.project);record.baseProject=structuredClone(remote.project);record.revision=remote.revision;record.roomToken=remote.roomToken||null;
  await this.cacheCurrent();this.status('Live · r'+record.revision);return true;
 }
 acceptRemote(room,roomToken){
  if(!this.ready||!this.record)return;
  if(this.record.token&&room.projectToken&&this.record.token!==room.projectToken)return;
  this.generation++;this.dirty=false;this.blocked=null;
  Object.assign(this.record,{token:room.projectToken||this.record.token,roomToken,revision:room.revision,project:structuredClone(room.project),baseProject:structuredClone(room.project),deleted:false});
  this.viewProject=structuredClone(room.project);void this.cacheCurrent();this.watch();this.status('Live · r'+room.revision);
 }
 unavailable(message){this.live.stop();this.blocked='Project unavailable · recovery kept';if(this.record){this.record.deleted=true;void this.cacheCurrent()}this.status(this.blocked);this.api.error?.(message)}
 async start(project){await this.flush();await this.cacheCurrent();this.live.stop();this.epoch++;clearTimeout(this.timer);this.blocked=null;
  this.record={id:crypto.randomUUID(),token:null,revision:0,project,dirty:true,updatedAt:Date.now()};this.viewProject=structuredClone(project);await this.api.restore(project);this.ready=true;this.dirty=true;this.generation++;await this.cacheCurrent();void this.flush();this.status(projectName(project.name)?'Saving…':'Name project to save');
 }
 async load(id){await this.flush();await this.cacheCurrent();const saved=await this.cache.get(id);if(!saved)throw Error('Saved project is unavailable.');await this.cache.select(id);return this.init({token:saved.token,preferredId:id})}
 async remove(id){
  const active=this.record?.id===id;if(active){await this.flush();await this.saving;this.ready=false;this.epoch++;this.live.stop();clearTimeout(this.timer)}
  await this.cacheQueue;const record=active?this.record:await this.cache.get(id);if(!record){if(active)this.ready=true;return false}
  try{
   if(record.token&&!record.deleted)try{await this.request('/api/projects/'+record.token,{method:'DELETE',body:JSON.stringify({revision:record.revision})})}catch(error){if(![404,410].includes(error.status))throw error}
   const entries=await this.cache.list();for(const saved of entries)if(saved.id===id||record.token&&saved.token===record.token)await this.cache.remove(saved.id);
   if(active){this.record=null;this.dirty=false;this.blocked=null}return active;
  }catch(error){if(active){this.ready=true;this.watch()}if(error.status===409)throw Error('Project changed elsewhere. Open its latest version before deleting.');throw error}
 }
 list(){return this.cache.list()}
 stop(){clearTimeout(this.timer);this.live.stop();this.epoch++}
}
