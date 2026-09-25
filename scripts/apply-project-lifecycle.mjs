import fs from 'node:fs';
import {execFileSync as exec} from 'node:child_process';
const git=(...args)=>exec('git',args,{encoding:'utf8'}).trim();
const main='c0f0684218c291c58fb8e4b71a93e5bacee07fb9';
try{git('fetch','--unshallow','origin')}catch{git('fetch','origin','main')}
if(git('rev-parse','origin/main')!==main)throw Error('Main changed again; review it before merging.');
let merged=false;try{git('merge-base','--is-ancestor',main,'HEAD');merged=true}catch{}
if(!merged){
 const ours=git('rev-parse','HEAD');git('config','user.name','Pixel Mill integration');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
 const reviewed=['dist/app.mjs','dist/autosave.mjs','dist/index.html','dist/shared.mjs','scripts/build.mjs','worker/api.mjs','tests/editor.test.mjs','tests/autosave-chat.test.mjs','tests/project-lifecycle.test.mjs'];
 const legacy=git('show',main+':tests/project-lifecycle.test.mjs');
 try{git('merge','--no-commit','--no-ff',main)}catch{}
 const conflicts=git('diff','--name-only','--diff-filter=U').split('\n').filter(Boolean);
 if(conflicts.some(file=>!reviewed.includes(file)))throw Error('Unexpected merge conflict: '+conflicts.join(', '));
 // Retain the reviewed canonical implementation for overlapping architecture;
 // port the other implementation's undo-delete feature below. Independent
 // browser fixtures, CSS and all unrelated main changes merge normally.
 for(const file of reviewed)git('restore','--source='+ours,'--staged','--worktree',file);
 fs.writeFileSync('tests/project-lifecycle-legacy.test.mjs',legacy);
}
function replace(file,before,after){let s=fs.readFileSync(file,'utf8');if(s.includes(after))return;if(!s.includes(before))throw Error('Expected source changed: '+file+' / '+before.slice(0,90));fs.writeFileSync(file,s.replace(before,after))}
const store='worker/project-store.mjs',routes='worker/project-routes.mjs',save='dist/autosave.mjs',controls='dist/project-controls.mjs',app='dist/app.mjs';
replace(store,'if(!record||record.deleted)throw','if(!record||record.deleted||record.deletedAt)throw');
replace(store,'async function resolveProject(bucket,entryKey){','async function resolveProject(bucket,entryKey,{allowDeleted=false}={}){');
replace(store,'const alias=await entry.json();assertStoredProject(alias);','const alias=await entry.json();if(!allowDeleted)assertStoredProject(alias);');
replace(store,'const record=alias.ref?await object.json():alias;assertStoredProject(record);','const record=alias.ref?await object.json():alias;if(!allowDeleted)assertStoredProject(record);');
replace(routes,"const found=await resolveProject(bucket,'projects/'+await keyFor(match[1])),{key,object,record:saved}=found;saved.projectToken??=match[1];",`const found=await resolveProject(bucket,'projects/'+await keyFor(match[1]),{allowDeleted:request.method==='POST'}),{key,object,record:saved}=found;saved.projectToken??=match[1];
  if(request.method==='POST'){
   const value=await body(request);revisionCheck(saved,value.revision);
   if(!value.restore||!saved.deleted&&!saved.deletedAt)throw Error('No deleted project to restore.');
   const backup=saved.recoveryKey?await bucket.get(saved.recoveryKey):null;
   const original=backup?await backup.json():saved.project?saved:null;
   if(!original?.project)throw Error('The recovery copy is unavailable.');
   const next={...original,deleted:false,deletedAt:undefined,recoveryKey:undefined,revision:saved.revision+1,projectToken:match[1],roomToken:null};
   await writeProject(bucket,key,next,object.etag);if(saved.recoveryKey)await bucket.delete(saved.recoveryKey);
   return response({restored:true,...publicRoom(next)});
  }`);
replace(routes,"await writeProject(bucket,key,{deleted:true,revision:saved.revision+1},object.etag);\n   await bucket.delete(key+'/preview');return response({deleted:true});",`const revision=saved.revision+1,recoveryKey=key+'/deleted/'+privateToken();
   // Keep an inaccessible recovery copy for explicit Undo delete. The root
   // tombstone still invalidates every capability and every stale writer.
   await writeProject(bucket,recoveryKey,saved);
   try{await writeProject(bucket,key,{deleted:true,revision,recoveryKey},object.etag)}catch(error){await bucket.delete(recoveryKey);throw error}
   await bucket.delete(key+'/preview');return response({deleted:true,revision});`);
