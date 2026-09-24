import {clamp,snap,screenToWorld,zoomAt,bounds,platforms,newPlayer,stepPlayer} from './engine.mjs';
import {applyObjectTransform,localToWorld,worldToLocal,objectBounds,pointBounds,anchorCamera,drawObject,resizeFromCorner,cropObject,resetCrop,snapObject} from './geometry.mjs';
import {agentTools,editProject,projectInfo,simulate,imageProject} from './agent.mjs';
import {SharedLevel} from './shared.mjs';
import {installPlayInput} from './play-input.mjs';
import {paintPixelLayer} from './pixel-view.mjs';
import {Autosave} from './autosave.mjs';
import {installChat} from './chat.mjs';
import {installAssetTray} from './asset-tray.mjs';
import {installNumberScrub} from './number-scrub.mjs';
import {installGestures} from './gestures.mjs';
import {uid,decode,importImages,snapshot,saveProject,readProject,exportProject} from './io.mjs';
import {hsbToHex} from './color.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const icons={chat:'M4 4h16v12H9l-5 4Z',menu:'M4 6h16M4 12h16M4 18h16',plus:'M12 4v16M4 12h16',cursor:'m5 3 14 10-7 1-3 7Z',hand:'M7 12V7a1.5 1.5 0 0 1 3 0v5-8a1.5 1.5 0 0 1 3 0v8-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v7c0 4-2 7-6 7h-1c-3 0-4-2-6-4l-3-4a1.5 1.5 0 0 1 2-2l2 2',block:'M4 4h16v16H4zM4 9h16',collision:'M3 17c5-11 8 9 13-2 1-3 3-4 5-4M4 21h16',eraser:'m3 15 9-11 9 8-7 8H8zM12 20h9',spawn:'M9 3h6v6H9zM6 12h12M12 9v7m0 0-5 5m5-5 5 5',play:'m8 4 12 8-12 8Z',stop:'M6 6h12v12H6z',undo:'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14',fit:'M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5',layers:'m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4',close:'m6 6 12 12M6 18 18 6',sliders:'M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6',copy:'M9 9h11v11H9zM5 15H3V3h12v2',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',left:'m15 5-7 7 7 7',right:'m9 5 7 7-7 7',jump:'M12 20V4m-6 6 6-6 6 6',restart:'M4 10a8 8 0 1 1 1 7M4 3v7h7'};
function icon(el,name){el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"></path></svg>`}
$$('[data-icon]').forEach(el=>icon(el,el.dataset.icon));
const app=$('#app'),canvas=$('#canvas'),ctx=canvas.getContext('2d',{alpha:false}),pixelBuffer=document.createElement('canvas');let paint=ctx,pixelView=true;
let state={name:'Untitled',spawn:{x:0,y:0},assets:[],objects:[]},camera={x:0,y:0,z:3,rotation:0},width=0,height=0,dpr=1;
let input=null,playControls=null,shared=null,autosave=null,localRevision=0;
let cropping=false,opacityBefore=null,numberScrub=null,scrubEdit=null,assetTray=null,assetRows=1,expandedAssetGroup=null;
let selected=null,tool='select',brush=null,grid=4,gesture=null,playing=false,player=null,colliders=[],editorCamera=null,importing=false;
let blockHSB={h:0,s:0,b:87},collisionWidth=8,maskWidth=12,maskEdit=null,adjustBefore=null,colorScope='selected',assetPress=null;
let history=[],future=[],images=new Map(),keys=new Set(),pointers=new Map(),touches=new Map(),hover=null,accumulator=0,lastTime=0;
function saveViewPrefs(){try{localStorage.setItem('pixel-mill-view',JSON.stringify({pixelView,grid,assetRows,blockHSB}))}catch{}}
try{const prefs=JSON.parse(localStorage.getItem('pixel-mill-view')||'{}');pixelView=prefs.pixelView!==false;if([1,4,8,16].includes(prefs.grid))grid=prefs.grid;if([1,2,4].includes(prefs.assetRows))assetRows=prefs.assetRows;$('#pixel-view').checked=pixelView;$('#grid').value=grid;const c=prefs.blockHSB;if(c&&Number.isInteger(c.h)&&c.h>=0&&c.h<=359&&Number.isInteger(c.s)&&c.s>=0&&c.s<=100&&Number.isInteger(c.b)&&c.b>=0&&c.b<=100)blockHSB=c}catch{}
function blockColor(){return hsbToHex(blockHSB.h,blockHSB.s,blockHSB.b)}
function updateBlockPicker(){for(const [key,id] of [['h','hue'],['s','saturation'],['b','brightness']])$('#block-'+id).value=blockHSB[key];$('#block-swatch').style.backgroundColor=blockColor();$('#block-swatch').value=blockColor();$('#block-hue').style.background='linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)';$('#block-saturation').style.background=`linear-gradient(90deg,${hsbToHex(blockHSB.h,0,blockHSB.b)},${hsbToHex(blockHSB.h,100,blockHSB.b)})`;$('#block-brightness').style.background=`linear-gradient(90deg,#000,${hsbToHex(blockHSB.h,blockHSB.s,100)})`}
updateBlockPicker();
for(const [key,id] of [['h','hue'],['s','saturation'],['b','brightness']])$('#block-'+id).oninput=e=>{blockHSB[key]=Number(e.target.value);updateBlockPicker();saveViewPrefs()};
$('#close-block-color').onclick=()=>$('#block-color').hidden=true;
const maxSheet=new Image();maxSheet.src='./assets/max.png';let maxReady=false;maxSheet.onload=()=>maxReady=true;maxSheet.onerror=()=>message('Max could not load. Reload to try again.');
function message(text,time=3500){const el=$('#status');el.textContent=text;el.hidden=false;clearTimeout(message.timer);if(time)message.timer=setTimeout(()=>el.hidden=true,time)}
function resize(){if(input?.active())input.cancel();const center=width?screenToWorld({x:width/2,y:height/2},camera):null;const v=window.visualViewport;app.style.width=(v?.width||window.innerWidth)+'px';app.style.height=(v?.height||window.innerHeight)+'px';const oldW=width,oldH=height;width=app.clientWidth;height=app.clientHeight;dpr=Math.min(window.devicePixelRatio||1,3);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);updateTray();if(!oldW){camera.x=-width/(2*camera.z);camera.y=-height/(2*camera.z)}else{anchorCamera(camera,center,{x:width/2,y:height/2})}}
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);resize();
// Keep browser gestures off the page. Only the canvas camera can pan or scale.
for(const event of ['gesturestart','gesturechange','gestureend'])document.addEventListener(event,e=>e.preventDefault(),{passive:false});
document.addEventListener('touchmove',e=>{if(!e.target.closest('#asset-items,.panel,dialog'))e.preventDefault()},{passive:false});
document.addEventListener('dblclick',e=>{if(!e.target.closest('input,select'))e.preventDefault()},{passive:false});
document.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)e.preventDefault()},{passive:false});
const current=()=>state.objects.find(o=>o.id===selected);
function checkpoint(before=snapshot(state)){localRevision++;queueMicrotask(()=>{shared?.push(before,snapshot(state));autosave?.changed()});history.push(before);if(history.length>40)history.shift();future=[];$('#undo').disabled=false}
function refresh(keepDimensions=false){const o=current();$('#inspector').hidden=playing||!o;if(!keepDimensions)$('#dimensions').hidden=true;if(o){$('#piece-name').value=o.name;$('#piece-kind').value=o.kind;$('#piece-w').value=o.w;$('#piece-h').value=o.h;$('#piece-inset').value=o.inset;$('#piece-inset').max=o.h-1;$('#piece-angle').value=Math.round(o.rotation||0);for(const id of ['piece-name','piece-kind','piece-w','piece-h','piece-inset','piece-angle','flip','duplicate','delete'])$('#'+id).disabled=!!o.locked}$('#project-name').value=state.name;$('#undo').disabled=shared?.connected?!shared.canUndo:!history.length;$('#assets-button').hidden=!state.assets.length;$('#coordinates').textContent=`${Math.round(camera.z*100)}%`;if(!adjustBefore)syncColorSliders()}
function colorTargets(){return colorScope==='all'||!current()?state.objects.filter(o=>!o.collisionOnly&&!o.locked):current().collisionOnly||current().locked?[]:[current()]}
function syncColorSliders(){const o=colorTargets()[0];for(const key of ['hue','saturation','brightness','black','white'])$('#color-'+key).value=o?.adjust?.[key]??(key==='white'?255:0);$('#color-scope').textContent=colorScope==='all'?'All':'Selected';$('#color-scope').setAttribute('aria-pressed',String(colorScope==='all'));for(const el of $$('#color-toolbar input'))el.disabled=!o}
$('#color-button').onclick=()=>{colorScope=current()?'selected':'all';$('#color-toolbar').hidden=!$('#color-toolbar').hidden;$('#color-button').setAttribute('aria-pressed',String(!$('#color-toolbar').hidden));syncColorSliders()};
$('#color-close').onclick=()=>{$('#color-toolbar').hidden=true;$('#color-button').setAttribute('aria-pressed','false')};
$('#color-scope').onclick=()=>{colorScope=colorScope==='selected'?'all':current()?'selected':'all';syncColorSliders()};
for(const key of ['hue','saturation','brightness','black','white']){const field=$('#color-'+key);field.oninput=e=>{const targets=colorTargets();if(!targets.length)return;if(!adjustBefore)adjustBefore=snapshot(state);const value=Number(e.target.value);for(const o of targets){o.adjust={hue:0,saturation:0,brightness:0,black:0,white:255,...o.adjust,[key]:value};if(o.adjust.white<=o.adjust.black){if(key==='black')o.adjust.white=Math.min(255,value+1);else o.adjust.black=Math.max(0,value-1)}}};field.onchange=()=>{if(adjustBefore){if(JSON.stringify(adjustBefore)!==JSON.stringify(snapshot(state)))checkpoint(adjustBefore);adjustBefore=null}syncColorSliders()}}
$('#color-reset').onclick=()=>{const targets=colorTargets();if(!targets.some(o=>o.adjust))return;const before=snapshot(state);for(const o of targets)delete o.adjust;checkpoint(before);syncColorSliders()};
function setTool(next){if(input?.active())input.cancel();cropping=false;$('#context-menu').hidden=true;$('#block-color').hidden=next!=='block'||tool==='block'&&!$('#block-color').hidden;tool=next;$('#brush-options').hidden=!['mask','collision'].includes(next);if(!$('#brush-options').hidden){$('#brush-size').value=next==='mask'?maskWidth:collisionWidth;$('#brush-value').textContent=$('#brush-size').value+' px'}brush=next==='stamp'?brush:null;if(next!=='mask')selected=null;$$('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===next)));$('#hint').textContent=next==='block'?'Drag a platform':next==='collision'?'Paint collision · hidden in game':next==='mask'?'Draw over pixels to erase · select an asset first':next==='spawn'?'Tap to place Max':next==='stamp'?'Tap to place · Esc to select':'';canvas.style.cursor=next==='pan'?'grab':next==='select'?'default':'crosshair';refresh();renderPalette()}
$$('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));$('#brush-size').oninput=e=>{const value=Number(e.target.value);if(tool==='mask')maskWidth=value;else collisionWidth=value;$('#brush-value').textContent=value+' px'};
async function cacheAssets(assets){await Promise.all(assets.map(async a=>{if(!images.has(a.id))images.set(a.id,await decode(a.src))}))}
function trayHeight(rows){const size=height<500&&width>height?48:66;return Math.min(28+rows*(size+6),Math.max(94,height-132))}
function updateTray(preview){const el=$('#assets'),visible=!el.hidden,h=preview??trayHeight(assetRows);el.style.height=h+'px';el.style.setProperty('--asset-rows',String(assetRows));app.style.setProperty('--tray',visible?(h+12)+'px':'0px');$('#tray-handle').setAttribute('aria-valuenow',String(assetRows));$('#tray-handle').setAttribute('aria-valuetext',assetRows+' rows')}
function showAssets(show){$('#assets').hidden=!show;updateTray();$('#assets-button').setAttribute('aria-pressed',String(show))}
assetTray=installAssetTray($('#tray-handle'),{rows:()=>assetRows,height:trayHeight,preview:updateTray,setRows:n=>{assetRows=n;updateTray();saveViewPrefs()}});
function renderPalette(){
 const fragment=document.createDocumentFragment(),groups=new Map();
 for(const asset of state.assets){const match=asset.name.match(/^(.*?)[-_ ](?:frame[-_ ]?)?(\d{2,})$/i),key=match?.[1]||null;if(key){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(asset)}}
 const shown=new Set();
 function item(a){const b=document.createElement('button');b.title=a.name;b.setAttribute('aria-label',`Place ${a.name}; hold for actions`);b.setAttribute('aria-pressed',String(brush===a.id));const img=document.createElement('img');img.src=a.src;img.alt='';img.draggable=false;b.append(img);let held=false,start=null,timer=null;b.onpointerdown=e=>{held=false;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{held=true;assetPress=a.id;$('#asset-action-name').textContent=a.name;$('#delete-asset').textContent=state.objects.some(o=>o.asset===a.id)?'Delete asset and placed copies':'Delete asset';$('#asset-actions').hidden=false},500)};b.onpointermove=e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>9)clearTimeout(timer)};b.onpointerup=b.onpointercancel=()=>{clearTimeout(timer);start=null};b.onclick=()=>{if(held){held=false;return}$('#asset-actions').hidden=true;brush=a.id;setTool('stamp');showAssets(true)};return b}
 if(expandedAssetGroup&&groups.get(expandedAssetGroup)?.length>=3){const back=document.createElement('button');back.className='asset-group-back';back.textContent='‹';back.title='All assets';back.setAttribute('aria-label','Back to all assets');back.onclick=()=>{expandedAssetGroup=null;renderPalette()};fragment.append(back);for(const a of groups.get(expandedAssetGroup))fragment.append(item(a))}
 else{expandedAssetGroup=null;for(const a of state.assets){const match=a.name.match(/^(.*?)[-_ ](?:frame[-_ ]?)?(\d{2,})$/i),key=match?.[1],series=groups.get(key);if(series?.length>=3){if(shown.has(key))continue;shown.add(key);const sample=series.reduce((best,entry)=>entry.w*entry.h>best.w*best.h?entry:best);const button=document.createElement('button');button.className='asset-group';button.title=key+' · '+series.length+' frames';button.setAttribute('aria-label',`Open ${key}, ${series.length} frames`);const img=document.createElement('img');img.src=sample.src;img.alt='';button.append(img);const count=document.createElement('span');count.textContent=series.length;button.append(count);button.onclick=()=>{expandedAssetGroup=key;renderPalette()};fragment.append(button)}else fragment.append(item(a))}}
 $('#asset-items').replaceChildren(fragment);
}
$('#assets-button').onclick=()=>showAssets($('#assets').hidden);$('#close-assets').onclick=()=>showAssets(false);
$('#clear-assets').onclick=()=>{if(!state.assets.length)return;checkpoint();state.objects=state.objects.filter(o=>!o.asset);state.assets=[];images.clear();brush=null;selected=null;expandedAssetGroup=null;$('#asset-actions').hidden=true;renderPalette();showAssets(false);refresh();message('Asset library cleared · Undo to restore')};
$('#delete-asset').onclick=()=>{if(!assetPress)return;checkpoint();state.assets=state.assets.filter(a=>a.id!==assetPress);state.objects=state.objects.filter(o=>o.asset!==assetPress);images.delete(assetPress);if(brush===assetPress)brush=null;if(!current())selected=null;assetPress=null;$('#asset-actions').hidden=true;renderPalette();refresh()};
function panel(id){const el=$(id),show=el.hidden;for(const p of ['#project','#dimensions','#help'])$(p).hidden=true;el.hidden=!show}
$('#menu-button').onclick=()=>panel('#project');$('#piece-options').onclick=()=>panel('#dimensions');$('#help-button').onclick=()=>panel('#help');$('#close-help').onclick=()=>$('#help').hidden=true;
function changePiece(fn,allowLocked=false){cancelGesture();const o=current();if(!o||o.locked&&!allowLocked)return;checkpoint();fn(o);refresh()}
$('#piece-name').onchange=e=>changePiece(o=>{o.name=e.target.value.trim()||'Piece';const asset=state.assets.find(a=>a.id===o.asset);if(asset){asset.name=o.name;renderPalette()}});$('#piece-kind').onchange=e=>changePiece(o=>o.kind=e.target.value);
function numericPiece(o,k,value){if(!Number.isFinite(value))return;if(k==='inset')o.inset=clamp(value,0,o.h-1);else if(k==='angle')o.rotation=Math.round(clamp(value,-180,180)/5)*5;else{const scale=clamp(value/o[k],Math.max(1/o.w,1/o.h),Math.min(8192/o.w,8192/o.h));resizeFromCorner(o,o.w*scale,o.h*scale)}}
for(const k of ['w','h','inset','angle'])$('#piece-'+k).onchange=e=>{changePiece(o=>numericPiece(o,k,Number(e.target.value)));$('#dimensions').hidden=false};
numberScrub=installNumberScrub($$('input[type="number"]'),{
 start:field=>{cancelGesture();if(field.id.startsWith('piece-')){const o=current();if(!o||o.locked)return false;scrubEdit={before:snapshot(state),object:o,original:{...o},key:field.id.slice(6)}}},
 preview:(field,value)=>{if(!scrubEdit)return value;const {object,original,key}=scrubEdit;Object.assign(object,original);numericPiece(object,key,value);refresh(true);return key==='angle'?object.rotation:object[key]},
 commit:()=>{if(scrubEdit){const {before,object}=scrubEdit;snapObject(object,1);scrubEdit=null;if(JSON.stringify(before)!==JSON.stringify(snapshot(state)))checkpoint(before);refresh(true)}},
 cancel:()=>{if(scrubEdit){Object.assign(scrubEdit.object,scrubEdit.original);scrubEdit=null;refresh(true)}}
});
$('#flip').onclick=()=>changePiece(o=>o.flip=!o.flip);
function duplicate(){cancelGesture();const o=current();if(!o||o.locked)return;checkpoint();const copy={...o,id:uid(),x:o.x+grid*2,y:o.y+grid*2};state.objects.push(copy);selected=copy.id;refresh()}
function remove(){cancelGesture();if(!current()||current().locked)return;checkpoint();state.objects=state.objects.filter(o=>o.id!==selected);selected=null;refresh()}
$('#duplicate').onclick=duplicate;$('#delete').onclick=remove;
async function restore(project){state={...project,assets:project.assets.map(a=>({...a})),objects:project.objects.map(o=>({...o})),spawn:{...project.spawn}};selected=null;brush=null;await cacheAssets(state.assets);setTool('select');refresh();renderPalette();showAssets(!$('#assets').hidden&&state.assets.length>0)}
async function undo(redo=false){if(playing||importing)return;if(shared?.connected){if(redo)return;try{await shared.queue;await shared.tool('undo_level',{revision:shared.revision})}catch(e){message(e.message)}return}const from=redo?future:history,to=redo?history:future;if(!from.length)return;to.push(snapshot(state));await restore(from.pop());localRevision++;autosave?.changed()}
$('#undo').onclick=()=>undo();
$('#project-name').onchange=e=>{checkpoint();state.name=e.target.value.trim()||'Untitled';refresh()};$('#grid').onchange=e=>{grid=Number(e.target.value);saveViewPrefs()};$('#pixel-view').onchange=e=>{pixelView=e.target.checked;saveViewPrefs()};
function fit(){if(input?.active())input.cancel();camera.rotation=0;const b=bounds(state.objects,state.spawn),pad=width<680?80:65;camera.z=clamp(Math.min((width-2*pad)/Math.max(80,b.w),(height-2*pad)/Math.max(80,b.h)),.25,5);camera.x=b.x+b.w/2-width/(2*camera.z);camera.y=b.y+b.h/2-height/(2*camera.z);refresh()}
$('#fit').onclick=fit;
function exportBusy(fn){if(importing){message('Finish importing first.');return}return fn()}
$('#save').onclick=()=>exportBusy(()=>{saveProject(state);$('#project').hidden=true});
$('#load').onclick=()=>exportBusy(()=>$('#project-file').click());
$('#project-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const project=await readProject(file);await beginProject(project);$('#project').hidden=true;message('Opened')}catch(error){message(error.message)}};
$('#export').onclick=()=>exportBusy(async()=>{try{message('Exporting…',0);await exportProject(state,images);$('#project').hidden=true;message('ZIP ready')}catch(error){message(error.message)}});
$('#scale-level').onclick=()=>{if(playing)return;cancelGesture();const factor=.75,before=snapshot(state);for(const o of state.objects){o.x*=factor;o.y*=factor;o.w=Math.max(1,o.w*factor);o.h=Math.max(1,o.h*factor);o.inset=Math.min(o.h-1,(o.inset||0)*factor);if(o.collisionOnly){o.points=o.points.map(p=>({x:p.x*factor,y:p.y*factor}));o.brushWidth=Math.max(1,o.brushWidth*factor)}}state.spawn.x*=factor;state.spawn.y*=factor;checkpoint(before);$('#project').hidden=true;fit();refresh();message('Level scaled to 75%')};
$('#clear').onclick=()=>exportBusy(async()=>{await beginProject({format:'max-level-studio',version:1,name:'Untitled',spawn:{x:0,y:0},assets:[],objects:[]});showAssets(false);$('#project').hidden=true});
$('#import-button').onclick=()=>{if(importing)return;$('#project').hidden=true;$('#files').click()};$('#import-options').onclick=()=>{$('#project').hidden=true;$('#import-dialog').showModal()};$('#close-import').onclick=()=>$('#import-dialog').close();
$('#import-form').onsubmit=e=>{e.preventDefault();$('#files').click()};
async function addFiles(files){if(importing||!files.length)return;importing=true;$('#import-dialog').close();$('#import-button').disabled=true;try{const options={remove:$('#background').value==='auto',scale:Number($('#scale').value),tolerance:clamp(Number($('#tolerance').value)||0,0,100),minArea:clamp(Number($('#min-area').value)||1,1,1000),split:$('#split').checked};const result=await importImages([...files],options,t=>message(t,0));if(state.assets.length+result.assets.length>2000)throw Error('The palette is full. Open a new level.');await cacheAssets(result.assets);if(result.assets.length){checkpoint();state.assets.push(...result.assets);renderPalette();showAssets(true);refresh()}message(result.failed.length?result.failed.join(' · '):`${result.assets.length} pieces` ,result.failed.length?7000:2500)}catch(error){message(error.message)}finally{importing=false;$('#import-button').disabled=false}}
$('#files').onchange=e=>{const files=[...e.target.files];e.target.value='';void addFiles(files)};
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();void addFiles(e.dataTransfer.files)});document.addEventListener('paste',e=>{if(e.target.closest('input,textarea'))return;const files=[...e.clipboardData.items].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();void addFiles(files)}});
function place(assetId,x,y){const a=state.assets.find(a=>a.id===assetId);if(!a)throw Error('Choose an image from the palette.');checkpoint();const o={id:uid(),asset:a.id,name:a.name,x:snap(x,grid),y:snap(y,grid),w:a.w,h:a.h,kind:'platform',inset:0,flip:false,rotation:0,locked:false,opacity:1,crop:null};state.objects.push(o);setTool('select');selected=o.id;refresh();return o}
function addBlock(x,y,w,h){checkpoint();const o={id:uid(),asset:null,name:'Block',x:snap(x,grid),y:snap(y,grid),w:Math.max(grid,snap(w,grid)),h:Math.max(grid,snap(h,grid)),kind:'solid',inset:0,flip:false,rotation:0,locked:false,opacity:1,crop:null,color:blockColor()};state.objects.push(o);setTool('select');selected=o.id;refresh();return o}
function addCollision(points){if(!points.length)return;const r=collisionWidth/2,x=Math.max(-100000,Math.min(...points.map(p=>p.x))-r),y=Math.max(-100000,Math.min(...points.map(p=>p.y))-r),w=Math.min(8192,Math.max(...points.map(p=>p.x))+r-x),h=Math.min(8192,Math.max(...points.map(p=>p.y))+r-y);if(w<=0||h<=0){message('Collision stroke is outside the level.');return}checkpoint();const o={id:uid(),asset:null,name:'Invisible collision',x,y,w,h,kind:'solid',inset:0,rotation:0,flip:false,locked:false,opacity:1,crop:null,collisionOnly:true,brushWidth:collisionWidth,points:points.map(p=>({x:clamp(p.x-x,0,w),y:clamp(p.y-y,0,h)}))};state.objects.push(o);selected=o.id;refresh()}
function beginMask(o){const a=state.assets.find(a=>a.id===o.asset),img=images.get(a?.id);if(!a||!img)return false;const c=document.createElement('canvas');c.width=a.w;c.height=a.h;c.getContext('2d').drawImage(img,0,0);maskEdit={object:o,asset:a,originalImage:img,canvas:c,copyId:uid(),changed:false};return true}
function paintMask(a,b){const m=maskEdit;if(!m)return;const o=m.object,crop=o.crop||{x:0,y:0,w:1,h:1},map=p=>{const q=worldToLocal(p,o);return{x:(crop.x+(o.flip?1-q.x/o.w:q.x/o.w)*crop.w)*m.asset.w,y:(crop.y+q.y/o.h*crop.h)*m.asset.h}},p=map(a),q=map(b),c=m.canvas.getContext('2d');c.save();c.globalCompositeOperation='destination-out';c.strokeStyle='#000';c.fillStyle='#000';c.lineWidth=maskWidth*m.asset.w/o.w;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();c.beginPath();c.arc(q.x,q.y,c.lineWidth/2,0,2*Math.PI);c.fill();c.restore();m.changed=true;images.set(m.copyId,m.canvas);m.object.asset=m.copyId}
function cancelMask(){const m=maskEdit;if(!m)return;m.object.asset=m.asset.id;images.delete(m.copyId);maskEdit=null}
function finishMask(before){const m=maskEdit;if(!m)return;if(m.changed){const asset={...m.asset,id:m.copyId,name:m.asset.name+' edit',src:m.canvas.toDataURL('image/png')};state.assets.push(asset);if(m.asset.name.endsWith(' edit')&&!state.objects.some(o=>o.asset===m.asset.id))state.assets=state.assets.filter(a=>a.id!==m.asset.id);checkpoint(before);renderPalette();selected=m.object.id;refresh()}else cancelMask();maskEdit=null}
function openContext(id,p){selected=id;cropping=false;const o=current();if(!o)return;refresh();const menu=$('#context-menu');$('#lock-piece').textContent=o.locked?'Unlock':'Lock';$('#piece-opacity').value=Math.round((o.opacity??1)*100);$('#piece-opacity').disabled=!!o.locked;$('#crop-piece').disabled=!o.asset||!!o.locked;$('#reset-crop').hidden=!o.crop;$('#reset-crop').disabled=!!o.locked;$$('[data-order]').forEach(b=>b.disabled=!!o.locked);menu.hidden=false;menu.style.left=clamp(p.x,8,width-184)+'px';menu.style.top=clamp(p.y,64,height-(menu.offsetHeight||260)-12)+'px';}
$('#lock-piece').onclick=()=>{changePiece(o=>o.locked=!o.locked,true);$('#context-menu').hidden=true};
function reorder(action){if(current()?.locked)return;const index=state.objects.findIndex(o=>o.id===selected);if(index<0)return;const target=action==='front'?state.objects.length-1:action==='back'?0:clamp(index+(action==='forward'?1:-1),0,state.objects.length-1);if(index===target)return;checkpoint();const [o]=state.objects.splice(index,1);state.objects.splice(target,0,o);$('#context-menu').hidden=true;refresh()}
$$('[data-order]').forEach(button=>button.onclick=()=>reorder(button.dataset.order));
$('#piece-opacity').oninput=e=>{const o=current();if(!o||o.locked)return;if(!opacityBefore)opacityBefore=snapshot(state);o.opacity=clamp(Number(e.target.value)/100,0,1)};
$('#piece-opacity').onchange=()=>{if(opacityBefore){checkpoint(opacityBefore);opacityBefore=null}refresh()};
$('#crop-piece').onclick=()=>{const o=current();if(!o?.asset||o.locked)return;const id=o.id;setTool('select');selected=id;cropping=true;$('#hint').textContent='Drag crop · Esc to cancel';$('#context-menu').hidden=true;refresh()};
$('#reset-crop').onclick=()=>{try{changePiece(o=>resetCrop(o));$('#context-menu').hidden=true}catch(error){message(error.message)}};
$('#erase-piece').onclick=()=>{const id=selected;setTool('mask');selected=id;$('#context-menu').hidden=true;refresh()};
function cropSelected(rect){const o=current();if(!o||rect.w<1||rect.h<1)return;const before=snapshot(state);try{cropObject(o,rect);checkpoint(before);cropping=false;$('#hint').textContent='';refresh()}catch(error){message(error.message)}}
function cancelGesture(){if(input?.active())input.cancel()}
input=installGestures(canvas,{
 get:()=>({state,camera,tool,grid,playing,keys,selected:current(),crop:cropping}),
 snapshot:()=>snapshot(state),rollback:before=>{state.objects=before.objects;state.spawn=before.spawn},
 preview:g=>gesture=g,hover:p=>hover=p,select:id=>selected=id,
 closePanels:()=>{for(const p of ['#project','#help','#dimensions','#context-menu'])$(p).hidden=true},
 refresh,viewChanged:()=>$('#coordinates').textContent=`${Math.round(camera.z*100)}%`,
 context:openContext,crop:cropSelected,commit:checkpoint,addBlock,addCollision,beginMask,paintMask,cancelMask,finishMask,noMask:()=>message('Select an imported image to erase.'),place:(x,y)=>place(brush,x,y)
},pointers);
function resetInput(){keys.clear();playControls?.reset();touches.clear();$$('[data-control]').forEach(b=>b.setAttribute('aria-pressed','false'));accumulator=0;lastTime=0}
function restart(){resetInput();player=newPlayer(state.spawn);camera.x=player.x-width/(2*camera.z);camera.y=player.y-height*.6/camera.z}
function togglePlay(){if(!playing&&!maxReady){message('Max is still loading.');return}playing=!playing;cancelGesture();pointers.clear();resetInput();app.classList.toggle('playing',playing);$('#play').setAttribute('aria-label',playing?'Stop playing':'Play level');$('#play').title=playing?'Edit (Esc)':'Play (Enter)';icon($('#play'),playing?'stop':'play');for(const id of ['#project','#help','#dimensions'])$(id).hidden=true;if(playing){editorCamera={...camera};colliders=platforms(state.objects);camera.z=clamp(Math.round(Math.min(width,height)/155),2,5);camera.rotation=0;restart();showAssets(false);$('#hint').textContent=''}else{camera={...editorCamera};player=null;setTool('select')}refresh()}
$('#play').onclick=togglePlay;$('#exit-play').onclick=()=>{if(playing)togglePlay()};
playControls=installPlayInput(canvas,{playing:()=>playing,exit:()=>{if(playing)togglePlay()}});
function interrupt(){assetTray?.cancel();numberScrub?.cancel();cancelGesture();resetInput();void autosave?.flush()}
window.addEventListener('blur',interrupt);window.addEventListener('pagehide',interrupt);document.addEventListener('visibilitychange',interrupt);
window.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea')||$('#import-dialog').open||$('#agent-dialog').open)return;const code=e.code;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Enter','Delete','Backspace'].includes(code)||e.metaKey||e.ctrlKey)e.preventDefault();if(e.repeat){keys.add(code);return}keys.add(code);if(code==='Escape'){if(playing)togglePlay();else{setTool('select');for(const p of ['#project','#help','#dimensions'])$(p).hidden=true}return}if(code==='Enter'){togglePlay();return}if(playing){if(['KeyK','KeyX'].includes(code))playControls.dodge=player.face;return}if((e.metaKey||e.ctrlKey)&&code==='KeyS')saveProject(state);else if((e.metaKey||e.ctrlKey)&&code==='KeyZ')void undo(e.shiftKey);else if((e.metaKey||e.ctrlKey)&&code==='KeyD')duplicate();else if(code==='Delete'||code==='Backspace')remove();else if(code==='KeyV')setTool('select');else if(code==='KeyH')setTool('pan');else if(code==='KeyB')setTool('block');else if(code==='KeyM')setTool('spawn');else if(code==='KeyF')fit()});
window.addEventListener('keyup',e=>keys.delete(e.code));
function drawCollision(points,width){if(!points?.length)return;paint.save();paint.strokeStyle='#ff6538';paint.fillStyle='#ff6538';paint.globalAlpha=.68;paint.lineCap='round';paint.lineJoin='round';paint.lineWidth=width;paint.beginPath();paint.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))paint.lineTo(p.x,p.y);paint.stroke();if(points.length===1){paint.beginPath();paint.arc(points[0].x,points[0].y,width/2,0,Math.PI*2);paint.fill()}paint.restore()}
function drawPiece(o,alpha=1){if(o.collisionOnly){if(!playing)drawCollision(o.points.map(p=>({x:o.x+p.x,y:o.y+p.y})),o.brushWidth);return}drawObject(paint,o,images.get(o.asset),{alpha,fill:playing?'#ddd':'#242424',stroke:'#888',lineWidth:1/camera.z})}
const anims={idle:[0,[0,1,2,3,4,5,6,7],6.5],walk:[1,[0,1,2,3,4,5,6,7],9],run:[2,[0,1,2,3,4,5,6],14],rise:[4,[1,2,3],9],fall:[4,[4,5],5]};
function drawMax(p){if(!maxReady)return;const [row,frames,fps]=anims[p.anim||'idle'],n=Math.floor((p.clock||0)*fps),frame=frames[p.anim==='rise'||p.anim==='fall'?Math.min(frames.length-1,n):n%frames.length];const x=Math.round(p.x)-16,y=Math.round(p.y)-31;paint.save();paint.translate(x+(p.face<0?32:0),y);if(p.face<0)paint.scale(-1,1);paint.drawImage(maxSheet,frame*32,row*32,32,32,0,0,32,32);paint.restore()}
function drawArtwork(context,view,now){paint=context;for(const o of state.objects){const b=objectBounds(o);if(b.x+b.w<view.x||b.x>view.x+view.w||b.y+b.h<view.y||b.y>view.y+view.h)continue;drawPiece(o)}if(!playing){if(tool==='stamp'&&hover&&!pointers.size){const a=state.assets.find(a=>a.id===brush);if(a)drawPiece({asset:a.id,x:snap(hover.x,grid),y:snap(hover.y,grid),w:a.w,h:a.h},.4)}drawMax({...state.spawn,face:1,anim:'idle',clock:now/1000})}else drawMax(player);paint=ctx}
function render(now){requestAnimationFrame(render);const elapsed=lastTime?Math.min((now-lastTime)/1000,.1):0;lastTime=now;
 if(playing&&player){accumulator+=elapsed;while(accumulator>=1/120){stepPlayer(player,playControls.read(keys),colliders);accumulator-=1/120}const bottom=Math.max(state.spawn.y,...colliders.map(p=>p.y+p.h));if(player.y>bottom+220)restart();const targetX=player.x-width/(2*camera.z),targetY=player.y-height*.57/camera.z;const follow=1-Math.exp(-elapsed*8);camera.x+=(targetX-camera.x)*follow;camera.y+=(targetY-camera.y)*follow}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#080808';ctx.fillRect(0,0,width,height);ctx.save();ctx.scale(camera.z,camera.z);ctx.rotate(camera.rotation||0);ctx.translate(-camera.x,-camera.y);ctx.imageSmoothingEnabled=false;
 const view=pointBounds([{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}].map(p=>screenToWorld(p,camera)));
 if(!playing){const step=grid*Math.max(1,Math.ceil(8/(camera.z*grid))),size=1/camera.z;ctx.fillStyle='#282828';for(let x=Math.floor(view.x/step)*step;x<view.x+view.w;x+=step)for(let y=Math.floor(view.y/step)*step;y<view.y+view.h;y+=step)ctx.fillRect(x,y,size,size)}
 if(pixelView)paintPixelLayer(ctx,pixelBuffer,view,(context,tile)=>drawArtwork(context,tile,now));else drawArtwork(ctx,view,now);
 if(!playing){const o=current();if(o){ctx.save();applyObjectTransform(ctx,o);ctx.lineWidth=1/camera.z;ctx.strokeStyle='#fff';ctx.strokeRect(0,0,o.w,o.h);if(o.kind!=='decor'){ctx.setLineDash([3/camera.z,3/camera.z]);ctx.beginPath();ctx.moveTo(0,o.inset);ctx.lineTo(o.w,o.inset);ctx.stroke();ctx.setLineDash([])}ctx.fillStyle='#fff';ctx.fillRect(o.w-4/camera.z,o.h-4/camera.z,8/camera.z,8/camera.z);ctx.restore()}
  if(gesture?.type==='crop'){const o=gesture.object,a=gesture.start,b=gesture.end;ctx.save();applyObjectTransform(ctx,o);ctx.fillStyle='#ffffff20';ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeStyle='#fff';ctx.lineWidth=1/camera.z;ctx.setLineDash([3/camera.z,3/camera.z]);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.restore()}
  if(gesture?.type==='block'){const a=gesture.start,b=gesture.end;ctx.save();ctx.globalAlpha=.65;ctx.fillStyle=blockColor();ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.restore();ctx.strokeStyle='#fff';ctx.lineWidth=1/camera.z;ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y)}
  if(gesture?.type==='collision')drawCollision(gesture.points,collisionWidth);
  ctx.strokeStyle='#aaa';ctx.lineWidth=1/camera.z;ctx.beginPath();ctx.moveTo(state.spawn.x-7,state.spawn.y+2);ctx.lineTo(state.spawn.x+7,state.spawn.y+2);ctx.stroke();
 }ctx.restore();
}
refresh();requestAnimationFrame(render);
// The browser and remote MCP connection use the same state/actions.
async function applyAgentProject(next){await cacheAssets(next.assets);if(gesture||numberScrub?.active()||importing)return false;state=next;if(!current())selected=null;if(playing)colliders=platforms(state.objects);refresh();renderPalette();autosave?.changed()}
async function previewPNG(){const c=document.createElement('canvas');const scale=Math.min(1,960/canvas.width);c.width=Math.round(canvas.width*scale);c.height=Math.round(canvas.height*scale);const context=c.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(canvas,0,0,c.width,c.height);return c.toDataURL('image/png')}
shared=new SharedLevel({snapshot:()=>snapshot(state),apply:applyAgentProject,busy:()=>!!gesture||!!numberScrub?.active()||importing,
 setPlay:value=>{if(value!==playing)togglePlay()},preview:previewPNG,error:text=>message(text,7000),changed:refresh});
