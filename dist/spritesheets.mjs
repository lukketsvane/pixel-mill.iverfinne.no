import {decodePNG,encodePNG,pngBytes,dataURL} from './png.mjs';
import {recognizeSheetPixels} from './sheet-recognition.mjs';

// Imported sheets retain their PNG; workspace collections reference existing
// source assets. Grouping and animation order never rewrite or duplicate pixels.
const sheetLimit=8192;
const sheetCopy=value=>JSON.parse(JSON.stringify(value));
const sheetInteger=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid sprite sheet '+label+'.');return value};
const sheetId=value=>{if(typeof value!=='string'||!value||value.length>200)throw Error('Invalid sprite sheet ID.');return value};
const sheetName=(value,fallback)=>String(value||fallback).slice(0,80);
let sheetCachedSource=null,sheetCachedPixels=null;
async function sheetDecode(asset){
 if(!asset||typeof asset.src!=='string')throw Error('Choose a source image.');
 if(asset.src===sheetCachedSource&&sheetCachedPixels){if(sheetCachedPixels.w!==asset.w||sheetCachedPixels.h!==asset.h)throw Error('Sprite sheet dimensions do not match the source PNG.');return sheetCachedPixels}
 const decoded=await decodePNG(pngBytes(asset.src));
 if(decoded.w!==asset.w||decoded.h!==asset.h)throw Error('Sprite sheet dimensions do not match the source PNG.');
 sheetCachedSource=asset.src;sheetCachedPixels=decoded;return decoded;
}