replace(save,".filter(p=>p.id!=='active').sort", ".filter(p=>p.id!=='active'&&!p.deletedAt&&!p.draft).sort");
replace(save,"async active(){const meta=await this.get('active');return meta?this.get(meta.projectId):null}","async deleted(){return(await this.transaction('readonly',s=>s.getAll())).filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt)}\n async active(){const meta=await this.get('active'),record=meta?await this.get(meta.projectId):null;return record&&!record.deletedAt?record:null}");
replace(save,"if(skipRestore)saved=null;", "if(skipRestore&&!roomToken)saved=null;if(saved?.sharedPending)saved.dirty=true;");
replace(save,"this.record.deleted)this.blocked", "this.record.deleted||this.record.deletedAt)this.blocked");
replace(save,"await this.cacheCurrent();if(this.record.token)this.api.link(this.record.token);", "await this.cacheCurrent();this.lastDeleted=(await this.cache.deleted?.())?.[0]||null;if(this.record.token)this.api.link(this.record.token);");
replace(save,"structuredClone({...this.record,dirty:this.dirty,updatedAt:Date.now()})", "structuredClone({...this.record,draft:!projectName(this.record.project.name),dirty:this.dirty,updatedAt:Date.now()})");
const begin=fs.readFileSync(save,'utf8').indexOf(' async remove(id){'),end=fs.readFileSync(save,'utf8').indexOf('\n list(){',begin);
let s=fs.readFileSync(save,'utf8');s=s.slice(0,begin)+` async remove(id){
  const selected=this.record?.id===id?this.record:await this.cache.get(id);if(!selected)return false;
  const key=selected.token||selected.pendingToken,active=this.record?.id===id||!!key&&key===(this.record?.token||this.record?.pendingToken);
  if(active){await this.flush();await this.saving;this.ready=false;this.epoch++;this.live.stop();clearTimeout(this.timer)}
  await this.cacheQueue;const record=structuredClone(active?this.record:selected);
  try{
   const token=record.token||record.pendingToken;
   if(token&&!record.deleted)try{const result=await this.request('/api/projects/'+token,{method:'DELETE',body:JSON.stringify({revision:record.revision})});record.token=token;record.revision=result.revision}catch(error){if(![404,410].includes(error.status))throw error;record.token=null}
   record.deletedAt=Date.now();record.dirty=false;delete record.pendingToken;
   for(const saved of await this.cache.list())if(saved.id===record.id||token&&(saved.token||saved.pendingToken)===token)await this.cache.put({...saved,...record,id:saved.id});
   await this.cache.put(record);this.lastDeleted=record;
   if(active){this.record=null;this.dirty=false;this.blocked=null;await this.cache.select(null)}return active;
  }catch(error){if(active){this.ready=true;this.watch()}if(error.status===409)throw Error('Project changed elsewhere. Open its latest version before deleting.');throw error}
 }
 async restoreDeleted(){
  const old=this.lastDeleted;if(!old)return;let remote;
  if(old.token)remote=await this.request('/api/projects/'+old.token,{method:'POST',body:JSON.stringify({restore:true,revision:old.revision})});
  const record={...old,deleted:false,deletedAt:undefined,roomToken:null,dirty:false,...(remote?{project:remote.project,baseProject:remote.project,revision:remote.revision}:{})};
  await this.cache.put(record);this.lastDeleted=(await this.cache.deleted?.())?.[0]||null;return record.id;
 }
`+s.slice(end);fs.writeFileSync(save,s);
replace(controls,"This cannot be undone.","Undo delete can restore it from this device.");
replace(controls,"const recovery=document.createElement('div');", "const undo=document.createElement('button');undo.id='undo-project-delete';undo.textContent='Undo delete';undo.hidden=true;dialog.append(undo);\n const recovery=document.createElement('div');");
replace(controls,"function refresh(){const save=api.getSave(),shared=api.getShared();", "function refresh(){const save=api.getSave(),shared=api.getShared();undo.hidden=!save?.lastDeleted;undo.disabled=busy;");
replace(controls,"const projects=(await save?.list()||[]).filter", "const projects=(await save?.list()||[]).filter");
replace(controls,"api.message('Project deleted');await render()", "api.message('Project deleted · Undo delete restores it');await render()");
replace(controls,"return{refresh,status(text)", "undo.onclick=async()=>{if(busy)return;busy=true;refresh();try{await api.getSave().restoreDeleted();await render();api.message('Project restored')}catch(error){api.message(error.message)}finally{busy=false;refresh()}};\n return{refresh,status(text)");
replace('dist/shared.mjs',"if(this.api.busy()||this.pending){this.incoming=room;return false}","if(this.api.busy()||this.pending){this.incoming=room;this.api.status?.('Changes waiting…');return false}");
replace(app,"function projectBusy(){return !!gesture", "function projectBusy(){return !!document.activeElement?.matches?.('#inspector input,#inspector select')||!!gesture");
// Browser async rendering should be awaited, not checked synchronously.
replace('tests/project-lifecycle-browser.test.mjs',"assert.ok(await remove.isVisible());", "await remove.waitFor({state:'visible'});assert.ok(await remove.isVisible());");
replace('tests/project-lifecycle-browser.test.mjs',"assert.deepEqual(errors,[]);", "await page.click('#undo-project-delete');await page.waitForFunction(()=>document.querySelectorAll('.project-row').length===1);assert.equal((await fetch(origin+'/api/projects/'+projectToken)).status,200);assert.deepEqual(errors,[]);");
replace('tests/project-lifecycle.test.mjs',"async list(){return [...this.data.values()].map(p=>structuredClone(p))}","async list(){return [...this.data.values()].filter(p=>!p.deletedAt&&!p.draft).map(p=>structuredClone(p))}\n async deleted(){return [...this.data.values()].filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt)}");
replace('tests/project-lifecycle.test.mjs',"['deleted','revision']);", "['deleted','recoveryKey','revision']);");
replace('tests/project-lifecycle.test.mjs',"assert.equal(await cache.get(id),undefined);assert.equal(save.record,null);", "assert.ok((await cache.get(id)).deletedAt);assert.equal((await cache.list()).length,0);assert.equal(save.record,null);await save.restoreDeleted();assert.equal((await cache.list()).length,1);");
// Retain the parallel main branch's browser scenario, with the new native
// confirmation and streaming connection (networkidle is inappropriate for SSE).
const browser='tests/artwork-browser.test.mjs';
replace(browser,"await page.locator('#sync-status').innerText()==='Live'", "/^Live/.test(await page.locator('#sync-status').innerText())");
replace(browser,"page.reload({waitUntil:'networkidle'})", "page.reload({waitUntil:'domcontentloaded'})");
replace(browser,"await page.locator('.delete-project').click();assert.equal(await page.locator('.delete-project').innerText(),'Delete?');await page.locator('.delete-project').click();", "page.once('dialog',dialog=>dialog.accept());await page.locator('.project-delete').click();");
// Keep both sets of regression coverage; use a real canonical room capability
// rather than attaching an arbitrary, nonexistent token in the legacy test.
const legacy='tests/project-lifecycle-legacy.test.mjs';
replace(legacy,"async put(k,text,{onlyIf}={})", "async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.data.delete(k)}async put(k,text,{onlyIf}={})");
replace(legacy,"const roomToken='a'.repeat(64);await save.bindRoom(roomToken);await save.flush();const cloud=await (await fetch('/api/projects/'+token)).json();", "const linked=await (await fetch('/api/rooms',{method:'POST',body:JSON.stringify({projectToken:token,revision:save.record.revision})})).json();const roomToken=linked.token;await save.pull();const cloud=await (await fetch('/api/projects/'+token)).json();");
replace(legacy,"await reopened.init({roomToken,skipRestore:true});", "await reopened.init({roomToken});t.after(()=>{save.stop();reopened.stop()});");
replace(legacy,"assert.equal(response.status,409);", "assert.equal(response.status,410);");
replace(legacy,"assert.equal(statuses.at(-1),'Live');", "assert.match(statuses.at(-1),/^Live/);");
console.log('Reconciled main and retained reversible deletion.');
