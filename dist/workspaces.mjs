import {download} from './io.mjs';
import {safeName,zipStore} from './pixel-core.mjs';
import {exportSpriteSheet,spriteSheetLayout} from './spritesheets.mjs';

// The editor owns state, history, revision checks and image decoding. This module
// only translates direct workspace interactions into those existing operations.
export function installWorkspaces(api){
 const $=id=>document.getElementById(id),app=$('app');
 let workspace='level',focused=null,pickingTerrain=false,busy=false,renderKey='',detailKey='',lastDetailSource=null,pendingRequestId=null;
 const assetSources=new Map(),previewCache=new Map();let previewEpoch=0,lastDetailDependencies=[];
 const state=()=>api.getState(),asset=()=>state().assets.find(a=>a.id===focused);
 const virtual=a=>a?.spriteSheet?.source==='assets';
 const rootAssets=()=>{const children=new Set(state().assets.flatMap(a=>(a.spriteSheet?.frames||[]).flatMap(f=>[f.sourceAssetId,f.artwork?.asset]).filter(Boolean)));return state().assets.filter(a=>!a.hidden&&!a.parentAssetId&&!children.has(a.id))};
 const references=()=>rootAssets().filter(a=>a.selectedForGeneration);
 function referenceLabel(a){const selection=a.referenceSelection;if(selection?.frameIds?.length)return `${a.name}: ${selection.frameIds.length} frames`;if(selection?.groupIds?.length)return `${a.name}: ${selection.groupIds.length} animations`;return `${a.name}: entire ${a.spriteSheet?.type==='character'?'character':'sheet'}`}
 function rasterSize(a){try{return a.spriteSheet?spriteSheetLayout(a,{},state().assets):{w:a.w,h:a.h}}catch{return{w:a.w,h:a.h,unavailable:true}}}
 function sourceImages(a){return [a.src,...(a.spriteSheet?.frames||[]).flatMap(f=>[f.sourceAssetId,f.artwork?.asset]).filter(Boolean).map(id=>state().assets.find(s=>s.id===id)?.src)]}
 function preview(a){if(a.src&&!a.spriteSheet)return Promise.resolve({src:a.src,w:a.w,h:a.h});const signature=JSON.stringify(a.spriteSheet),sources=sourceImages(a);let cached=previewCache.get(a.id);if(cached&&cached.signature===signature&&sources.every((src,i)=>src===cached.sources[i]))return cached.promise;cached={signature,sources,promise:exportSpriteSheet(a,{},state().assets)};previewCache.set(a.id,cached);cached.promise.catch(()=>{if(previewCache.get(a.id)===cached)previewCache.delete(a.id)});return cached.promise}
 function showPreview(img,a){const ticket=String(++previewEpoch);img.dataset.preview=ticket;img.alt='';img.hidden=!a.src||!!a.spriteSheet;if(a.src&&!a.spriteSheet){img.src=a.src;return}img.removeAttribute('src');img.parentElement?.classList.add('loading');void preview(a).then(output=>{if(img.dataset.preview!==ticket||!img.isConnected)return;img.src=output.src;img.hidden=false;img.parentElement?.classList.remove('loading')}).catch(error=>{if(img.dataset.preview===ticket&&img.isConnected){img.alt='Preview unavailable';img.parentElement?.classList.remove('loading');img.hidden=false;report(error)}})}
 const roleNames={platform:'Walkable',background:'Background',decoration:'Decoration'};
 const selectedIds=()=>references().map(a=>a.id);
 const tileSize=a=>Math.max(1,Math.min(512,Math.round(Number(a?.sheet?.tileSize)||16)));
 const scope=()=>api.getObjectIds?.();
 function report(error){api.message(error?.message||String(error))}
 async function perform(fn){if(busy)return;busy=true;refresh();try{return await fn()}catch(error){report(error)}finally{busy=false;renderKey='';detailKey='';refresh()}}
 async function change(fn){await api.mutate(fn);refresh()}
 async function updateAsset(id,fn){await change(s=>{const a=s.assets.find(a=>a.id===id);if(a)fn(a)})}
 function closeColor(){ $('block-color').hidden=true;$('sketch-color').setAttribute('aria-expanded','false') }
 function show(next){workspace=next==='assets'?'assets':'level';app.dataset.workspace=workspace;$('assets-workspace').hidden=workspace!=='assets';$('level-tab').setAttribute('aria-selected',String(workspace==='level'));$('assets-tab').setAttribute('aria-selected',String(workspace==='assets'));closeColor();for(const id of ['project','dimensions','context-menu','color-toolbar','brush-options'])$(id).hidden=true;api.setWorkspace?.(workspace);refresh()}
 $('level-tab').onclick=()=>show('level');$('assets-tab').onclick=()=>show('assets');
 $('workspace-tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();show(workspace==='level'?'assets':'level');$(workspace+'-tab').focus()};
 $('empty-import').onclick=()=>$('import-button').click();
 $('assets-undo').onclick=()=>perform(()=>api.undo());
 $('sketch-color').onclick=()=>{const open=$('block-color').hidden;$('block-color').hidden=!open;$('sketch-color').setAttribute('aria-expanded',String(open));$('color-toolbar').hidden=true};
 $('close-block-color').onclick=closeColor;
 for(const b of document.querySelectorAll('#semantic-colors button')){b.style.setProperty('--semantic-color',b.dataset.color);b.onclick=()=>{api.setRole(b.dataset.role,b.dataset.color);$('sketch-color').style.setProperty('--sketch-color',b.dataset.color);for(const other of document.querySelectorAll('#semantic-colors button'))other.setAttribute('aria-pressed',String(other===b));closeColor()}}
 $('canvas').addEventListener('pointerdown',closeColor,{passive:true});
 function updateImport(){const pieces=$('import-kind').value==='pieces';for(const el of document.querySelectorAll('.import-advanced'))el.hidden=!pieces;$('import-cell-size').closest('label').hidden=pieces}
 $('import-kind').onchange=updateImport;updateImport();
 $('prepare-artwork').onclick=()=>perform(async()=>{const result=await api.prepareArtwork({assetIds:selectedIds(),objectIds:scope()});pendingRequestId=result?.id||result?.request?.id||result?.requestId||api.getRequest?.()?.id;refresh()});
 $('apply-selected-sheets').onclick=()=>perform(async()=>{const ids=selectedIds();if(!ids.length){show('assets');api.message('Choose a sheet, then apply it to your sketch.');return}await api.applySelectedSheets({assetIds:ids,objectIds:scope()});api.message('Sheets applied · Undo to restore')});
 $('apply-artwork').onclick=()=>$('artwork-file').click();
 $('artwork-file').onchange=e=>{const file=e.target.files[0];e.target.value='';if(file)void perform(async()=>{await api.applyArtwork(file,pendingRequestId);api.message('Artwork applied · Layout preserved · Undo to restore')})};
 $('artwork-request').onchange=e=>{pendingRequestId=e.target.value;refresh()};
 $('restore-artwork').onclick=()=>perform(async()=>{await api.restoreArtwork({objectIds:scope()});api.message('Original sketch restored · Artwork sources retained')});
 $('close-sheet-detail').onclick=()=>{focused=null;pickingTerrain=false;detailKey='';refresh()};
 $('sheet-name').onchange=e=>{const a=asset(),name=e.target.value.trim()||'Asset sheet';if(a)void perform(()=>updateAsset(a.id,entry=>entry.name=name))};
 $('sheet-tile-size').onchange=e=>{const a=asset(),value=Math.round(Number(e.target.value));if(!a)return;if(!Number.isFinite(value)||value<1||value>512){e.target.value=tileSize(a);return}void perform(()=>updateAsset(a.id,entry=>{entry.sheet={...entry.sheet,tileSize:value};delete entry.sheet.terrain}))};
 $('sheet-role').onchange=e=>{const a=asset(),role=e.target.value;if(a)void perform(()=>updateAsset(a.id,entry=>{entry.sheet={...entry.sheet,tileSize:tileSize(entry),role};if(role!=='platform')delete entry.sheet.terrain}))};
 $('pick-terrain').onclick=()=>{pickingTerrain=!pickingTerrain;detailKey='';refresh()};
 $('clear-terrain').onclick=()=>{const a=asset();if(a)void perform(()=>updateAsset(a.id,entry=>{entry.sheet={...entry.sheet};delete entry.sheet.terrain}))};
 $('sheet-preview').onclick=e=>{const a=asset();if(!a||!pickingTerrain)return;const rect=e.currentTarget.getBoundingClientRect(),raster=rasterSize(a),size=tileSize(a),x=Math.floor((e.clientX-rect.left)/rect.width*raster.w/size)*size,y=Math.floor((e.clientY-rect.top)/rect.height*raster.h/size)*size;if(x+size*3>raster.w||y+size*3>raster.h){api.message('Choose the top-left tile of a complete 3 × 3 patch.');return}void perform(async()=>{await updateAsset(a.id,entry=>entry.sheet={...entry.sheet,tileSize:size,role:'platform',terrain:{x,y,tileSize:size}});pickingTerrain=false})};
 $('apply-sheet').onclick=()=>perform(async()=>{const a=asset();if(!a)return;await api.runTool('apply_asset_sheet',{assetId:a.id,objectIds:scope(),tileSize:tileSize(a)});show('level');api.message('Sheet applied · Undo to restore')});
 $('slice-sheet').onclick=()=>api.onGroupSheet?.();
 $('remove-sheet').onclick=()=>perform(async()=>{const a=asset();if(!a)return;if(assetInUse(a.id))throw Error('This image is used by the level or a collection. Ungroup or remove its artwork first.');await change(s=>{s.assets=s.assets.filter(entry=>entry.id!==a.id)});focused=null;api.message('Asset removed · Undo to restore')});
 function assetInUse(id){return state().objects.some(o=>JSON.stringify(o).includes(JSON.stringify(id)))||state().assets.some(a=>a.parentAssetId===id||a.id!==id&&a.spriteSheet?.frames?.some(f=>f.sourceAssetId===id||f.artwork?.asset===id))}
 async function groupAssets(fromCanvas=false){
  const ids=fromCanvas?scope():selectedIds();if(!ids?.length)throw Error(fromCanvas?'Select sprites on the level first.':'Choose assets using their reference circles.');
  const result=await api.runTool('group_workspace_sprites',fromCanvas?{objectIds:ids}:{assetIds:ids});
  const id=result.assetId||result.details?.assetId;if(id){focused=id;pickingTerrain=false;detailKey=''}
  api.message('Sprites grouped · Original images retained');
 }
 $('create-sheet').onclick=()=>perform(()=>groupAssets());
 $('group-canvas-selection').onclick=()=>perform(()=>groupAssets(true));
 $('ungroup-sheet').onclick=()=>perform(async()=>{const a=asset();if(!a)return;await api.runTool('ungroup_sprite_sheet',{assetId:a.id});focused=virtual(a)?null:a.id;api.message('Group released · Original images retained')});
 function pngBytes(a){return Uint8Array.from(atob(a.src.split(',')[1]),c=>c.charCodeAt(0))}
 async function exportAssets(assets){
  if(!assets.length)throw Error('Select at least one asset to export.');
  if(assets.length===1&&!assets[0].spriteSheet){const a=assets[0];download(new Blob([pngBytes(a)],{type:'image/png'}),safeName(a.name,'asset')+'.png');return}
  const entries=[],seen=new Set(),packed=[],renderedSheets=[];
  function include(a){
   if(seen.has(a.id))return;seen.add(a.id);const {src,...metadata}=a,entry={...metadata};
   if(src){entry.file=`sources/${safeName(a.id,'asset')}.png`;entries.push({name:entry.file,data:pngBytes(a)})}
   packed.push(entry);for(const frame of a.spriteSheet?.frames||[])for(const id of [frame.sourceAssetId,frame.artwork?.asset]){const source=state().assets.find(candidate=>candidate.id===id);if(source)include(source)}
  }
  for(const a of assets){include(a);if(a.spriteSheet){const output=await exportSpriteSheet(a,{},state().assets),file=`sheets/${safeName(a.id,'sheet')}-${safeName(a.name,'sheet')}.png`;entries.push({name:file,data:pngBytes(output)});renderedSheets.push({assetId:a.id,file,width:output.w,height:output.h})}}
  entries.unshift({name:'asset-pack.json',data:JSON.stringify({format:'pixel-mill-asset-pack',version:1,roots:assets.map(a=>a.id),assets:packed,renderedSheets},null,2)});
  download(zipStore(entries),assets.length===1?safeName(assets[0].name,'asset-pack')+'.zip':'asset-pack.zip');
 }
 $('export-sheet').onclick=()=>perform(()=>exportAssets(asset()?[asset()]:[]));$('export-sheets').onclick=()=>perform(()=>exportAssets(references()));

 function renderAssets(){
  const assets=rootAssets(),key=JSON.stringify(assets.map(a=>[a.id,a.name,a.w,a.h,a.sheet,a.spriteSheet,a.referenceSelection,a.selectedForGeneration]))+'|'+focused+'|'+busy;
  if(key===renderKey&&state().assets.every(a=>assetSources.get(a.id)===a.src))return;renderKey=key;assetSources.clear();for(const a of state().assets)assetSources.set(a.id,a.src);
  const fragment=document.createDocumentFragment();
  for(const a of assets){
   const card=document.createElement('article');card.className='sheet-card';card.setAttribute('role','listitem');card.dataset.focused=String(a.id===focused);card.dataset.assetId=a.id;
   const button=document.createElement('button');button.className='sheet-card-preview';button.title=`Edit ${a.name}`;button.setAttribute('aria-label',`Edit ${a.name}`);button.disabled=busy;
   const img=document.createElement('img');img.draggable=false;button.append(img);showPreview(img,a);button.onclick=()=>{focused=a.id;pickingTerrain=false;detailKey='';refresh()};
   const choice=document.createElement('button');choice.className='sheet-reference';choice.setAttribute('aria-label',`Include ${a.name} with sketch`);choice.setAttribute('aria-pressed',String(!!a.selectedForGeneration));choice.title=a.selectedForGeneration?referenceLabel(a):'Include with sketch';choice.textContent=a.selectedForGeneration?'✓':'+';choice.disabled=busy;choice.onclick=()=>perform(()=>updateAsset(a.id,entry=>entry.selectedForGeneration=!entry.selectedForGeneration));
   const name=document.createElement('span');name.className='sheet-card-name';name.textContent=a.name;const size=document.createElement('small');
   size.textContent=a.spriteSheet?`${a.spriteSheet.type==='character'?'Character':'Environment'} · ${a.spriteSheet.groups.length} groups · ${a.spriteSheet.frames.length} frames`:`${a.w} × ${a.h} · ${roleNames[a.sheet?.role]||'Asset'}`;
   card.append(button,choice,name,size);if(a.selectedForGeneration&&(a.referenceSelection?.frameIds?.length||a.referenceSelection?.groupIds?.length)){const label=document.createElement('span');label.className='sheet-card-scope';label.textContent=a.referenceSelection.frameIds?.length?`${a.referenceSelection.frameIds.length} frames included`:`${a.referenceSelection.groupIds.length} animations included`;card.append(label)}fragment.append(card);
  }
  $('sheet-grid').replaceChildren(fragment);$('sheet-empty').hidden=!!assets.length;$('assets-summary').textContent=`${assets.length} collection${assets.length===1?'':'s'} · ${references().length} included with sketch`;
  const scoped=references().filter(a=>a.referenceSelection?.frameIds?.length||a.referenceSelection?.groupIds?.length);$('reference-scope').hidden=!scoped.length;$('reference-scope').textContent=scoped.map(referenceLabel).join(' · ');
 }

 function renderDetail(){const a=asset();$('sheet-detail').hidden=!a;app.classList.toggle('sheet-detail-open',!!a);if(!a)return;const key=JSON.stringify([a.id,a.name,a.sheet,a.spriteSheet,a.referenceSelection,pickingTerrain,busy,assetInUse(a.id)]);const dependencies=sourceImages(a);if(key===detailKey&&lastDetailSource===a.src&&dependencies.length===lastDetailDependencies.length&&dependencies.every((source,i)=>source===lastDetailDependencies[i]))return;detailKey=key;lastDetailSource=a.src;lastDetailDependencies=dependencies;$('sheet-name').value=a.name;showPreview($('sheet-preview'),a);$('sheet-preview').alt=a.name;$('sheet-tile-size').value=tileSize(a);$('sheet-role').value=a.sheet?.role||'platform';const character=a.spriteSheet?.type==='character',collection=virtual(a);$('sheet-detail').classList.toggle('sheet-detail-character',character);$('sheet-preview-wrap').hidden=character;$('sheet-detail-note').hidden=character;$('ungroup-sheet').hidden=!a.spriteSheet;$('ungroup-sheet').disabled=busy||collection&&state().objects.some(o=>o.asset===a.id||o.artwork?.asset===a.id);$('slice-sheet').hidden=collection;$('sheet-detail').querySelector('.sheet-detail-controls').hidden=character;$('sheet-detail').querySelector('.sheet-terrain-controls').hidden=character;$('apply-sheet').hidden=character;$('slice-sheet').textContent=a.spriteSheet?'Regroup':'Group';const terrain=a.sheet?.terrain,size=tileSize(a),raster=rasterSize(a),canTerrain=!raster.unavailable&&raster.w>=size*3&&raster.h>=size*3&&(!a.sheet?.role||a.sheet.role==='platform');$('pick-terrain').disabled=busy||!canTerrain;$('pick-terrain').setAttribute('aria-pressed',String(pickingTerrain));$('clear-terrain').hidden=!terrain;$('sheet-preview-wrap').classList.toggle('picking-terrain',pickingTerrain);$('terrain-region').hidden=!terrain||character;if(terrain){const region=$('terrain-region');region.style.left=terrain.x/raster.w*100+'%';region.style.top=terrain.y/raster.h*100+'%';region.style.width=terrain.tileSize*3/raster.w*100+'%';region.style.height=terrain.tileSize*3/raster.h*100+'%'}$('sheet-detail-note').textContent=collection?'One collection; original image sources remain editable.':character?'Frames stay inside named animation groups.':pickingTerrain?'Tap the top-left tile of a 3 × 3 terrain patch.':terrain?'Edges, corners and fill follow the shape.':raster.w===size*3&&raster.h===size*3?'3 × 3 terrain: edges, corners and fill follow the shape.':'Repeat the first tile at its native size.';for(const id of ['sheet-name','sheet-tile-size','sheet-role','clear-terrain','apply-sheet','slice-sheet','export-sheet'])$(id).disabled=busy;$('slice-sheet').disabled=busy;$('remove-sheet').disabled=busy||assetInUse(a.id);$('remove-sheet').title=assetInUse(a.id)?'Used in the level':'Remove asset'}
 function refresh(){const assets=state().assets,refs=references(),ids=scope();for(const id of previewCache.keys())if(!assets.some(a=>a.id===id))previewCache.delete(id);if(focused&&!assets.some(a=>a.id===focused))focused=null;const scopedRefs=refs.filter(a=>a.referenceSelection?.frameIds?.length||a.referenceSelection?.groupIds?.length),refHint=$('handoff-references');refHint.hidden=!scopedRefs.length;refHint.textContent=scopedRefs.map(a=>a.referenceSelection.frameIds?.length?`${a.referenceSelection.frameIds.length} frames`:`${a.referenceSelection.groupIds.length} animations`).join(' · ');refHint.title=scopedRefs.map(referenceLabel).join(' · ');$('assets-undo').disabled=busy||$('undo').disabled;const count=$('reference-count');count.hidden=!refs.length;count.textContent=refs.length;$('treatment-scope').textContent=ids?.length?`${ids.length} shape${ids.length===1?'':'s'}`:'Whole level';$('treatment-scope').title=ids?.length?'Clear selection to treat the whole level':'Whole level';$('apply-selected-sheets').textContent=refs.length?`Use sheets · ${refs.length}`:'Use sheets';for(const id of ['prepare-artwork','apply-selected-sheets','apply-artwork','create-sheet','export-sheets'])$(id).disabled=busy;$('create-sheet').disabled=busy||!refs.length||refs.some(a=>a.spriteSheet);$('create-sheet').title=refs.some(a=>a.spriteSheet)?'Choose loose sprites to group, or export these sheets as an asset pack.':'Group selected sprites without copying their source images';const canvasSprites=ids?.filter(id=>state().objects.some(o=>o.id===id&&o.asset));$('group-canvas-selection').hidden=!canvasSprites?.length;$('group-canvas-selection').disabled=busy;$('export-sheets').disabled=busy||!refs.length;const requests=(state().artRequests||[]).filter(r=>r.status==='prepared');if(!requests.some(r=>r.id===pendingRequestId))pendingRequestId=requests.at(-1)?.id||null;const request=requests.find(r=>r.id===pendingRequestId)||api.getRequest?.();const select=$('artwork-request'),optionsKey=requests.map(r=>r.id).join('|');if(select.dataset.requests!==optionsKey){select.dataset.requests=optionsKey;select.replaceChildren(...requests.map((r,i)=>{const option=document.createElement('option');option.value=r.id;option.textContent=`Sketch ${i+1} · ${r.id.slice(-6)}`;return option}))}select.value=pendingRequestId||'';select.hidden=requests.length<2;select.disabled=busy;const treated=state().objects.some(o=>o.artwork&&(!ids||ids.includes(o.id)));$('restore-artwork').hidden=!treated;$('restore-artwork').disabled=busy;$('apply-artwork').disabled=busy||!request;$('apply-artwork').title=request?'Apply artwork returned for this sketch':'Prepare a ChatGPT request first';const role=api.getRole?.(),color=api.getColor?.();if(color)$('sketch-color').style.setProperty('--sketch-color',color);if(role)for(const b of document.querySelectorAll('#semantic-colors button'))b.setAttribute('aria-pressed',String(b.dataset.role===role));$('sketch-color').setAttribute('aria-expanded',String(!$('block-color').hidden));if(workspace==='assets'){renderAssets();renderDetail();api.onAssetsRefresh?.()}}
 show('level');
 return{refresh,show,focus:id=>{focused=id;pickingTerrain=false;detailKey='';show('assets')},tab:()=>workspace,getAssetId:()=>focused};
}