function sheetOrigin(value={x:0,y:0}){if(!value||typeof value!=='object'||!Number.isFinite(value.x)||!Number.isFinite(value.y)||Math.abs(value.x)>4096||Math.abs(value.y)>4096)throw Error('Invalid group origin.');return{x:value.x,y:value.y}}
function sheetSettings(group){const fps=group.fps??8;if(!Number.isFinite(fps)||fps<.1||fps>120||group.loop!==undefined&&typeof group.loop!=='boolean')throw Error('Invalid animation settings.');return{fps,loop:group.loop!==false,origin:sheetOrigin(group.origin)}}
function sheetRaster(id,assets,owner){if(id===owner.id)throw Error('A sprite sheet cannot reference itself.');if(!assets)return null;const source=assets.find(item=>item.id===id);if(!source||typeof source.src!=='string'||source.spriteSheet?.source==='assets')throw Error('Sprite frame source must reference an existing raster asset.');return source}
function sheetArtwork(raw,meta,assets,owner){
 if(!raw||typeof raw!=='object')throw Error('Invalid replacement artwork.');const id=sheetId(raw.asset),source=sheetRaster(id,assets,owner),result={asset:id,x:sheetInteger(raw.x??0,0,4096,'artwork x'),y:sheetInteger(raw.y??0,0,4096,'artwork y'),w:sheetInteger(raw.w,1,4096,'artwork width'),h:sheetInteger(raw.h,1,4096,'artwork height')};
 for(const key of ['offsetX','offsetY','targetW','targetH'])if(raw[key]!==undefined)result[key]=sheetInteger(raw[key],key.startsWith('target')?1:0,4096,key);
 if(source&&(result.x+result.w>source.w||result.y+result.h>source.h)||(result.offsetX??0)+(result.targetW??meta.cellWidth)>meta.cellWidth||(result.offsetY??0)+(result.targetH??meta.cellHeight)>meta.cellHeight)throw Error('Replacement artwork exceeds its source or common frame cell.');return result;
}
export function validateSpriteSheet(raw,asset,assets){
 if(!raw||typeof raw!=='object'||!['character','environment'].includes(raw.type)||!['row','column','manual'].includes(raw.grouping)||raw.source!==undefined&&!['sheet','assets'].includes(raw.source))throw Error('Invalid sprite sheet metadata.');
 const result={type:raw.type,source:raw.source??'sheet',cellWidth:sheetInteger(raw.cellWidth,1,4096,'cell width'),cellHeight:sheetInteger(raw.cellHeight,1,4096,'cell height'),rows:sheetInteger(raw.rows,1,4096,'rows'),cols:sheetInteger(raw.cols,1,4096,'columns'),gutterX:sheetInteger(raw.gutterX??0,0,4096,'horizontal gutter'),gutterY:sheetInteger(raw.gutterY??0,0,4096,'vertical gutter'),marginX:sheetInteger(raw.marginX??0,0,4096,'horizontal margin'),marginY:sheetInteger(raw.marginY??0,0,4096,'vertical margin'),grouping:raw.grouping,preserveEmpty:raw.preserveEmpty!==false};
 if(raw.layout!==undefined){if(!['grid','atlas'].includes(raw.layout))throw Error('Invalid sheet layout.');result.layout=raw.layout}
 if(raw.recognized!==undefined){if(typeof raw.recognized!=='boolean')throw Error('Invalid recognition metadata.');result.recognized=raw.recognized}
 if(raw.preserveEmpty!==undefined&&typeof raw.preserveEmpty!=='boolean')throw Error('Invalid empty-cell setting.');
 if(result.rows*result.cols>sheetLimit||result.layout!=='atlas'&&(result.marginX+result.cols*result.cellWidth+(result.cols-1)*result.gutterX>asset.w||result.marginY+result.rows*result.cellHeight+(result.rows-1)*result.gutterY>asset.h))throw Error('Sprite grid exceeds its source image or 8,192 cells.');
 if(!Array.isArray(raw.frames)||!Array.isArray(raw.groups)||raw.frames.length>sheetLimit||raw.groups.length>sheetLimit)throw Error('Invalid sprite sheet groups or frames.');
 const ids=new Set(),positions=new Set();
 result.frames=raw.frames.map(frame=>{
  if(!frame||typeof frame!=='object')throw Error('Invalid sprite frame.');
  const id=sheetId(frame.id),row=sheetInteger(frame.row,0,result.rows-1,'frame row'),col=sheetInteger(frame.col,0,result.cols-1,'frame column'),position=row+':'+col;
  if(ids.has(id)||positions.has(position))throw Error('Duplicate sprite frame.');ids.add(id);positions.add(position);
  if(frame.empty!==undefined&&typeof frame.empty!=='boolean')throw Error('Invalid empty sprite frame.');
  const sourceAssetId=frame.sourceAssetId===undefined?undefined:sheetId(frame.sourceAssetId),source=sourceAssetId?sheetRaster(sourceAssetId,assets,asset):result.source==='sheet'?asset:null;
  const item={id,row,col,x:sheetInteger(frame.x,0,4096,'source x'),y:sheetInteger(frame.y,0,4096,'source y'),w:sheetInteger(frame.w,1,4096,'frame width'),h:sheetInteger(frame.h,1,4096,'frame height'),empty:!!frame.empty};
  if(result.source==='sheet'&&!sourceAssetId&&result.layout!=='atlas'){const x=result.marginX+col*(result.cellWidth+result.gutterX),y=result.marginY+row*(result.cellHeight+result.gutterY);if(item.x!==x||item.y!==y||item.w!==result.cellWidth||item.h!==result.cellHeight)throw Error('Sprite frame does not match its source grid.')}
  if(result.source==='assets'&&!sourceAssetId&&!item.empty)throw Error('A collection frame needs a source asset.');
  if(sourceAssetId)item.sourceAssetId=sourceAssetId;
  if(result.source==='assets'||frame.offsetX!==undefined||frame.offsetY!==undefined){item.offsetX=sheetInteger(frame.offsetX??0,0,result.cellWidth-1,'frame offset x');item.offsetY=sheetInteger(frame.offsetY??0,0,result.cellHeight-1,'frame offset y')}
  if(source&&(item.x+item.w>source.w||item.y+item.h>source.h)||(item.offsetX??0)+item.w>result.cellWidth||(item.offsetY??0)+item.h>result.cellHeight)throw Error('Sprite crop exceeds its source or common frame cell.');
  if(frame.artwork!==undefined)item.artwork=sheetArtwork(frame.artwork,result.layout==='atlas'?{...result,cellWidth:item.w,cellHeight:item.h}:result,assets,asset);return item;
 });
 if(result.preserveEmpty&&result.frames.length!==result.rows*result.cols)throw Error('Preserved grid is missing frames.');
 const groupIds=new Set(),membership=new Set();
 result.groups=raw.groups.map(group=>{
  if(!group||!['row_group','column_group','manual_group'].includes(group.type)||!Array.isArray(group.frameIds))throw Error('Invalid animation group.');
  const id=sheetId(group.id);if(groupIds.has(id))throw Error('Duplicate animation group.');groupIds.add(id);
  const frameIds=group.frameIds.map(frameId=>{if(!ids.has(frameId)||membership.has(frameId))throw Error('Sprite frames must belong to exactly one group.');membership.add(frameId);return frameId});
  return{id,type:group.type,name:sheetName(group.name,'group'),frameIds,...sheetSettings(group)};
 });
 if(membership.size!==ids.size)throw Error('Sprite frames must belong to exactly one group.');return result;
}

