import {exportSpriteSheet} from './spritesheets.mjs';
import {download} from './io.mjs';
import {safeName,zipStore} from './pixel-core.mjs';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
const button=(text,label,action)=>{const b=el('button','',text);b.type='button';b.title=label;b.setAttribute('aria-label',label);b.onclick=action;return b};
const bytes=src=>Uint8Array.from(atob(src.split(',')[1]),c=>c.charCodeAt(0));

// A sheet stays one asset. This workspace changes frame membership and source
// rectangles; it never turns animation frames into unrelated palette entries.
export function installSpriteWorkspace(api){
 const host=api.host||document.querySelector('#sprite-workspace');
 if(!host)return{refresh(){},openProposal(){},getSelection(){return null}};
 let assetId=null,signature=null,source=null,epoch=0,busy=false,proposalOpen=false;
 let selectedFrames=new Set(),selectedGroups=new Set(),lastFrame=null,editor,form,groupList,selectionBar,summary,scopeLabel;
 let expandedGroup=null,playingGroup=null,animationRequest=0,playStarted=0;
 const decodedImages=new Map(),sourceDependencies=new Map();
 const getAsset=()=>api.getState().assets.find(a=>a.id===api.getAssetId());
 const tell=text=>api.message?.(text);
 function handleError(error){tell(error?.message||String(error))}
 function getSelection(){const asset=getAsset();if(!asset)return null;const groups=asset.spriteSheet?.groups||[];return{assetId:asset.id,...(selectedFrames.size?{frameIds:groups.flatMap(group=>group.frameIds).filter(id=>selectedFrames.has(id))}:selectedGroups.size?{groupIds:groups.filter(group=>selectedGroups.has(group.id)).map(group=>group.id)}:expandedGroup?{groupIds:[expandedGroup]}:{})}}
 function scopedFrames(asset,selection=getSelection()){
  const sheet=asset.spriteSheet,selected=selection?.frameIds?new Set(selection.frameIds):selection?.groupIds?new Set(sheet.groups.filter(g=>selection.groupIds.includes(g.id)).flatMap(g=>g.frameIds)):null;
  return selected?sheet.groups.flatMap(g=>g.frameIds).filter(id=>selected.has(id)):sheet.groups.flatMap(g=>g.frameIds);
 }
 function clearSelection(){selectedFrames.clear();selectedGroups.clear();expandedGroup=null;lastFrame=null;render(getAsset())}
 function stopAnimation(){globalThis.cancelAnimationFrame?.(animationRequest);animationRequest=0;playingGroup=null;playStarted=0;for(const play of groupList?.querySelectorAll('[data-play-group]')||[]){const group=getAsset()?.spriteSheet?.groups.find(g=>g.id===play.dataset.playGroup);if(group){play.textContent='▶';play.setAttribute('aria-label',`Play ${group.name}`);play.setAttribute('aria-pressed','false')}}}
 function sourceFor(asset,frame){const rect=frame.artwork||frame,id=frame.artwork?.asset||frame.sourceAssetId||asset.id;return{source:api.getState().assets.find(a=>a.id===id)||asset,rect}}
 async function sourceImage(asset){let entry=decodedImages.get(asset.id);if(!entry||entry.src!==asset.src){const image=new Image();image.src=asset.src;entry={src:asset.src,promise:image.decode().then(()=>image)};decodedImages.set(asset.id,entry)}return entry.promise}
 async function drawFrame(canvas,asset,frame,group){
  const ctx=canvas.getContext('2d'),native=asset.spriteSheet.type==='environment'&&asset.spriteSheet.layout==='atlas',width=native?frame.w:asset.spriteSheet.cellWidth,height=native?frame.h:asset.spriteSheet.cellHeight;canvas.width=width;canvas.height=height;ctx.imageSmoothingEnabled=false;canvas.dataset.frameId=frame?.id||'';
  if(!frame||!frame.artwork&&!frame.sourceAssetId&&asset.spriteSheet.source==='assets')return;const {source,rect}=sourceFor(asset,frame),ticket=frame.id;try{const image=await sourceImage(source);if(!canvas.isConnected||canvas.dataset.frameId!==ticket)return;ctx.clearRect(0,0,width,height);ctx.drawImage(image,rect.x,rect.y,rect.w,rect.h,rect.offsetX??0,rect.offsetY??0,frame.artwork?(rect.targetW??width):rect.w,frame.artwork?(rect.targetH??height):rect.h);canvas.dataset.originX=String(group?.origin?.x??0);canvas.dataset.originY=String(group?.origin?.y??0)}catch(error){if(canvas.isConnected)handleError(error)}
 }
 function animateGroup(asset,group){
  globalThis.cancelAnimationFrame?.(animationRequest);playStarted=0;const frames=new Map(asset.spriteSheet.frames.map(f=>[f.id,f])),canvas=groupList.querySelector(`[data-animation-group="${CSS.escape(group.id)}"]`);if(!canvas)return;
  const tick=now=>{if(playingGroup!==group.id)return;if(!canvas.isConnected||host.closest('[hidden]')){stopAnimation();return}if(!playStarted)playStarted=now;const elapsed=Math.floor((now-playStarted)/1000*(group.fps||8)),count=group.frameIds.length;
   if(!count){stopAnimation();return}const index=group.loop===false?Math.min(elapsed,count-1):elapsed%count,frame=frames.get(group.frameIds[index]);if(canvas.dataset.frameId!==frame?.id)void drawFrame(canvas,asset,frame,group);
   if(group.loop===false&&elapsed>=count){stopAnimation();const play=groupList.querySelector(`[data-play-group="${CSS.escape(group.id)}"]`);if(play){play.textContent='▶';play.setAttribute('aria-label',`Play ${group.name}`);play.setAttribute('aria-pressed','false')}return}animationRequest=requestAnimationFrame(tick)};
  animationRequest=requestAnimationFrame(tick);
 }
 function playGroup(asset,group){if(playingGroup===group.id){stopAnimation();render(asset);return}stopAnimation();playingGroup=group.id;render(asset)}
 function chooseFrame(id,groupId,extend=false){
  const sheet=getAsset()?.spriteSheet;
  if(extend&&lastFrame?.groupId===groupId){const ids=sheet.groups.find(g=>g.id===groupId)?.frameIds||[],a=ids.indexOf(lastFrame.id),b=ids.indexOf(id);for(const frameId of ids.slice(Math.min(a,b),Math.max(a,b)+1))selectedFrames.add(frameId)}
  else if(selectedFrames.has(id))selectedFrames.delete(id);else selectedFrames.add(id);
  selectedGroups.clear();
  lastFrame={id,groupId};updateSelection();
 }
 function updateSelection(){
  if(!groupList)return;
  for(const b of groupList.querySelectorAll('[data-frame]'))b.setAttribute('aria-pressed',String(selectedFrames.has(b.dataset.frame)));
  for(const input of groupList.querySelectorAll('[data-group-check]'))input.checked=selectedGroups.has(input.dataset.groupCheck);
  selectionBar.hidden=!selectedFrames.size&&!selectedGroups.size;
  const count=selectionBar.querySelector('[data-selection-count]');count.textContent=selectedFrames.size?`${selectedFrames.size} frame${selectedFrames.size===1?'':'s'} selected`:`${selectedGroups.size} groups selected`;
  for(const b of selectionBar.querySelectorAll('[data-needs]'))b.disabled=b.dataset.needs==='frames'?!selectedFrames.size:b.dataset.needs==='groups'?selectedGroups.size<2:selectedFrames.size!==1;
  if(scopeLabel){const selection=getSelection(),groups=getAsset().spriteSheet.groups;scopeLabel.textContent=selection.frameIds?`${selection.frameIds.length} frame${selection.frameIds.length===1?'':'s'}`:selection.groupIds?.length===1?groups.find(g=>g.id===selection.groupIds[0])?.name||'Group':selection.groupIds?`${selection.groupIds.length} groups`:'Whole sheet'}
 }
 async function mutate(tool,args){
  if(busy)return false;
  busy=true;host.setAttribute('aria-busy','true');
  try{const result=await api.runTool(tool,{assetId:assetId,...args});if(result?.error)throw Error(result.error);signature=null;refresh();return true}catch(error){handleError(error);return false}finally{busy=false;host.removeAttribute('aria-busy')}
 }
 async function edit(operations){return mutate('edit_sprite_sheet',{operations})}
 function moveGroup(groupId,direction){const ids=getAsset().spriteSheet.groups.map(g=>g.id),index=ids.indexOf(groupId),target=index+direction;if(target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target],ids[index]];void edit([{type:'reorder_groups',groupIds:ids}])}
 function moveFrame(direction){
  if(selectedFrames.size!==1)return;const id=[...selectedFrames][0],group=getAsset().spriteSheet.groups.find(g=>g.frameIds.includes(id));if(!group)return;
  const ids=[...group.frameIds],index=ids.indexOf(id),target=index+direction;if(target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target],ids[index]];void edit([{type:'reorder_frames',groupId:group.id,frameIds:ids}]);
 }
 async function splitAtFrame(){
  if(selectedFrames.size!==1)return;const id=[...selectedFrames][0],group=getAsset().spriteSheet.groups.find(g=>g.frameIds.includes(id));if(!group)return;
  const at=group.frameIds.indexOf(id);if(at===0){tell('Select the first frame of the new group, after frame one.');return}await edit([{type:'split_group',groupId:group.id,at}]);
 }
 function selectField(label,key,options,value){const wrap=el('label','sprite-field'),input=el('select');input.name=key;input.setAttribute('aria-label',label);for(const [id,name]of options){const option=el('option','',name);option.value=id;input.append(option)}input.value=value;wrap.append(el('span','',label),input);return wrap}
 function renderOrganization(asset){
  const sheet=asset.spriteSheet;form=el('form','sprite-organize-form');
  const title=el('div','sprite-proposal-title','Organize');title.append(button('×','Close organization',()=>{proposalOpen=false;render(asset)}));form.append(title);
  const selectors=el('div','sprite-field-pair');selectors.append(selectField('Group','grouping',[['row','By row'],['column','By column'],['manual','Manual selection']],sheet.grouping),selectField('Sheet','sheetType',[['character','Character'],['environment','Environment']],sheet.type));form.append(selectors);
  form.append(el('p','sprite-note','Source bounds stay intact. Select frames or groups to merge or split them.'));
  const confirm=button('Update groups','Confirm sprite sheet grouping',()=>{});confirm.type='submit';confirm.className='primary';form.append(confirm);
  form.onsubmit=async event=>{event.preventDefault();const data=new FormData(form);confirm.disabled=true;const ok=await mutate('group_sprite_sheet',{grouping:data.get('grouping'),sheetType:data.get('sheetType')});if(ok){proposalOpen=false;selectedFrames.clear();selectedGroups.clear();expandedGroup=null;render(getAsset());tell('Grouping updated · Undo to restore')}else confirm.disabled=false};
  editor.append(form);
 }
 function frameButton(asset,frame,group){
  const b=button('',`${group.name}, frame ${group.frameIds.indexOf(frame.id)+1}${frame.empty?', empty':''}`,event=>chooseFrame(frame.id,group.id,event.shiftKey));
  b.className='sprite-frame';b.dataset.frame=frame.id;b.setAttribute('aria-pressed',String(selectedFrames.has(frame.id)));
  const preview=el('canvas','sprite-frame-image');preview.setAttribute('aria-hidden','true');b.append(preview);queueMicrotask(()=>void drawFrame(preview,asset,frame,group));
  const number=el('small','',String(group.frameIds.indexOf(frame.id)+1));b.append(number);if(frame.empty)b.classList.add('empty');return b;
 }
 function renderGroups(asset){
  const sheet=asset.spriteSheet,environment=sheet.type==='environment',frames=new Map(sheet.frames.map(f=>[f.id,f]));groupList=el('div','sprite-groups');
  sheet.groups.forEach((group,index)=>{
   const opened=expandedGroup===group.id,card=el('section','sprite-group'),head=el('div','sprite-group-head'),check=el('input');card.dataset.groupId=group.id;card.dataset.expanded=String(opened);check.type='checkbox';check.dataset.groupCheck=group.id;check.checked=selectedGroups.has(group.id);check.setAttribute('aria-label',`Select group ${group.name}`);check.onchange=()=>{selectedFrames.clear();check.checked?selectedGroups.add(group.id):selectedGroups.delete(group.id);updateSelection()};
   const stage=el('canvas','sprite-animation-preview');stage.dataset.animationGroup=group.id;stage.setAttribute('aria-label',`${group.name} animation preview`);const first=frames.get(group.frameIds[0]);queueMicrotask(()=>void drawFrame(stage,asset,first,group));
   const open=button('',opened?`Close ${group.name} frames`:`Open ${group.name} frames`,()=>{expandedGroup=opened?null:group.id;selectedGroups.clear();render(asset)});open.className='sprite-group-open';open.setAttribute('aria-expanded',String(opened));open.append(stage,el('span','',group.name),el('small','',`${group.frameIds.length} ${environment?'assets':'frames'}`));
   const play=button(playingGroup===group.id?'Ⅱ':'▶',`${playingGroup===group.id?'Pause':'Play'} ${group.name}`,()=>playGroup(asset,group));play.dataset.playGroup=group.id;play.setAttribute('aria-pressed',String(playingGroup===group.id));play.className='sprite-play';play.disabled=!group.frameIds.length;head.append(check,open);if(!environment)head.append(play);card.append(head);
   if(!opened){groupList.append(card);return}
   const settings=el('div','sprite-group-settings');
   const name=el('input');name.value=group.name;name.maxLength=80;name.setAttribute('aria-label',`Name of group ${index+1}`);name.onchange=()=>{const value=name.value.trim();if(value&&value!==group.name)void edit([{type:'rename_group',groupId:group.id,name:value}]);else name.value=group.name};
   const up=button('↑',`Move ${group.name} earlier`,()=>moveGroup(group.id,-1)),down=button('↓',`Move ${group.name} later`,()=>moveGroup(group.id,1));up.disabled=index===0;down.disabled=index===sheet.groups.length-1;settings.append(name,up,down);card.append(settings);
   const playback=el('div','sprite-playback-settings'),fpsLabel=el('label','','fps'),fps=el('input');fps.type='number';fps.min=1;fps.max=60;fps.value=group.fps||8;fps.setAttribute('aria-label',`${group.name} frames per second`);fps.onchange=()=>{if(fps.checkValidity())void edit([{type:'group_settings',groupId:group.id,fps:Number(fps.value)}])};fpsLabel.append(fps);
   const loopLabel=el('label','','Loop'),loop=el('input');loop.type='checkbox';loop.checked=group.loop!==false;loop.setAttribute('aria-label',`${group.name} loop animation`);loop.onchange=()=>void edit([{type:'group_settings',groupId:group.id,loop:loop.checked}]);loopLabel.append(loop);playback.append(fpsLabel,loopLabel);if(!environment)card.append(playback);
   const strip=el('div',environment?'sprite-frame-strip sprite-asset-grid':'sprite-frame-strip');strip.setAttribute('aria-label',`${group.name} frames`);for(const id of group.frameIds){const frame=frames.get(id);if(frame)strip.append(frameButton(asset,frame,group))}
   card.append(strip);groupList.append(card);
  });
  selectionBar=el('div','sprite-selection-tools');selectionBar.hidden=true;const count=el('span');count.dataset.selectionCount='';selectionBar.append(count);
  const actions=el('div','sprite-selection-actions');
  const group=button('Group','Make a group from selected frames',async()=>{const ok=await edit([{type:'group_frames',frameIds:[...selectedFrames]}]);if(ok){selectedFrames.clear();selectedGroups.clear();updateSelection()}});group.dataset.needs='frames';
  const merge=button('Merge','Merge selected groups',async()=>{const ids=sheet.groups.filter(g=>selectedGroups.has(g.id)).map(g=>g.id);const ok=await edit([{type:'merge_groups',groupIds:ids}]);if(ok){selectedGroups.clear();expandedGroup=ids[0];render(getAsset())}});merge.dataset.needs='groups';
  const split=button('Split here','Start a new group at selected frame',()=>void splitAtFrame());split.dataset.needs='one';
  const left=button('←','Move selected frame earlier',()=>moveFrame(-1)),right=button('→','Move selected frame later',()=>moveFrame(1));left.dataset.needs=right.dataset.needs='one';
  const clear=button('×','Clear frame and group selection',()=>{selectedFrames.clear();selectedGroups.clear();updateSelection()});actions.append(group,merge,split,left,right,clear);selectionBar.append(actions);editor.append(selectionBar,groupList);updateSelection();
  if(!sheet.groups.length)editor.append(el('p','sprite-note','Choose frames to make a group.'));
  if(playingGroup){const group=sheet.groups.find(g=>g.id===playingGroup);if(group)animateGroup(asset,group);else stopAnimation()}
 }
 async function exportSheet(mode){
  if(busy)return;const asset=getAsset();if(!asset?.spriteSheet)return;busy=true;
  try{
   tell('Preparing export…');const selection=getSelection(),{assetId,...scope}=selection,assets=api.getState().assets,frameIds=new Set(scopedFrames(asset,selection)),groups=asset.spriteSheet.groups.filter(g=>g.frameIds.some(id=>frameIds.has(id)));
   if(mode==='sheet'){const output=await exportSpriteSheet(asset,scope,assets);download(new Blob([bytes(output.src)],{type:'image/png'}),safeName(output.name||asset.name)+'.png')}
   else if(mode==='source'){if(!asset.src)throw Error('This collection retains its individual sources. Export strips or frames to include them.');download(new Blob([bytes(asset.src)],{type:'image/png'}),safeName(asset.name)+'-source.png')}
   else{
    const scoped=!!(scope.frameIds||scope.groupIds),exportMeta=scoped?{...asset.spriteSheet,preserveEmpty:false,frames:asset.spriteSheet.frames.filter(frame=>frameIds.has(frame.id)),groups:groups.map(group=>({...group,frameIds:group.frameIds.filter(id=>frameIds.has(id))}))}:asset.spriteSheet;
    const includedSources=new Set();if(asset.src)includedSources.add(asset.id);for(const frame of exportMeta.frames){if(frame.sourceAssetId)includedSources.add(frame.sourceAssetId);if(frame.artwork?.asset)includedSources.add(frame.artwork.asset)}
    const sourceFiles=[...includedSources].map(id=>({id,file:id===asset.id?'source.png':`sources/${safeName(id)}.png`}));
    const entries=[{name:'sprite-sheet.json',data:JSON.stringify({id:asset.id,name:asset.name,type:'sprite_sheet',...(asset.src?{sourceImage:'source.png'}:{}),sources:sourceFiles,selection:scope,width:asset.w,height:asset.h,spriteSheet:exportMeta},null,2)}];
    for(const record of sourceFiles){const sourceAsset=assets.find(a=>a.id===record.id);if(sourceAsset?.src)entries.push({name:record.file,data:bytes(sourceAsset.src)})}
    const list=mode==='strips'?groups:asset.spriteSheet.frames.filter(f=>frameIds.has(f.id));
    for(let i=0;i<list.length;i++){const part=list[i],output=await exportSpriteSheet(asset,mode==='strips'?{frameIds:part.frameIds.filter(id=>frameIds.has(id))}:{frameId:part.id},assets),name=mode==='strips'?part.name:`row-${String(part.row+1).padStart(2,'0')}-frame-${String(part.col+1).padStart(2,'0')}`;entries.push({name:`${mode}/${String(i+1).padStart(3,'0')}-${safeName(name)}.png`,data:bytes(output.src)})}
    download(zipStore(entries),safeName(asset.name)+'-'+mode+'.zip');
   }
   tell('Export ready');
  }catch(error){handleError(error)}finally{busy=false}
 }
 function render(asset){
  epoch++;globalThis.cancelAnimationFrame?.(animationRequest);host.replaceChildren();form=null;groupList=null;selectionBar=null;scopeLabel=null;if(!asset){host.style.removeProperty('--sprite-source');stopAnimation();return}
  editor=el('div','sprite-editor');host.append(editor);
  const sheet=asset.spriteSheet;
  if(!sheet){editor.append(el('p','sprite-note','Original image · no slicing applied'),button('Recognize sheet','Recognize sheet structure',async()=>{const ok=await mutate('group_sprite_sheet',{});if(ok&&!getAsset()?.spriteSheet)tell('Kept as one image. No repeated layout or separate assets found.')}));return}if(proposalOpen){renderOrganization(asset);return}
  summary=el('div','sprite-sheet-summary');const type=sheet.type==='character'?'Character sheet':'Environment sheet';summary.append(el('strong','',type),el('span','',`${sheet.groups.length} ${sheet.type==='character'?'animations':'sets'} · ${sheet.frames.length} ${sheet.type==='character'?'frames':'assets'}`));editor.append(summary);
  const scope=el('div','sprite-scope');scope.append(button('‹ Sheet','Select the whole sprite sheet',clearSelection));scopeLabel=el('output','','Whole sheet');scope.append(scopeLabel);editor.append(scope);
  const context=el('div','sprite-context-actions');
  context.append(button('Use as reference','Use current sprite selection as reference',async()=>{if(busy)return;busy=true;try{const selection=getSelection(),{assetId,...referenceSelection}=selection;await api.mutate(state=>{const a=state.assets.find(entry=>entry.id===assetId);a.selectedForGeneration=true;if(referenceSelection.frameIds||referenceSelection.groupIds)a.referenceSelection=referenceSelection;else delete a.referenceSelection});tell('Reference selected')}catch(error){handleError(error)}finally{busy=false;refresh()}}));
  const chat=button('ChatGPT ↗','Send current sprite selection to ChatGPT',async()=>{if(busy)return;busy=true;chat.disabled=true;try{await api.prepareAssetArtwork(getSelection())}catch(error){handleError(error)}finally{busy=false;chat.disabled=false;refresh()}});chat.disabled=!api.prepareAssetArtwork;context.append(chat);
  const file=el('input');file.type='file';file.accept='image/png';file.hidden=true;file.setAttribute('aria-label','Returned sprite artwork');file.onchange=async()=>{const uploaded=file.files[0];file.value='';if(!uploaded||busy)return;busy=true;try{await api.applyAssetArtwork(uploaded,getSelection());tell('Artwork applied to selection · Undo to restore')}catch(error){handleError(error)}finally{busy=false;refresh()}};
  const apply=button('Apply return','Apply returned artwork to current sprite selection',()=>file.click());apply.disabled=!api.applyAssetArtwork;context.append(apply,file);editor.append(context);
  const controls=el('div','sprite-sheet-controls');controls.append(button('Organize','Edit sheet grouping',()=>{proposalOpen=true;render(asset)}));
  const exportSelect=el('select');exportSelect.setAttribute('aria-label','Sprite export format');for(const [id,name]of [['sheet','Selection PNG'],['strips','Strips ZIP'],['frames','Frames ZIP'],...(asset.src?[['source','Original PNG']]:[])]){const option=el('option','',name);option.value=id;exportSelect.append(option)}controls.append(exportSelect,button('Export','Export sprite sheet artwork',()=>void exportSheet(exportSelect.value)));editor.append(controls);
  renderGroups(asset);
 }
 function refresh(){
  const asset=getAsset(),id=asset?.id||null,next=JSON.stringify([asset?.spriteSheet||null,asset?.referenceSelection,asset?.selectedForGeneration]);
  const allAssets=new Map(api.getState().assets.map(a=>[a.id,a])),dependencyIds=new Set((asset?.spriteSheet?.frames||[]).flatMap(frame=>[frame.sourceAssetId,frame.artwork?.asset].filter(Boolean))),dependenciesMatch=dependencyIds.size===sourceDependencies.size&&[...dependencyIds].every(id=>sourceDependencies.get(id)===allAssets.get(id)?.src);
  if(assetId===id&&signature===next&&source===asset?.src&&dependenciesMatch)return;
  if(assetId!==id){assetId=id;selectedFrames.clear();selectedGroups.clear();lastFrame=null;proposalOpen=false;expandedGroup=null;stopAnimation();decodedImages.clear();epoch++}
  sourceDependencies.clear();for(const id of dependencyIds)sourceDependencies.set(id,allAssets.get(id)?.src);
  signature=next;source=asset?.src;
  if(asset?.spriteSheet){const frameIds=new Set(asset.spriteSheet.frames.map(f=>f.id)),groupIds=new Set(asset.spriteSheet.groups.map(g=>g.id));selectedFrames=new Set([...selectedFrames].filter(id=>frameIds.has(id)));selectedGroups=new Set([...selectedGroups].filter(id=>groupIds.has(id)));if(expandedGroup&&!groupIds.has(expandedGroup))expandedGroup=null}
  render(asset);
 }
 refresh();
 return{refresh,getSelection,clearSelection,openProposal(){proposalOpen=true;const asset=getAsset();if(asset)render(asset)}};
}
