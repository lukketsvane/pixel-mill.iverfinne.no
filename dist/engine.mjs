import {clamp,objectBounds,objectCorners,radians,degrees,wrap} from './geometry.mjs';
import {validBlockColor} from './color.mjs';
export {clamp,screenToWorld,zoomAt} from './geometry.mjs';
// Max movement values and 8 × 18 collision body from lukketsvane/max.iverfinne.no.
export const MOVE = { walk:48, run:88, gravity:430, jump:-154, acceleration:720, brake:980, friction:1100 };
export const snap=(v,grid)=>Math.round(v/grid)*grid;
export function bounds(objects,spawn){const xs=[spawn.x-20],ys=[spawn.y-36],rs=[spawn.x+20],bs=[spawn.y+12];for(const o of objects){const b=objectBounds(o);xs.push(b.x);ys.push(b.y);rs.push(b.x+b.w);bs.push(b.y+b.h)}const x=Math.min(...xs),y=Math.min(...ys);return{x,y,w:Math.max(...rs)-x,h:Math.max(...bs)-y}}
export function platforms(objects){
 const result=[];
 for(const o of objects){if(o.kind==='decor')continue;
  if(o.collisionOnly){const radius=o.brushWidth/2,pts=o.points.map(p=>({x:o.x+p.x,y:o.y+p.y}));for(let i=0;i<pts.length;i++){const a=pts[Math.max(0,i-1)],b=pts[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,radius)));for(let k=0;k<=steps;k++){const x=a.x+(b.x-a.x)*k/steps,y=a.y+(b.y-a.y)*k/steps;result.push({id:o.id,x:x-radius,y:y-radius,w:o.brushWidth,h:o.brushWidth,solid:true})}}continue}
  if(Math.abs(wrap(radians(o.rotation||0)))<1e-8){result.push({id:o.id,x:o.x,y:o.y+o.inset,w:o.w,h:Math.max(1,o.h-o.inset),solid:o.kind==='solid'});continue}
  const points=objectCorners(o,o.inset),solid=o.kind==='solid',edge=solid?points:points.slice(0,2),left=Math.min(...edge.map(p=>p.x)),right=Math.max(...edge.map(p=>p.x));
  // Native one-pixel collision columns follow the rotated outline, rather than
  // letting Max stand on an invisible axis-aligned bounding box.
  for(let x=Math.floor(left);x<Math.ceil(right);x++){
   const l=Math.max(x,left),r=Math.min(x+1,right);if(r-l<1e-8)continue;const sample=(l+r)/2,ys=[];
   for(let i=0;i<(solid?4:1);i++){const a=edge[i],b=edge[(i+1)%edge.length];if(Math.abs(a.x-b.x)<1e-8||sample<Math.min(a.x,b.x)||sample>Math.max(a.x,b.x))continue;ys.push(a.y+(b.y-a.y)*(sample-a.x)/(b.x-a.x))}
   if(!ys.length)continue;const y=Math.min(...ys),h=solid?Math.max(1,Math.max(...ys)-y):1;
   result.push({id:o.id+':'+x,x:l,y,w:r-l,h,solid});
  }
 }
 return result;
}
const inside=(p,x,pad=3)=>x>=p.x-pad&&x<=p.x+p.w+pad;
// Swept landings and solid collision retain Max's foot tolerance and step behavior.
export function landing(ps,x0,y0,x1,y1){if(y1<y0)return null;let best=null,fraction=Infinity;const dy=y1-y0;for(const p of ps){if(p.y<y0-1e-7||p.y>y1+1e-7)continue;const t=dy>1e-8?(p.y-y0)/dy:0,x=x0+(x1-x0)*t;if(t<=1e-7&&!inside(p,x1))continue;if(t<fraction&&inside(p,x)){best=p;fraction=t}}return best}
export function solid(ps,x0,y0,x1,y1){let hit=null;for(const p of ps){if(!p.solid||x1+4<=p.x||x1-4>=p.x+p.w||y1<=p.y+1||y1-18>=p.y+p.h)continue;const r=hit||{x:x1,y:y1};if(y0-18>=p.y+p.h-1e-6){r.y=p.y+p.h+18;r.ceil=true}else if(y0>=p.y-1e-6&&y0-p.y<=6&&y1-p.y<=7){r.y=p.y;r.top=p.id;r.step=true}else if(x0+4<=p.x+1e-6){r.x=p.x-4;r.wall=true}else if(x0-4>=p.x+p.w-1e-6){r.x=p.x+p.w+4;r.wall=true}else if(y0<=p.y+1){r.y=p.y;r.top=p.id}else{r.x=x1<p.x+p.w/2?p.x-4:p.x+p.w+4;r.wall=true}x1=r.x;y1=r.y;hit=r}return hit}
export function newPlayer(spawn){return {...spawn,vx:0,vy:0,face:1,grounded:false,platform:null,coyote:0,buffer:0,wasJump:false,anim:'idle',clock:0}}
const approach=(v,t,d)=>v<t?Math.min(v+d,t):Math.max(v-d,t);
export function stepPlayer(p,input,ps,dt=1/120){
 const axis=clamp(input.axis||0,-1,1),held=!!input.jump;
 if(input.jumpPressed||held&&!p.wasJump){p.buffer=.14;p.bufferVariable=input.variableJump!==false}else p.buffer=Math.max(0,p.buffer-dt);
 p.coyote=p.grounded?.1:Math.max(0,p.coyote-dt);
 p.dodgeTime=Math.max(0,(p.dodgeTime||0)-dt);p.dodgeCool=Math.max(0,(p.dodgeCool||0)-dt);if(input.dodge&&!p.dodgeCool){p.dodgeDir=input.dodge<0?-1:1;p.dodgeTime=.16;p.dodgeCool=.85}
 p.vx=approach(p.vx,axis*(input.top??(input.walk?MOVE.walk:MOVE.run)),(axis?(p.vx*axis<0?MOVE.brake:MOVE.acceleration):MOVE.friction)*dt);
 if(axis)p.face=axis>0?1:-1;if(p.dodgeTime>0){p.face=p.dodgeDir;p.vx=p.dodgeDir*156}
 if(p.buffer>0&&p.coyote>0){p.vy=MOVE.jump;p.grounded=false;p.platform=null;p.coyote=0;p.buffer=0;p.held=p.bufferVariable;p.dodgeTime=0}
 if(!held&&p.held&&p.vy<-52){p.vy=-52;p.held=false}
 p.wasJump=held;const x0=p.x,y0=p.y;p.x+=p.vx*dt;
 if(p.grounded&&!ps.some(s=>s.id===p.platform&&inside(s,p.x))){p.grounded=false;p.platform=null}
 if(!p.grounded){p.vy=Math.min(340,p.vy+MOVE.gravity*dt);p.y+=p.vy*dt}
 const hit=solid(ps,x0,y0,p.x,p.y);
 if(hit){p.x=hit.x;p.y=hit.y;if(hit.wall)p.vx=0;if(hit.ceil)p.vy=Math.max(0,p.vy);if(hit.top){p.vy=0;p.grounded=true;p.platform=hit.top}}
 if(!p.grounded&&p.vy>=0){const floor=landing(ps,x0,y0,p.x,p.y);if(floor){p.y=floor.y;p.vy=0;p.grounded=true;p.platform=floor.id}}
 const anim=!p.grounded?(p.vy<0?'rise':'fall'):Math.abs(p.vx)>2?(input.walk?'walk':'run'):'idle';if(anim!==p.anim){p.anim=anim;p.clock=0}else p.clock+=dt;
 return p;
}
export function validateProject(raw){
 if(!raw||raw.format!=='max-level-studio'||raw.version!==1||!Array.isArray(raw.assets)||!Array.isArray(raw.objects))throw Error('Choose a Max Level Studio project.');
 if(raw.assets.length>2000||raw.objects.length>5000)throw Error('Project is too large.');
 const num=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Invalid project dimensions.');return v};
 const name=v=>String(v||'Untitled').slice(0,80),ids=new Set();
 const assets=raw.assets.map(a=>{if(typeof a.id!=='string'||ids.has(a.id)||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a.src)||a.src.length>24000000)throw Error('Invalid image asset.');ids.add(a.id);return{id:a.id,name:name(a.name),w:num(a.w,1,4096),h:num(a.h,1,4096),src:a.src}});
 const objectIds=new Set();const objects=raw.objects.map(o=>{if(typeof o.id!=='string'||objectIds.has(o.id)||o.asset&&!ids.has(o.asset)||!['solid','platform','decor'].includes(o.kind))throw Error('Invalid level piece.');objectIds.add(o.id);const h=num(o.h,1,8192);let crop=null;if(o.crop){crop={x:num(o.crop.x,0,1),y:num(o.crop.y,0,1),w:num(o.crop.w,1e-6,1),h:num(o.crop.h,1e-6,1)};if(crop.x+crop.w>1+1e-8||crop.y+crop.h>1+1e-8)throw Error('Crop exceeds the image.')}if(o.locked!==undefined&&typeof o.locked!=='boolean')throw Error('Invalid lock.');if(o.color!==undefined&&(o.asset||!validBlockColor(o.color)))throw Error('Invalid block color.');if(o.collisionOnly&&(o.asset||o.kind!=='solid'||!Array.isArray(o.points)||!o.points.length||o.points.length>1500))throw Error('Invalid collision stroke.');const points=o.collisionOnly?o.points.map(p=>({x:num(p.x,0,8192),y:num(p.y,0,8192)})):undefined;let adjust;if(o.adjust){if(!o.asset||typeof o.adjust!=='object')throw Error('Invalid image adjustments.');adjust={hue:num(o.adjust.hue??0,-180,180),saturation:num(o.adjust.saturation??0,-100,100),brightness:num(o.adjust.brightness??0,-100,100),black:num(o.adjust.black??0,0,254),white:num(o.adjust.white??255,1,255)};if(adjust.white<=adjust.black)throw Error('White level must exceed black level.')}return{id:o.id,asset:o.asset||null,name:name(o.name),x:num(o.x,-100000,100000),y:num(o.y,-100000,100000),w:num(o.w,1,8192),h,kind:o.kind,inset:num(o.inset??0,0,h-1),flip:!!o.flip,locked:!!o.locked,opacity:num(o.opacity??1,0,1),crop,rotation:degrees(wrap(radians(num(o.rotation??0,-360000,360000)))),...(o.color?{color:o.color.toLowerCase()}:{}),...(o.collisionOnly?{collisionOnly:true,points,brushWidth:num(o.brushWidth,1,128)}:{}),...(adjust?{adjust}:{})}});
 if(!raw.spawn)throw Error('Missing Max spawn.');return{format:'max-level-studio',version:1,name:name(raw.name),assets,objects,spawn:{x:num(raw.spawn.x,-100000,100000),y:num(raw.spawn.y,-100000,100000)}};
}