function sheetRuns(projection){
 const runs=[];let begin=-1;
 for(let i=0;i<=projection.length;i++){if(projection[i]&&begin<0)begin=i;if(!projection[i]&&begin>=0){runs.push({start:begin,end:i});begin=-1}}
 return runs;
}
function sheetMedian(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??0}
function sheetAxis(projection){
 const size=projection.length;let runs=sheetRuns(projection);
 if(runs.length>1){
  // Tiny holes inside a sprite must not turn limbs into separate cells.
  const gaps=runs.slice(1).map((run,i)=>run.start-runs[i].end),threshold=Math.max(2,sheetMedian(gaps)*.5),merged=[];
  for(const run of runs){const last=merged.at(-1);if(last&&run.start-last.end<threshold)last.end=run.end;else merged.push({...run})}runs=merged;
 }
 if(runs.length>=2&&runs.length<=256){
  const count=runs.length,cell=size/count;
  if(Number.isInteger(cell)&&runs.every((run,i)=>run.start>=i*cell&&run.end<=(i+1)*cell))return{cell,count,gutter:0,margin:0,confidence:.96};
  const starts=runs.slice(1).map((run,i)=>run.start-runs[i].start),stride=sheetMedian(starts),extent=Math.max(...runs.map(run=>run.end-run.start));
  if(starts.every(step=>Math.abs(step-stride)<=1)&&extent<=stride){
   const margin=runs[0].start,gutter=stride-extent;
   if(margin+(count-1)*stride+extent<=size)return{cell:extent,count,gutter,margin,confidence:.82};
  }
 }
 const cell=Math.min(16,size);return{cell,count:Math.max(1,Math.floor(size/cell)),gutter:0,margin:0,confidence:.15};
}
function sheetOccupancy({pixels,w,h}){
 const occupied=new Uint8Array(w*h);let transparent=0;
 for(let i=3;i<pixels.length;i+=4)if(pixels[i]<16)transparent++;
 let background=null;
 if(transparent<w*h*.01){
  // White/flat-background imports are common. Infer separators without changing
  // that background or any original image pixel.
  const counts=new Map();let total=0;
  const sample=(x,y)=>{const p=(y*w+x)*4,key=(pixels[p]<<16)|(pixels[p+1]<<8)|pixels[p+2];counts.set(key,(counts.get(key)||0)+1);total++};
  for(let x=0;x<w;x++){sample(x,0);if(h>1)sample(x,h-1)}for(let y=1;y<h-1;y++){sample(0,y);if(w>1)sample(w-1,y)}
  const dominant=[...counts].sort((a,b)=>b[1]-a[1])[0];if(dominant&&dominant[1]/total>.8)background=[dominant[0]>>16,(dominant[0]>>8)&255,dominant[0]&255];
 }
 for(let p=0;p<occupied.length;p++){const i=p*4;occupied[p]=pixels[i+3]>=16&&(!background||Math.max(Math.abs(pixels[i]-background[0]),Math.abs(pixels[i+1]-background[1]),Math.abs(pixels[i+2]-background[2]))>8)?1:0}
 return{occupied,method:background?'background-spacing':'transparency'};
}

export async function detectSpriteGrid(asset){
 const decoded=await sheetDecode(asset),{occupied,method}=sheetOccupancy(decoded),horizontal=new Uint8Array(decoded.w),vertical=new Uint8Array(decoded.h);
 for(let y=0;y<decoded.h;y++)for(let x=0;x<decoded.w;x++)if(occupied[y*decoded.w+x]){horizontal[x]=1;vertical[y]=1}
 const x=sheetAxis(horizontal),y=sheetAxis(vertical),confidence=Math.min(x.confidence,y.confidence);
 return{cellWidth:x.cell,cellHeight:y.cell,rows:y.count,cols:x.count,gutterX:x.gutter,gutterY:y.gutter,marginX:x.margin,marginY:y.margin,grouping:'row',sheetType:'character',preserveEmpty:true,confidence,method:confidence<.5?'16px-default':method};
}

export async function recognizeSpriteSheet(asset){return recognizeSheetPixels(await sheetDecode(asset))}
export async function autoGroupSpriteSheet(asset,args={},assets=[]){
 const found=await recognizeSpriteSheet(asset);if(found.kind==='image')return asset;
 let meta;
 if(found.kind==='character'&&found.layout==='grid'){
  const grouped=await groupSpriteSheet(asset,{cellWidth:found.cellWidth,cellHeight:found.cellHeight,rows:found.rows,cols:found.cols,grouping:args.grouping||'row',sheetType:args.sheetType||'character'},assets);meta=grouped.spriteSheet;meta.frames.forEach((frame,i)=>frame.empty=found.frames[i].empty);
 }else{
  meta={type:args.sheetType||found.kind,source:'sheet',layout:'atlas',cellWidth:found.cellWidth,cellHeight:found.cellHeight,rows:found.rows,cols:found.cols,gutterX:0,gutterY:0,marginX:0,marginY:0,grouping:args.grouping||'row',preserveEmpty:found.kind==='character',frames:found.frames,groups:[]};sheetRegroup(meta);
  if(meta.type==='environment')for(const [i,group]of meta.groups.entries())group.name='set-'+String(i+1).padStart(2,'0');
 }
 meta.recognized=true;return sheetUpdatedAsset(asset,meta,assets);
}

