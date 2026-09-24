export class ProjectCache{
 async open(){if(this.db)return this.db;this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pixel-mill-projects',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return this.db}
 async transaction(mode,action){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('projects',mode),request=action(tx.objectStore('projects'));tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
 get(id){return this.transaction('readonly',s=>s.get(id))}
 put(record){return this.transaction('readwrite',s=>s.put(record))}
 async list(){return(await this.transaction('readonly',s=>s.getAll())).filter(p=>p.id!=='active').sort((a,b)=>b.updatedAt-a.updatedAt)}
 async active(){const meta=await this.get('active');return meta?this.get(meta.projectId):null}
 select(id){return this.put({id:'active',projectId:id})}
}

export class Autosave{
 constructor(api,cache=new ProjectCache()){this.api=api;this.cache=cache;this.record=null;this.dirty=false;this.generation=0;this.saving=null;this.cacheQueue=Promise.resolve();this.cacheWarned=false;this.timer=null;this.ready=false}
 async request(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json'}});const data=await r.json();if(!r.ok){const error=Error(data.error||'Cloud saving is unavailable.');error.status=r.status;throw error}return data}
 async init({token,skipRestore=false}={}){
  let saved;try{const all=token?await this.cache.list():null;saved=token?all.find(p=>p.token===token):await this.cache.active()}catch{this.warnCache()}
  if(skipRestore)saved=null;
  if(token&&!saved){const remote=await this.request('/api/projects/'+token);saved={id:crypto.randomUUID(),token,revision:remote.revision,project:remote.project,dirty:false,updatedAt:Date.now()}}
  if(saved&&!skipRestore){
   this.record=saved;
   // Never replace an unsynced recovery copy with an older server snapshot.
   if(saved.token&&!saved.dirty)try{const remote=await this.request('/api/projects/'+saved.token);saved.project=remote.project;saved.revision=remote.revision}catch{this.api.status('Cached · offline')}
   await this.api.restore(saved.project);this.dirty=!!saved.dirty;
  }else this.record={id:crypto.randomUUID(),token:null,revision:0,project:this.api.snapshot(),dirty:false,updatedAt:Date.now()};
  this.ready=true;await this.cacheCurrent();if(this.record.token)this.api.link(this.record.token);if(this.dirty)void this.flush();return saved;
 }
 warnCache(){if(!this.cacheWarned){this.cacheWarned=true;this.api.status('Recovery cache unavailable')}}
 cacheCurrent(){if(!this.record)return Promise.resolve();const record=structuredClone({...this.record,project:this.record.project,dirty:this.dirty,updatedAt:Date.now()});this.record.updatedAt=record.updatedAt;
  this.cacheQueue=this.cacheQueue.then(async()=>{await this.cache.put(record);await this.cache.select(record.id)}).catch(()=>this.warnCache());return this.cacheQueue;
 }
 changed(){if(!this.ready)return;this.generation++;this.dirty=true;this.record.project=this.api.snapshot();void this.cacheCurrent();this.api.status('Saving…');clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),750)}
 async flush(){clearTimeout(this.timer);if(!this.ready||!this.dirty)return this.cacheQueue;if(this.saving)return this.saving;
  this.saving=(async()=>{while(this.dirty){const generation=this.generation,record=this.record,project=structuredClone(record.project);await this.cacheCurrent();try{
    const response=record.token?await this.request('/api/projects/'+record.token,{method:'PUT',body:JSON.stringify({project,revision:record.revision})}):await this.request('/api/projects',{method:'POST',body:JSON.stringify({project})});
    record.token=response.token||record.token;record.revision=response.revision;this.api.link(record.token);if(generation===this.generation)this.dirty=false;await this.cacheCurrent();this.api.status(this.dirty?'Saving…':'Saved');
   }catch(error){
    if(error.status===409){record.token=null;record.revision=0;record.id=crypto.randomUUID();this.api.status('Saving recovery copy…');continue}
    this.api.status(this.cacheWarned?'Not saved · connection needed':'Cached · cloud unavailable');break;
   }}})().finally(()=>this.saving=null);return this.saving;
 }
 async start(project){await this.flush();await this.cacheCurrent();clearTimeout(this.timer);this.record={id:crypto.randomUUID(),token:null,revision:0,project,dirty:true,updatedAt:Date.now()};await this.api.restore(project);this.dirty=true;this.generation++;await this.cacheCurrent();void this.flush()}
 async load(id){await this.flush();await this.cacheCurrent();const saved=await this.cache.get(id);if(!saved)throw Error('Saved project is unavailable.');this.record=saved;this.dirty=!!saved.dirty;this.generation++;await this.api.restore(saved.project);await this.cacheCurrent();if(saved.token)this.api.link(saved.token);if(this.dirty)void this.flush()}
 list(){return this.cache.list()}
}