async function leaveShared(){await shared.queue;shared.detach();window.history?.replaceState(null,'',location.pathname)}
async function beginProject(project){cancelGesture();numberScrub?.cancel();if(playing)togglePlay();if(typeof location!=='undefined')await leaveShared();history=[];future=[];localRevision++;if(autosave?.ready)await autosave.start(project);else await restore(project);fit()}
$('#projects-button').onclick=async()=>{if(importing){message('Finish importing first.');return}const list=$('#saved-projects');list.replaceChildren();try{for(const p of await autosave?.list()||[]){const button=document.createElement('button');button.textContent=p.project.name||'Untitled';button.onclick=async()=>{try{cancelGesture();numberScrub?.cancel();if(playing)togglePlay();await leaveShared();await autosave.load(p.id);history=[];future=[];localRevision++;fit();$('#projects-dialog').close()}catch(error){message(error.message)}};list.append(button)}}catch(error){message(error.message)}$('#project').hidden=true;$('#projects-dialog').showModal()};
$('#close-projects').onclick=()=>$('#projects-dialog').close();
installChat({
 connectChatGPT:openAgent,
 history:async()=>shared.connected?(await shared.request('/api/rooms/'+shared.token+'/chat')).messages:[],
 send:async message=>{
  if(gesture||numberScrub.active()||importing)throw Error('Finish the current edit first.');
  if(!shared.connected){if(shared.token)throw Error('Reconnect the agent session first.');await shared.connect();window.history.replaceState(null,'','#room='+shared.token)}
  await shared.queue;
  if(gesture||numberScrub.active()||importing)throw Error('Finish the current edit first.');
  const reply=await shared.request('/api/rooms/'+shared.token+'/chat',{method:'POST',body:JSON.stringify({message,revision:shared.revision,grid,preview:await previewPNG()})});
  await shared.accept(reply.room);return reply;
 }
});
function showAgent(){const connected=shared.connected;$('#agent-connected').hidden=!connected;$('#agent-connect').hidden=connected;$('#agent-url').value=connected?shared.url():''}
function openAgent(){$('#project').hidden=true;showAgent();$('#agent-dialog').showModal()}
$('#agent-button').onclick=openAgent;$('#close-agent').onclick=()=>$('#agent-dialog').close();
$('#agent-connect').onclick=async()=>{const button=$('#agent-connect');button.disabled=true;try{if(gesture||numberScrub.active()||importing)throw Error('Finish the current edit first.');if(!shared.connected)await shared.connect();window.history.replaceState(null,'','#room='+shared.token);showAgent();message('Link ready. Add it in ChatGPT.')}catch(error){message(error.message,6000)}finally{button.disabled=false}};
async function copyAgentText(text){try{await navigator.clipboard.writeText(text);message('Copied')}catch{$('#agent-url').value=text;$('#agent-url').focus();$('#agent-url').select();message('Select and copy the link')}}
$('#copy-agent').onclick=()=>copyAgentText(shared.url());$('#copy-room').onclick=()=>copyAgentText(location.origin+'/#room='+shared.token);
$('#agent-disconnect').onclick=async()=>{try{await shared.disconnect();window.history.replaceState(null,'',location.pathname);showAgent();message('Agent link revoked')}catch(error){message(error.message)}};
async function executeAgent(name,args={}){
 if((gesture||numberScrub?.active()||importing)&&['edit_level','undo_level','set_play_mode','import_image','slice_spritesheet','create_spritesheet'].includes(name))throw Error('The user is editing. Retry when the gesture or import finishes.');
 if(shared.connected)return shared.tool(name,args);
 if(name==='get_level')return{revision:localRevision,...projectInfo(snapshot(state)),camera:{...camera},selected,playing,importing};
 if(['import_image','slice_spritesheet','create_spritesheet'].includes(name)){if(args.revision!==localRevision)throw Error('Read the current revision first.');const edited=await imageProject(snapshot(state),name,args);checkpoint();await applyAgentProject(edited.project);return{revision:localRevision,...edited.details,content:edited.image?[edited.image]:[]}}
 if(name==='edit_level'){if(args.revision!==localRevision)throw Error('Read the current revision first.');const next=editProject(snapshot(state),args.operations);checkpoint();await applyAgentProject(next);return executeAgent('get_level')}
 if(name==='undo_level'){if(args.revision!==localRevision)throw Error('Read the current revision first.');if(!history.length)throw Error('Nothing to undo.');await undo();return executeAgent('get_level')}
 if(name==='get_asset_image'){const a=state.assets.find(a=>a.id===args.id);if(!a)throw Error('Unknown asset.');return{content:[{type:'image',mimeType:'image/png',data:a.src.split(',')[1]}]}}
 if(name==='simulate_player')return simulate(snapshot(state),args.route);
 if(name==='get_canvas_preview')return{content:[{type:'image',mimeType:'image/png',data:(await previewPNG()).split(',')[1]}]};
 if(name==='set_play_mode'){if(typeof args.playing!=='boolean')throw Error('playing must be boolean.');if(args.playing!==playing)togglePlay();return{playing}}
 throw Error('Unknown tool.');
}
if(document.modelContext?.registerTool){const lifecycle=new AbortController();for(const tool of agentTools){try{Promise.resolve(document.modelContext.registerTool({...tool,execute:args=>executeAgent(tool.name,args)},{signal:lifecycle.signal})).catch(()=>{})}catch{}}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true})}
if(typeof location!=='undefined'){
 const room=location.hash.match(/^#room=([a-f0-9]{64})$/)?.[1],project=location.hash.match(/^#project=([a-f0-9]{64})$/)?.[1];
 if(typeof indexedDB!=='undefined'){
  autosave=new Autosave({snapshot:()=>snapshot(state),restore:async p=>{await restore(p);fit()},status:text=>$('#save-status').textContent=text,link:token=>{if(!location.hash.startsWith('#room='))window.history.replaceState(null,'','#project='+token)}});
  app.inert=true;
  (async()=>{try{if(room){await shared.connect(room);showAgent()}await autosave.init({token:project,skipRestore:!!room});if(room)autosave.changed()}catch(error){message(error.message,6000);if(!autosave.ready){window.history.replaceState(null,'',location.pathname);await autosave.init()}}finally{app.inert=false}})();
  window.addEventListener('online',()=>void autosave.flush());setInterval(()=>{if(autosave.dirty)void autosave.flush()},15000);
 }else if(room)shared.connect(room).then(showAgent).catch(error=>message(error.message,6000));
}