export async function groupSpriteSheet(asset,args={},assets=[]){
 if(!asset.spriteSheet&&!['cellWidth','cellHeight','rows','cols','gutterX','gutterY','marginX','marginY'].some(key=>args[key]!==undefined))return autoGroupSpriteSheet(asset,args,assets);
 if(asset.spriteSheet?.layout==='atlas'){
  const meta=validateSpriteSheet(asset.spriteSheet,asset,assets),oldGrouping=meta.grouping;for(const key of ['cellWidth','cellHeight','rows','cols','gutterX','gutterY','marginX','marginY'])if(args[key]!==undefined&&args[key]!==meta[key])throw Error('This sheet uses detected asset bounds. Select assets to regroup them.');
  meta.type=args.sheetType??meta.type;meta.grouping=args.grouping??meta.grouping;sheetRegroupPreserving(meta,oldGrouping);return sheetUpdatedAsset(asset,meta,assets);
 }
 if(asset.spriteSheet?.source==='assets'){
  const meta=validateSpriteSheet(asset.spriteSheet,asset,assets);for(const key of ['cellWidth','cellHeight','rows','cols','gutterX','gutterY','marginX','marginY'])if(args[key]!==undefined&&args[key]!==meta[key])throw Error('Regroup the workspace sources to change collection cells.');
  const oldGrouping=meta.grouping;meta.type=args.sheetType??meta.type;meta.grouping=args.grouping??meta.grouping;meta.preserveEmpty=args.preserveEmpty??meta.preserveEmpty;if(!meta.preserveEmpty)meta.frames=meta.frames.filter(frame=>!frame.empty||frame.artwork);else{const present=new Set(meta.frames.map(frame=>frame.row+':'+frame.col));for(let row=0;row<meta.rows;row++)for(let col=0;col<meta.cols;col++)if(!present.has(row+':'+col))meta.frames.push({id:'frame-'+row+'-'+col,row,col,x:0,y:0,w:meta.cellWidth,h:meta.cellHeight,offsetX:0,offsetY:0,empty:true})}sheetRegroupPreserving(meta,oldGrouping);return sheetUpdatedAsset(asset,meta,assets);
 }
 const image=await sheetDecode(asset),previous=asset.spriteSheet;
 const inferred=previous?{...previous,sheetType:previous.type}:await detectSpriteGrid(asset);
 const cellWidth=args.cellWidth??inferred.cellWidth,cellHeight=args.cellHeight??inferred.cellHeight,gutterX=args.gutterX??inferred.gutterX??0,gutterY=args.gutterY??inferred.gutterY??0,marginX=args.marginX??inferred.marginX??0,marginY=args.marginY??inferred.marginY??0;
 for(const [key,value]of Object.entries({cellWidth,cellHeight,gutterX,gutterY,marginX,marginY}))sheetInteger(value,key.startsWith('cell')?1:0,4096,key);
 const cols=args.cols??(previous&&cellWidth===previous.cellWidth&&gutterX===(previous.gutterX??0)&&marginX===(previous.marginX??0)?previous.cols:Math.floor((image.w-marginX+gutterX)/(cellWidth+gutterX))),rows=args.rows??(previous&&cellHeight===previous.cellHeight&&gutterY===(previous.gutterY??0)&&marginY===(previous.marginY??0)?previous.rows:Math.floor((image.h-marginY+gutterY)/(cellHeight+gutterY))),grouping=args.grouping??previous?.grouping??'row';
 const meta={type:args.sheetType??inferred.sheetType??'character',cellWidth,cellHeight,rows,cols,gutterX,gutterY,marginX,marginY,grouping,preserveEmpty:args.preserveEmpty??previous?.preserveEmpty??true,frames:[],groups:[]};
 sheetInteger(cols,1,4096,'columns');sheetInteger(rows,1,4096,'rows');
 if(cols*rows>sheetLimit||marginX+cols*cellWidth+(cols-1)*gutterX>image.w||marginY+rows*cellHeight+(rows-1)*gutterY>image.h)throw Error('Sprite grid exceeds its source image or 8,192 cells.');
 const sameGrid=previous&&['cellWidth','cellHeight','rows','cols','gutterX','gutterY','marginX','marginY'].every(key=>(previous[key]??0)===meta[key]);
 if(previous&&!sameGrid&&previous.frames.some(frame=>frame.artwork))throw Error('Restore generated frame replacements before changing the source grid. Grouping and animation edits can keep the current grid.');
 const priorFrames=new Map((sameGrid?previous.frames:[]).map(frame=>[frame.row+':'+frame.col,frame]));
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const x=marginX+col*(cellWidth+gutterX),y=marginY+row*(cellHeight+gutterY);let empty=true;
  for(let dy=0;dy<cellHeight&&empty;dy++)for(let dx=0;dx<cellWidth;dx++)if(image.pixels[((y+dy)*image.w+x+dx)*4+3]){empty=false;break}
  const retained=priorFrames.get(row+':'+col);if(empty&&!meta.preserveEmpty&&!retained?.artwork)continue;
  meta.frames.push(retained?{...sheetCopy(retained)}:{id:'frame-'+row+'-'+col,row,col,x,y,w:cellWidth,h:cellHeight,empty});
 }
 if(previous){meta.groups=sheetCopy(previous.groups);sheetRegroupPreserving(meta,sameGrid?previous.grouping:null)}else sheetRegroup(meta);
 return sheetUpdatedAsset(asset,meta,assets);
}

