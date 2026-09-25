import {validateProject,platforms,newPlayer,stepPlayer,MOVE} from './engine.mjs';
import {cropObject,resetCrop,snapObject} from './geometry.mjs';
import {pngBytes,pngHeader,decodePNG,encodePNG,dataURL} from './png.mjs';
import {detectBackground,processPixels,extractPart} from './pixel-core.mjs';
import {validBlockColor} from './color.mjs';
const clone=value=>structuredClone(value);
const equal=(a,b)=>{if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]))};
const finite=(v,fallback)=>v===undefined?fallback:typeof v==='number'&&Number.isFinite(v)?v:(()=>{throw Error('Expected a finite number.')})();
export function editProject(project,operations){
 if(!Array.isArray(operations)||!operations.length||operations.length>100)throw Error('Supply 1–100 operations.');const next=clone(project);
 for(const op of operations){if(!op||typeof op!=='object')throw Error('Invalid operation.');const find=()=>{const o=next.objects.find(o=>o.id===op.id);if(!o)throw Error('Piece not found: '+op.id);return o};
  if(op.type==='block'||op.type==='place'){const a=op.type==='place'?next.assets.find(a=>a.id===op.assetId):null;if(op.type==='place'&&!a)throw Error('Asset not found.');if(op.color!==undefined&&(a||!validBlockColor(op.color)))throw Error('Invalid block color.');next.objects.push({id:op.id||crypto.randomUUID(),asset:a?.id||null,name:op.name||a?.name||'Block',x:finite(op.x,0),y:finite(op.y,0),w:finite(op.width,a?.w||32),h:finite(op.height,a?.h||16),inset:0,rotation:finite(op.rotation,0),flip:false,kind:op.kind||(a?'platform':'solid'),...(op.color?{color:op.color}:{})})}
  else if(op.type==='stroke'){if(!Array.isArray(op.points)||!op.points.length||op.points.length>1500||op.points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Supply 1–1500 collision points.');const radius=finite(op.width,8)/2,lowX=Math.min(...op.points.map(p=>p.x))-radius,lowY=Math.min(...op.points.map(p=>p.y))-radius,highX=Math.max(...op.points.map(p=>p.x))+radius,highY=Math.max(...op.points.map(p=>p.y))+radius;next.objects.push({id:op.id||crypto.randomUUID(),asset:null,name:op.name||'Invisible collision',x:lowX,y:lowY,w:highX-lowX,h:highY-lowY,kind:'solid',inset:0,rotation:0,collisionOnly:true,brushWidth:radius*2,points:op.points.map(p=>({x:p.x-lowX,y:p.y-lowY}))})}
  else if(op.type==='update'){const o=find();if(!op.changes||Object.keys(op.changes).some(k=>!['x','y','w','h','rotation','kind','inset','flip','name','locked','opacity','color','adjust'].includes(k)))throw Error('Unknown piece property.');if(o.locked&&op.changes.locked!==false)throw Error('Unlock the piece before editing.');if(op.changes.color!==undefined&&(o.asset||!validBlockColor(op.changes.color)))throw Error('Invalid block color.');Object.assign(o,op.changes)}
  else if(op.type==='duplicate'){const o=find();if(o.locked)throw Error('Unlock the piece before duplicating.');next.objects.push({...o,id:crypto.randomUUID(),x:o.x+finite(op.dx,8),y:o.y+finite(op.dy,8)})}
  else if(op.type==='delete'){if(!Array.isArray(op.ids)||op.ids.some(id=>!next.objects.some(o=>o.id===id)))throw Error('Unknown piece ID.');if(next.objects.some(o=>op.ids.includes(o.id)&&o.locked))throw Error('Unlock the piece before deleting.');next.objects=next.objects.filter(o=>!op.ids.includes(o.id))}
  else if(op.type==='crop'){const o=find();if(!o.asset)throw Error('Only image pieces can be cropped.');if(op.reset)resetCrop(o);else{const r=op.rect;if(!r||!['x','y','w','h'].every(k=>Number.isFinite(r[k])))throw Error('Supply a crop rectangle in local displayed pixels.');cropObject(o,r)}}
  else if(op.type==='order'){const o=find();if(o.locked)throw Error('Unlock the piece before reordering.');if(!['front','back','forward','backward'].includes(op.direction))throw Error('Unknown layer direction.');const index=next.objects.indexOf(o),target=op.direction==='front'?next.objects.length-1:op.direction==='back'?0:Math.max(0,Math.min(next.objects.length-1,index+(op.direction==='forward'?1:-1)));next.objects.splice(index,1);next.objects.splice(target,0,o)}
  else if(op.type==='spawn')next.spawn={x:finite(op.x,0),y:finite(op.y,0)};
  else if(op.type==='rename'){if(typeof op.name!=='string')throw Error('Name must be text.');next.name=op.name}
  else throw Error('Unknown operation: '+op.type);
 }
 const previous=new Map(project.objects.map(o=>[o.id,JSON.stringify(o)]));for(const o of next.objects)if(previous.get(o.id)!==JSON.stringify(o))snapObject(o,1);
 return validateProject(next);
}
export function projectInfo(project){return{...project,assets:project.assets.map(({src,...a})=>a),coordinates:'Native pixels; x right, y down; rotation in degrees about each piece center; spawn is Max’s foot point.',movement:MOVE}}
export function compactProjectInfo(project){return{name:project.name,spawn:project.spawn,objects:project.objects.map(({id,asset,name,x,y,w,h,kind,locked,inset})=>({id,asset,name,x,y,w,h,kind,locked:!!locked,...(inset?{inset}:{})})),assets:project.assets.map(({id,name,w,h})=>({id,name,w,h}))}}
export function editSummary(before,after){const diff=projectDiff(before,after);return{changedIds:diff.objects.map(change=>change.id),addedIds:diff.objects.filter(change=>change.before===null).map(change=>change.id),deletedIds:diff.objects.filter(change=>change.after===null).map(change=>change.id),...(diff.spawn?{spawn:after.spawn}:{}),...(diff.name?{name:after.name}:{})}}
const count=(value,max,label)=>{if(!Number.isInteger(value)||value<1||value>max)throw Error(label+' must be an integer from 1 to '+max+'.');return value};
const assetName=value=>String(value||'Image').trim().slice(0,80)||'Image';
export async function imageProject(project,name,args){
 const next=clone(project);let image=null,details=null;
 if(name==='import_image'){
  const bytes=pngBytes(args.dataUrl),{w,h}=pngHeader(bytes);
  // Decode before saving, so a corrupt PNG cannot poison the project.
  const decoded=await decodePNG(bytes),ids=[];
  if(args.removeBackground||args.split||args.scale!==undefined||args.palette){
   const scale=args.scale??1;if(typeof scale!=='number'||!Number.isFinite(scale)||scale<.05||scale>16)throw Error('Scale must be between 0.05 and 16.');
   const color=args.backgroundColor??detectBackground(decoded.pixels,w,h);
   if(!Array.isArray(color)||color.length!==3||color.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Background color must be three RGB bytes.');
   const processed=processPixels({data:decoded.pixels,width:w,height:h,options:{width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale)),color,tolerance:args.tolerance??15,mode:'all',remove:!!args.removeBackground,palette:args.palette??0,minArea:args.minArea??1,connectivity:8,bridge:0}});
   let parts=processed.parts;
   if(!args.split&&parts.length){const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y));parts=[{x,y,w:Math.max(...parts.map(p=>p.x+p.w))-x,h:Math.max(...parts.map(p=>p.y+p.h))-y,labels:parts.flatMap(p=>p.labels)}]}
   if(parts.length>512)throw Error('Import at most 512 separate pieces at once.');
   for(const [n,part] of parts.entries()){const tile=extractPart(processed,part),id=crypto.randomUUID();ids.push(id);next.assets.push({id,name:assetName(args.name)+'-'+String(n+1).padStart(3,'0'),w:tile.width,h:tile.height,src:dataURL(await encodePNG({w:tile.width,h:tile.height,pixels:tile.data}))})}
  }else{const id=crypto.randomUUID();ids.push(id);next.assets.push({id,name:assetName(args.name),w,h,src:dataURL(bytes)})}
  details={assetIds:ids,width:w,height:h};
 }else if(name==='slice_spritesheet'){
  const asset=next.assets.find(a=>a.id===args.assetId);if(!asset)throw Error('Unknown source asset.');
  const cols=count(args.columns,64,'columns'),rows=count(args.rows,64,'rows');
  if(asset.w%cols||asset.h%rows)throw Error('Every frame must occupy an exact equal-sized cell.');
  const cellW=asset.w/cols,cellH=asset.h/rows,{pixels}=await decodePNG(pngBytes(asset.src)),ids=[];
  if(cols*rows>512)throw Error('Split at most 512 cells at once.');
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const tile=new Uint8Array(cellW*cellH*4);
   for(let row=0;row<cellH;row++)tile.set(pixels.subarray(((y*cellH+row)*asset.w+x*cellW)*4,((y*cellH+row)*asset.w+x*cellW+cellW)*4),row*cellW*4);
   const id=crypto.randomUUID();ids.push(id);next.assets.push({id,name:assetName(args.name||asset.name)+'-'+String(y*cols+x).padStart(3,'0'),w:cellW,h:cellH,src:dataURL(await encodePNG({w:cellW,h:cellH,pixels:tile}))});
  }
  details={assetIds:ids,columns:cols,rows,cellWidth:cellW,cellHeight:cellH};
 }else if(name==='create_spritesheet'){
  const ids=args.assetIds;if(!Array.isArray(ids)||!ids.length||ids.length>512||new Set(ids).size!==ids.length)throw Error('Supply 1–512 distinct asset IDs in frame order.');
  const columns=count(args.columns,64,'columns'),cellW=count(args.cellWidth,4096,'cellWidth'),cellH=count(args.cellHeight,4096,'cellHeight'),rows=Math.ceil(ids.length/columns),w=columns*cellW,h=rows*cellH;
  if(w>4096||h>4096||w*h>4_000_000)throw Error('Spritesheet exceeds 4096 px or four million pixels.');
  const pixels=new Uint8Array(w*h*4);
  for(const [n,id] of ids.entries()){
   const asset=next.assets.find(a=>a.id===id);if(!asset)throw Error('Unknown asset: '+id);
   if(asset.w>cellW||asset.h>cellH)throw Error(asset.name+' does not fit its cell without scaling.');
   const frame=(await decodePNG(pngBytes(asset.src))).pixels,x=(n%columns)*cellW+Math.floor((cellW-asset.w)/2),y=Math.floor(n/columns)*cellH+cellH-asset.h;
   for(let row=0;row<asset.h;row++)pixels.set(frame.subarray(row*asset.w*4,(row+1)*asset.w*4),((y+row)*w+x)*4);
  }
  const src=dataURL(await encodePNG({w,h,pixels})),id=crypto.randomUUID();
  next.assets.push({id,name:assetName(args.name||'Spritesheet'),w,h,src});
  image={type:'image',mimeType:'image/png',data:src.split(',')[1]};
  details={assetIds:[id],columns,rows,cellWidth:cellW,cellHeight:cellH,width:w,height:h,frames:ids.length};
 }else throw Error('Unknown image action.');
 if(next.assets.length>2000)throw Error('The asset palette is full.');
 return{project:validateProject(next),details,image};
}
export function projectDiff(before,after){const diff={};for(const k of ['name','spawn'])if(!equal(before[k],after[k]))diff[k]={before:before[k],after:after[k]};for(const k of ['assets','objects']){const a=new Map(before[k].map(o=>[o.id,o])),b=new Map(after[k].map(o=>[o.id,o]));diff[k]=[...new Set([...a.keys(),...b.keys()])].filter(id=>!equal(a.get(id),b.get(id))).map(id=>({id,before:a.get(id)||null,after:b.get(id)||null}))}const a=before.objects.map(o=>o.id),b=after.objects.map(o=>o.id);if(!equal(a,b))diff.objectOrder={before:a,after:b};return diff}
export function applyDiff(project,diff){if(!diff||typeof diff!=='object'||Object.keys(diff).some(k=>!['name','spawn','assets','objects','objectOrder'].includes(k)))throw Error('Invalid edit patch.');const next=clone(project);
 if(diff.objectOrder){const order=diff.objectOrder;if(![order.before,order.after].every(a=>Array.isArray(a)&&a.every(id=>typeof id==='string')&&new Set(a).size===a.length))throw Error('Invalid layer order.');const ids=next.objects.map(o=>o.id),common=order.before.filter(id=>ids.includes(id));if(!equal(common,ids.filter(id=>common.includes(id))))throw Error('Conflict: layer order changed. Refresh before editing.')}
 for(const k of ['name','spawn'])if(diff[k]){if(!equal(next[k],diff[k].before))throw Error('Conflict: '+k+' changed. Refresh before editing.');next[k]=clone(diff[k].after)}
 for(const k of ['assets','objects']){if(diff[k]!==undefined&&!Array.isArray(diff[k]))throw Error('Invalid edit patch.');for(const change of diff[k]||[]){const index=next[k].findIndex(o=>o.id===change.id),old=index<0?null:next[k][index];if(!equal(old,change.before))throw Error('Conflict: piece changed. Refresh before editing.');if(change.after===null){if(index>=0)next[k].splice(index,1)}else{if(change.after.id!==change.id)throw Error('Piece IDs cannot change.');if(index>=0)next[k][index]=clone(change.after);else next[k].push(clone(change.after))}}}
 if(diff.objectOrder){const ids=diff.objectOrder.after,byId=new Map(next.objects.map(o=>[o.id,o]));if(ids.some(id=>!byId.has(id)))throw Error('Conflict: a reordered piece was removed.');next.objects=[...ids.map(id=>byId.get(id)),...next.objects.filter(o=>!ids.includes(o.id))]}
 return validateProject(next);
}
export function simulate(project,route){if(!Array.isArray(route)||route.length>60)throw Error('Supply a route with up to 60 segments.');let duration=0;for(const s of route){if(!s||!Number.isFinite(s.seconds)||s.seconds<=0||s.seconds>10||![-1,0,1].includes(s.axis??0))throw Error('Invalid movement segment.');duration+=s.seconds}if(duration>10)throw Error('Test at most ten seconds per route.');const ps=platforms(project.objects);if(ps.length>12000)throw Error('Too much collision geometry for an agent simulation.');const p=newPlayer(project.spawn),path=[];let t=0;for(const s of route)for(let i=0;i<Math.ceil(s.seconds*120);i++){stepPlayer(p,{axis:s.axis||0,jump:!!s.jump,walk:!s.run},ps);t+=1/120;if(i%8===0)path.push({t:+t.toFixed(3),x:+p.x.toFixed(2),y:+p.y.toFixed(2)})}return{seconds:t,end:{x:p.x,y:p.y,grounded:p.grounded},path}}
const empty={type:'object',properties:{},additionalProperties:false};
export const agentTools=[
 {name:'get_level',description:'Read level state. Defaults to compact object and asset summaries without image data or movement constants. Use mode full for all project fields.',inputSchema:{type:'object',properties:{mode:{enum:['compact','full'],default:'compact'}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true}},
 {name:'import_image',description:'Upload a PNG data URL into the shared asset tray. Optionally remove a background color, nearest-neighbor scale, quantize colors and split disconnected pieces. Accepted PNGs are 8-bit, non-interlaced and at most four million pixels.',inputSchema:{type:'object',properties:{revision:{type:'integer',minimum:0},name:{type:'string'},dataUrl:{type:'string',description:'Full data:image/png;base64,... URL of the image.'},removeBackground:{type:'boolean'},backgroundColor:{type:'array',items:{type:'integer',minimum:0,maximum:255},minItems:3,maxItems:3},tolerance:{type:'number',minimum:0,maximum:100},scale:{type:'number',minimum:0.05,maximum:16},split:{type:'boolean'},minArea:{type:'integer',minimum:1,maximum:1000},palette:{type:'integer',minimum:0,maximum:256}},required:['revision','name','dataUrl'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'slice_spritesheet',description:'Cut an imported spritesheet into mathematically exact equal-sized PNG frames in row-major order. No scaling or guessed boundaries.',inputSchema:{type:'object',properties:{revision:{type:'integer',minimum:0},assetId:{type:'string'},columns:{type:'integer',minimum:1,maximum:64},rows:{type:'integer',minimum:1,maximum:64},name:{type:'string'}},required:['revision','assetId','columns','rows'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'create_spritesheet',description:'Combine PNG asset IDs into exact row-major cells, centered horizontally and bottom-aligned. Returns dimensions and ID; set includeImage only when visual inspection is needed.',inputSchema:{type:'object',properties:{revision:{type:'integer',minimum:0},assetIds:{type:'array',minItems:1,maxItems:512,items:{type:'string'}},columns:{type:'integer',minimum:1,maximum:64},cellWidth:{type:'integer',minimum:1,maximum:4096},cellHeight:{type:'integer',minimum:1,maximum:4096},name:{type:'string'},includeImage:{type:'boolean',default:false}},required:['revision','assetIds','columns','cellWidth','cellHeight'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'edit_level',description:'Apply 1–100 operations atomically as one undo step. Returns revision and changed IDs only; set verify to include changed object summaries. Coordinates are native pixels, spawn is Max’s foot position, block/place use width/height, update.changes uses w/h.',inputSchema:{type:'object',properties:{revision:{type:'integer',minimum:0},verify:{type:'boolean',default:false},operations:{type:'array',minItems:1,maxItems:100,items:{type:'object',properties:{type:{enum:['block','stroke','place','update','duplicate','delete','spawn','rename','crop','order']},id:{type:'string'},assetId:{type:'string'},x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'},points:{type:'array',minItems:1,maxItems:1500,items:{type:'object',properties:{x:{type:'number'},y:{type:'number'}},required:['x','y'],additionalProperties:false}},rotation:{type:'number'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$',description:'Block fill color as #RRGGBB'},kind:{enum:['solid','platform','decor']},name:{type:'string'},dx:{type:'number'},dy:{type:'number'},ids:{type:'array',items:{type:'string'}},direction:{enum:['front','back','forward','backward']},reset:{type:'boolean'},rect:{type:'object',description:'Crop in local displayed pixels',properties:{x:{type:'number'},y:{type:'number'},w:{type:'number',minimum:1},h:{type:'number',minimum:1}},required:['x','y','w','h'],additionalProperties:false},changes:{type:'object',description:'x,y,w,h,rotation,kind,inset,flip,name,locked,opacity (0–1),color (#RRGGBB), adjust {hue,saturation,brightness,black,white}' }},required:['type'],additionalProperties:false}}},required:['revision','operations'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'undo_level',description:'Undo the latest shared human or agent edit. Supply the current revision.',inputSchema:{type:'object',properties:{revision:{type:'integer',minimum:0}},required:['revision'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'get_asset_image',description:'Inspect a PNG asset before placing it.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true}},
 {name:'simulate_player',description:'Test a route with the same Max movement and collisions used in the editor. Returns sampled positions and landing state. No level changes.',inputSchema:{type:'object',properties:{route:{type:'array',maxItems:60,items:{type:'object',properties:{seconds:{type:'number',exclusiveMinimum:0,maximum:10},axis:{enum:[-1,0,1]},jump:{type:'boolean'},run:{type:'boolean'}},required:['seconds'],additionalProperties:false}}},required:['route'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_canvas_preview',description:'Read the latest canvas screenshot from the connected editor. Check the returned revision and capture time for freshness.',inputSchema:empty,annotations:{readOnlyHint:true,untrustedContentHint:true}},
 {name:'set_play_mode',description:'Start or stop Max playtesting in the connected editor.',inputSchema:{type:'object',properties:{playing:{type:'boolean'}},required:['playing'],additionalProperties:false},annotations:{readOnlyHint:false}}
];
