import {projectName} from './project-state.mjs';

export function installProjectControls(api){
 const $=selector=>document.querySelector(selector),list=$('#saved-projects'),dialog=$('#projects-dialog');
 const indicator=document.createElement('span');indicator.id='sync-status';indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');$('#app').append(indicator);
 let busy=false;
 const recovery=document.createElement('div');recovery.className='project-recovery';
 const explanation=document.createElement('p');explanation.textContent='Your local changes are kept. Save them as a new project, or load the latest cloud version.';
 const copy=document.createElement('button');copy.textContent='Save local as new project';
 const latest=document.createElement('button');latest.textContent='Load latest cloud version';
 recovery.append(explanation,copy,latest);
 function refresh(){const save=api.getSave(),shared=api.getShared();recovery.hidden=!(save?.blocked||shared?.paused);latest.disabled=!save?.record?.token||busy;copy.disabled=busy;indicator.hidden=!indicator.textContent}
 async function openProject(p){
  if(busy)return;busy=true;refresh();api.prepare();
  try{await api.leave();const save=api.getSave();await save.load(p.id);const token=save.record?.roomToken;if(token&&!save.dirty&&!save.blocked)try{await api.getShared().connect(token)}catch(error){api.getShared().detach();api.message(error.message)}api.opened();dialog.close()}
  catch(error){api.message(error.message)}finally{busy=false;refresh()}
 }
 async function deleteProject(p){
  if(busy||!window.confirm('Delete “'+(projectName(p.project.name)||'Unsaved draft')+'”? This removes the saved project and revokes its agent link. This cannot be undone.'))return;
  busy=true;refresh();api.prepare();const save=api.getSave(),shared=api.getShared();
  try{await shared.queue;const active=await save.remove(p.id);if(active)await api.reset();api.message('Project deleted');await render()}
  catch(error){api.message(error.message,7000)}finally{busy=false;refresh()}
 }
 async function render(){
  list.replaceChildren();list.append(recovery);refresh();const save=api.getSave();
  const projects=(await save?.list()||[]).filter(p=>projectName(p.project?.name)||p.project?.objects?.length||p.project?.assets?.length);
  if(!projects.length){const empty=document.createElement('p');empty.className='projects-empty';empty.textContent='No saved projects yet. Name your project to save it.';list.append(empty);return}
  for(const p of projects){
   const row=document.createElement('div');row.className='project-row';
   const open=document.createElement('button');open.className='project-open';open.textContent=projectName(p.project.name)||'Unsaved draft';open.title=p.deleted?'Local recovery · cloud project deleted':p.dirty?'Local changes kept':p.token?'Saved project':'On this device';open.setAttribute('aria-current',String(p.id===save.record?.id));open.onclick=()=>openProject(p);
   const remove=document.createElement('button');remove.className='project-delete';remove.setAttribute('aria-label','Delete '+open.textContent);remove.title='Delete project';api.icon(remove,'trash');remove.onclick=()=>deleteProject(p);
   row.append(open,remove);list.append(row);
  }
 }
 $('#projects-button').onclick=async()=>{if(busy)return;api.prepare();try{await render();$('#project').hidden=true;dialog.showModal()}catch(error){api.message(error.message)}};
 $('#close-projects').onclick=()=>{if(!busy)dialog.close()};
 copy.onclick=async()=>{
  if(busy)return;const name=window.prompt('Name the recovery project',((projectName(api.snapshot().name)||'Project').slice(0,45)+' (recovery)'));if(name===null)return;if(!projectName(name)){api.message('Give the project a name before saving.');return}
  busy=true;refresh();try{await api.start({...api.snapshot(),name:projectName(name)});await api.getSave().flush();api.opened();await render();api.message(api.getSave().dirty?'Recovery kept on this device':'Recovery saved as a new project')}catch(error){api.message(error.message)}finally{busy=false;refresh()}
 };
 latest.onclick=async()=>{
  const save=api.getSave();if(busy||!save?.record?.token||!window.confirm('Load the latest cloud version? Your local work will remain as a separate recovery copy on this device.'))return;
  busy=true;refresh();api.prepare();
  try{
   await api.leave();await save.cacheQueue;const old=structuredClone(save.record);
   await save.cache.put({...old,id:crypto.randomUUID(),token:null,roomToken:null,pendingToken:undefined,baseProject:undefined,deleted:false,dirty:true,project:{...api.snapshot(),name:(projectName(old.project.name)||'Project').slice(0,45)+' (recovery)'},updatedAt:Date.now()});
   save.dirty=false;save.blocked=null;save.record.dirty=false;await save.cacheCurrent();await save.load(old.id);
   if(save.record.roomToken)await api.getShared().connect(save.record.roomToken);api.opened();await render();api.message('Latest version loaded · local recovery kept');
  }catch(error){api.message(error.message,7000)}finally{busy=false;refresh()}
 };
 return{refresh,status(text){indicator.textContent=text;indicator.dataset.state=/conflict|offline|unavailable|deleted|inactive/i.test(text)?'warning':'synced';refresh()}};
}