function sheetUpdatedAsset(asset,meta,assets){
 const next={...asset,type:'sprite_sheet',spriteSheet:validateSpriteSheet(meta,asset,assets)},scope=asset.referenceSelection;
 if(scope){const groups=new Set(meta.groups.map(group=>group.id)),frames=new Set(meta.frames.map(frame=>frame.id));
  if(scope.groupIds?.some(id=>!groups.has(id))||scope.frameIds?.some(id=>!frames.has(id))){
   const ids=[...(scope.frameIds||[]),...(asset.spriteSheet?.groups||[]).filter(group=>scope.groupIds?.includes(group.id)).flatMap(group=>group.frameIds)],remaining=[...new Set(ids)].filter(id=>frames.has(id));
   if(remaining.length)next.referenceSelection={frameIds:remaining};else{delete next.referenceSelection;next.selectedForGeneration=false}
  }
 }return next;
}
function sheetExactOrder(input,expected,label){if(!Array.isArray(input)||input.length!==expected.length||new Set(input).size!==input.length||input.some(id=>!expected.includes(id)))throw Error('Supply every '+label+' exactly once.');return input}
function sheetNewGroupId(groups){let n=1;while(groups.some(group=>group.id==='group-'+n))n++;return'group-'+n}
export function editSpriteSheet(asset,operations,assets){
 if(!Array.isArray(operations)||!operations.length||operations.length>200)throw Error('Supply 1–200 sprite sheet edits.');
 const meta=sheetCopy(validateSpriteSheet(asset.spriteSheet,asset,assets));
 const getGroup=id=>{const group=meta.groups.find(group=>group.id===id);if(!group)throw Error('Animation group not found.');return group};
 for(const op of operations){
  if(!op||typeof op!=='object')throw Error('Invalid sprite sheet edit.');
  if(op.type==='rename_group'){getGroup(op.groupId).name=sheetName(op.name,'group')}
  else if(op.type==='group_settings'){const group=getGroup(op.groupId);Object.assign(group,sheetSettings({...group,...Object.fromEntries(['fps','loop','origin'].filter(key=>op[key]!==undefined).map(key=>[key,op[key]]))}))}
  else if(op.type==='replace_frame'){const frame=meta.frames.find(frame=>frame.id===op.frameId);if(!frame)throw Error('Sprite frame not found.');if(op.artwork===null)delete frame.artwork;else frame.artwork=sheetArtwork(op.artwork,meta.layout==='atlas'?{...meta,cellWidth:frame.w,cellHeight:frame.h}:meta,assets,asset)}
  else if(op.type==='replace_group'){const group=getGroup(op.groupId);if(!Array.isArray(op.artworks)||op.artworks.length!==group.frameIds.length)throw Error('Supply one replacement for every group frame.');group.frameIds.forEach((id,n)=>{const frame=meta.frames.find(frame=>frame.id===id);if(op.artworks[n]===null)delete frame.artwork;else frame.artwork=sheetArtwork(op.artworks[n],meta.layout==='atlas'?{...meta,cellWidth:frame.w,cellHeight:frame.h}:meta,assets,asset)})}
  else if(op.type==='reorder_groups'){const order=sheetExactOrder(op.groupIds,meta.groups.map(group=>group.id),'group');meta.groups=order.map(getGroup)}
  else if(op.type==='reorder_frames'){const group=getGroup(op.groupId);group.frameIds=[...sheetExactOrder(op.frameIds,group.frameIds,'frame')]}
  else if(op.type==='merge_groups'){
   if(!Array.isArray(op.groupIds)||op.groupIds.length<2||new Set(op.groupIds).size!==op.groupIds.length)throw Error('Choose at least two different animation groups.');
   const groups=op.groupIds.map(getGroup),first=meta.groups.indexOf(groups[0]),merged={...sheetSettings(groups[0]),id:groups[0].id,type:'manual_group',name:sheetName(op.name,groups[0].name),frameIds:groups.flatMap(group=>group.frameIds)};
   meta.groups.splice(first,1,merged);meta.groups=meta.groups.filter(group=>group===merged||!op.groupIds.includes(group.id));meta.grouping='manual';
  }else if(op.type==='split_group'){
   const group=getGroup(op.groupId),at=sheetInteger(op.at,1,group.frameIds.length-1,'split position'),tail={...sheetSettings(group),id:sheetNewGroupId(meta.groups),type:'manual_group',name:sheetName(op.name,group.name+'-02'),frameIds:group.frameIds.splice(at)};
   group.type='manual_group';meta.groups.splice(meta.groups.indexOf(group)+1,0,tail);meta.grouping='manual';
  }else if(op.type==='group_frames'){
   if(!Array.isArray(op.frameIds)||!op.frameIds.length||new Set(op.frameIds).size!==op.frameIds.length||op.frameIds.some(id=>!meta.frames.some(frame=>frame.id===id)))throw Error('Choose valid, different sprite frames.');
   const id=sheetNewGroupId(meta.groups),selected=new Set(op.frameIds);for(const group of meta.groups)group.frameIds=group.frameIds.filter(frameId=>!selected.has(frameId));
   meta.groups=meta.groups.filter(group=>group.frameIds.length);meta.groups.push({id,type:'manual_group',name:sheetName(op.name,id),frameIds:[...op.frameIds]});meta.grouping='manual';
  }else throw Error('Unknown sprite sheet edit: '+op.type);
 }
 return sheetUpdatedAsset(asset,meta,assets);
}

export function spriteSheetLayout(asset,options={},assets){
 const meta=validateSpriteSheet(asset.spriteSheet,asset,assets);
 if([!!options.groupId,!!options.frameId,!!options.groupIds,!!options.frameIds].filter(Boolean).length>1)throw Error('Choose one frame or group selection to export.');
 const frames=new Map(meta.frames.map(frame=>[frame.id,frame]));let groups=meta.groups,name=asset.name,vertical=meta.grouping==='column',marginX=meta.marginX,marginY=meta.marginY,gutterX=meta.gutterX,gutterY=meta.gutterY;
 const requestedFrames=options.frameIds??(options.frameId?[options.frameId]:null),requestedGroups=options.groupIds??(options.groupId?[options.groupId]:null);
 if(requestedFrames){if(!Array.isArray(requestedFrames)||!requestedFrames.length||new Set(requestedFrames).size!==requestedFrames.length||requestedFrames.some(id=>!frames.has(id)))throw Error('Choose existing, distinct frames.');groups=[{frameIds:requestedFrames}];name+='-'+(options.frameId||'frames');vertical=false;marginX=marginY=0;gutterY=0;if(requestedFrames.length===1)gutterX=0}
 else if(requestedGroups){if(!Array.isArray(requestedGroups)||!requestedGroups.length||new Set(requestedGroups).size!==requestedGroups.length||requestedGroups.some(id=>!groups.some(group=>group.id===id)))throw Error('Choose existing, distinct groups.');groups=requestedGroups.map(id=>meta.groups.find(group=>group.id===id));name+='-'+(options.groupId?groups[0].name:'groups');vertical=false;marginX=marginY=0;if(groups.length===1)gutterY=0}
 if(meta.layout==='atlas'){
  const order=groups.flatMap(g=>g.frameIds),original=[...meta.frames].sort((a,b)=>a.row-b.row||a.col-b.col).map(f=>f.id);
  if(!requestedFrames&&!requestedGroups&&order.length===original.length&&order.every((id,i)=>id===original[i]))return{w:asset.w,h:asset.h,name,originalLayout:true,placements:order.map(id=>{const f=frames.get(id);return{frameId:id,x:f.x,y:f.y,w:f.w,h:f.h}})};
  let w=0,h=0;const placements=[];
  for(const group of groups){let x=0,height=0;for(const id of group.frameIds){const f=frames.get(id);placements.push({frameId:id,x,y:h,w:f.w,h:f.h});x+=f.w;height=Math.max(height,f.h)}w=Math.max(w,x);h+=height}
  w=Math.max(1,w);h=Math.max(1,h);if(w>4096||h>4096||w*h>4000000)throw Error('Selection is too large for one strip. Export individual assets instead.');return{w,h,name,placements};
 }
 const length=Math.max(1,...groups.map(group=>group.frameIds.length)),cols=vertical?Math.max(1,groups.length):length,rows=vertical?length:Math.max(1,groups.length),w=2*marginX+cols*meta.cellWidth+Math.max(0,cols-1)*gutterX,h=2*marginY+rows*meta.cellHeight+Math.max(0,rows-1)*gutterY;
 if(w>4096||h>4096||w*h>4000000)throw Error('Export is too large. Export individual strips or frames instead.');
 const placements=[];groups.forEach((group,groupIndex)=>group.frameIds.forEach((frameId,frameIndex)=>placements.push({frameId,x:marginX+(vertical?groupIndex:frameIndex)*(meta.cellWidth+gutterX),y:marginY+(vertical?frameIndex:groupIndex)*(meta.cellHeight+gutterY),w:meta.cellWidth,h:meta.cellHeight})));
 return{w,h,name,placements};
}
export async function exportSpriteSheet(asset,options={},assets=[]){
 const meta=validateSpriteSheet(asset.spriteSheet,asset,assets);
 if(options.original){if(!asset.src)throw Error('This collection keeps separate original sources. Export its source assets.');return{src:asset.src,w:asset.w,h:asset.h,name:asset.name+'-source'}}
 const layout=spriteSheetLayout(asset,options,assets),{w,h,placements}=layout,pixels=new Uint8Array(w*h*4),frames=new Map(meta.frames.map(frame=>[frame.id,frame])),decoded=new Map();
 if(layout.originalLayout){if(!meta.frames.some(f=>f.artwork))return{...layout,src:asset.src};const original=await sheetDecode(asset);pixels.set(original.pixels);decoded.set(asset.id,original)}
 for(const placement of placements){
  const frame=frames.get(placement.frameId),art=frame.artwork,sourceId=art?.asset??frame.sourceAssetId,source=sourceId?assets.find(item=>item.id===sourceId):asset;
  if(layout.originalLayout&&!art)continue;
  if(!art&&!frame.sourceAssetId&&meta.source==='assets')continue;
  if(!source?.src)throw Error('Sprite source is unavailable.');
  let image=decoded.get(source.id);if(!image){image=await sheetDecode(source);decoded.set(source.id,image)}
  const crop=art??frame,dx=art?(art.offsetX??0):(frame.offsetX??0),dy=art?(art.offsetY??0):(frame.offsetY??0),dw=art?(art.targetW??placement.w):frame.w,dh=art?(art.targetH??placement.h):frame.h;
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const sx=crop.x+Math.min(crop.w-1,Math.floor(x*crop.w/dw)),sy=crop.y+Math.min(crop.h-1,Math.floor(y*crop.h/dh)),start=(sy*image.w+sx)*4;pixels.set(image.pixels.subarray(start,start+4),((placement.y+dy+y)*w+placement.x+dx+x)*4)}
 }
 return{...layout,src:dataURL(await encodePNG({w,h,pixels}))};
}

function sheetRegroupPreserving(meta,oldGrouping){
 const prior=meta.groups||[],available=new Map(meta.frames.map(frame=>[frame.id,frame]));
 if(meta.grouping===oldGrouping||meta.grouping==='manual'){
  meta.groups=prior.map(group=>({...group,type:meta.grouping==='manual'?'manual_group':group.type,frameIds:group.frameIds.filter(id=>available.has(id))}));
  const assigned=new Set(meta.groups.flatMap(group=>group.frameIds));
  for(const frame of meta.frames){if(assigned.has(frame.id))continue;const id=meta.grouping==='column'?'column-'+String(frame.col+1).padStart(2,'0'):'row-'+String(frame.row+1).padStart(2,'0');let group=meta.groups.find(group=>group.id===id)|| (meta.grouping==='manual'?meta.groups.at(-1):null);if(!group){group={id,type:meta.grouping==='column'?'column_group':meta.grouping==='manual'?'manual_group':'row_group',name:id,frameIds:[],...sheetSettings({})};meta.groups.push(group)}group.frameIds.push(frame.id)}
  return;
 }
 sheetRegroup(meta);
 // A different grouping changes memberships; carry settings from an exact
 // matching strip, or settings shared by every old contributing strip.
 for(const group of meta.groups){const members=new Set(group.frameIds),exact=prior.find(old=>old.frameIds.length===members.size&&old.frameIds.every(id=>members.has(id)));if(exact){group.name=exact.name;Object.assign(group,sheetSettings(exact));continue}const contributors=prior.filter(old=>old.frameIds.some(id=>members.has(id)));if(contributors.length&&contributors.every(old=>JSON.stringify(sheetSettings(old))===JSON.stringify(sheetSettings(contributors[0]))))Object.assign(group,sheetSettings(contributors[0]))}
}
function sheetRegroup(meta){
 const previous=new Map((meta.groups||[]).map(group=>[group.id,group]));
 if(meta.grouping==='manual')meta.groups=[{id:'group-01',type:'manual_group',name:'group-01',frameIds:meta.frames.map(frame=>frame.id),...sheetSettings(previous.get('group-01')||{})}];
 else{const byRow=meta.grouping==='row',count=byRow?meta.rows:meta.cols;meta.groups=Array.from({length:count},(_,n)=>{const id=meta.grouping+'-'+String(n+1).padStart(2,'0'),old=previous.get(id);return{id,type:meta.grouping+'_group',name:old?.name||id,frameIds:meta.frames.filter(frame=>(byRow?frame.row:frame.col)===n).map(frame=>frame.id),...sheetSettings(old||{})}})}
}
function sheetSourceRect(asset,object){
 const crop=object?.crop,rect=crop?{x:crop.x*asset.w,y:crop.y*asset.h,w:crop.w*asset.w,h:crop.h*asset.h}:{x:0,y:0,w:asset.w,h:asset.h};
 for(const key of ['x','y','w','h']){if(Math.abs(Math.round(rect[key])-rect[key])>.00001)throw Error('Use whole-pixel source crops when grouping sprites.');rect[key]=Math.round(rect[key])}return rect;
}
function sheetPitch(values,size,explicit){
 if(explicit!==undefined)return sheetInteger(explicit,1,4096,'common cell size');
 const sorted=[...new Set(values)].sort((a,b)=>a-b),gaps=sorted.slice(1).map((value,n)=>value-sorted[n]).filter(value=>value>=size*.5);
 if(!gaps.length)return size;
 if(gaps.every(value=>Math.abs(value/size-Math.round(value/size))<.001))return size;
 return Math.max(size,Math.round(Math.min(...gaps)));
}
export async function groupWorkspaceSprites(project,args={}){
 if(!project||!Array.isArray(project.assets)||!Array.isArray(project.objects))throw Error('Choose a workspace.');
 if(!!args.assetIds===!!args.objectIds)throw Error('Choose assets or placed sprites to group.');
 const sourceIds=args.assetIds??args.objectIds;if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>sheetLimit)throw Error('Choose between 1 and 8,192 sprites.');
 const assets=new Map(project.assets.map(asset=>[asset.id,asset])),objects=new Map(project.objects.map(object=>[object.id,object]));
 const entries=sourceIds.map(id=>{const object=args.objectIds?objects.get(id):null;if(args.objectIds&&!object)throw Error('Placed sprite not found.');if(object&&(object.flip||(object.rotation??0)%360||object.adjust||object.opacity!==undefined&&object.opacity!==1||object.artwork))throw Error('Group original unrotated sprites without visual adjustments; transformed level pieces keep their own appearance.');const asset=assets.get(object?object.asset:id);if(!asset||!asset.src||asset.spriteSheet?.source==='assets')throw Error('Choose raster source sprites.');if(args.assetIds&&asset.spriteSheet)throw Error('Already grouped: select loose sprites instead. Export grouped sheets together to keep their hierarchies.');return{asset,object,...sheetSourceRect(asset,object)}});
 const maxW=Math.max(...entries.map(entry=>entry.w)),maxH=Math.max(...entries.map(entry=>entry.h));let cellWidth=args.cellWidth??maxW,cellHeight=args.cellHeight??maxH,cols,rows;
 if(args.objectIds){
  if(new Set(sourceIds).size!==sourceIds.length)throw Error('Choose each placed sprite once.');
  const sx=entries[0].w/entries[0].object.w,sy=entries[0].h/entries[0].object.h;
  if(entries.some(entry=>Math.abs(entry.w/entry.object.w-sx)>.00001||Math.abs(entry.h/entry.object.h-sy)>.00001))throw Error('Arrange selected sprites at a common scale before grouping.');
  const minX=Math.min(...entries.map(entry=>entry.object.x)),minY=Math.min(...entries.map(entry=>entry.object.y));
  for(const entry of entries){entry.px=(entry.object.x-minX)*sx;entry.py=(entry.object.y-minY)*sy;if(Math.abs(entry.px-Math.round(entry.px))>.00001||Math.abs(entry.py-Math.round(entry.py))>.00001)throw Error('Align selected sprites to whole source pixels.');entry.px=Math.round(entry.px);entry.py=Math.round(entry.py)}
  cellWidth=sheetPitch(entries.map(entry=>entry.px),maxW,args.cellWidth);cellHeight=sheetPitch(entries.map(entry=>entry.py),maxH,args.cellHeight);
  for(const entry of entries){entry.col=Math.floor(entry.px/cellWidth);entry.row=Math.floor(entry.py/cellHeight);entry.offsetX=entry.px-entry.col*cellWidth;entry.offsetY=entry.py-entry.row*cellHeight}
  cols=args.columns??Math.max(...entries.map(entry=>entry.col))+1;rows=Math.max(...entries.map(entry=>entry.row))+1;
 }else{
  cols=args.columns??Math.ceil(Math.sqrt(entries.length));rows=Math.ceil(entries.length/cols);entries.forEach((entry,n)=>{entry.row=Math.floor(n/cols);entry.col=n%cols;entry.offsetX=entry.offsetY=0});
 }
 sheetInteger(cellWidth,1,4096,'cell width');sheetInteger(cellHeight,1,4096,'cell height');sheetInteger(cols,1,4096,'columns');sheetInteger(rows,1,4096,'rows');
 const w=cols*cellWidth,h=rows*cellHeight;if(w>4096||h>4096||w*h>4000000||rows*cols>sheetLimit)throw Error('Collection exceeds the sheet export limit. Choose fewer sprites or a smaller grid.');
 const id=args.id??'sheet-'+crypto.randomUUID();sheetId(id);if(assets.has(id))throw Error('Asset ID already exists.');
 const parent={id,type:'sprite_sheet',selectedForGeneration:true,name:sheetName(args.name,'Sprite collection'),w,h,spriteSheet:{source:'assets',type:args.sheetType??'character',cellWidth,cellHeight,rows,cols,gutterX:0,gutterY:0,marginX:0,marginY:0,grouping:'row',preserveEmpty:true,frames:[],groups:[]}},meta=parent.spriteSheet,positions=new Map(),decoded=new Map();
 for(const entry of entries){const key=entry.row+':'+entry.col;if(positions.has(key))throw Error('Two sprites occupy the same inferred cell. Choose a larger arrangement or group assets in order.');if(entry.col>=cols)throw Error('The chosen column count excludes a selected sprite.');if(entry.offsetX+entry.w>cellWidth||entry.offsetY+entry.h>cellHeight)throw Error('A sprite crosses a common cell boundary. Adjust the cell size or layout.');positions.set(key,entry)}
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const entry=positions.get(row+':'+col),frame={id:'frame-'+row+'-'+col,row,col,x:entry?.x??0,y:entry?.y??0,w:entry?.w??cellWidth,h:entry?.h??cellHeight,offsetX:entry?.offsetX??0,offsetY:entry?.offsetY??0,empty:true};
  if(entry){frame.sourceAssetId=entry.asset.id;let image=decoded.get(entry.asset.id);if(!image){image=await sheetDecode(entry.asset);decoded.set(entry.asset.id,image)}for(let y=0;y<entry.h&&frame.empty;y++)for(let x=0;x<entry.w;x++)if(image.pixels[((entry.y+y)*image.w+entry.x+x)*4+3]){frame.empty=false;break}}
  meta.frames.push(frame);
 }
 sheetRegroup(meta);parent.spriteSheet=validateSpriteSheet(meta,parent,project.assets);
 return{project:{...project,assets:[...project.assets,parent]},details:{assetId:id,sourceAssetIds:[...new Set(entries.map(entry=>entry.asset.id))],groups:meta.groups.length,frames:meta.frames.length,rows,cols}};
}
export function ungroupWorkspaceSprites(project,{assetId}={}){
 const asset=project.assets.find(asset=>asset.id===assetId);if(!asset?.spriteSheet)throw Error('Choose a grouped sheet.');
 let assets;if(asset.spriteSheet.source==='assets'){
  if(project.objects.some(object=>object.asset===assetId||object.artwork?.asset===assetId))throw Error('This collection is used by the level. Remove those uses before ungrouping.');
  assets=project.assets.filter(item=>item.id!==assetId);
 }else assets=project.assets.map(item=>{if(item.id!==assetId)return item;const {type,spriteSheet,referenceSelection,...source}=item;return source});
 // Generated replacement atlases become ordinary source assets when their
 // collection is dissolved. Keep their pixels available and their references valid.
 assets=assets.map(item=>{if(item.parentAssetId!==assetId)return item;const {parentAssetId,hidden,...source}=item;return source});
 return{project:{...project,assets},details:{assetId,ungrouped:true,sourceAssetIds:[...new Set(asset.spriteSheet.frames.map(frame=>frame.sourceAssetId).filter(Boolean))]}};
}
