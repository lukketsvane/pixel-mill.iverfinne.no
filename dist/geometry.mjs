export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const radians=degrees=>degrees*Math.PI/180;
export const degrees=angle=>angle*180/Math.PI;
export const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
export function rotate(p,a){const c=Math.cos(a),s=Math.sin(a);return{x:p.x*c-p.y*s,y:p.x*s+p.y*c}}
export function screenToWorld(p,c){const v=rotate({x:p.x/c.z,y:p.y/c.z},-(c.rotation||0));return{x:c.x+v.x,y:c.y+v.y}}
export function worldToScreen(p,c){const v=rotate({x:p.x-c.x,y:p.y-c.y},c.rotation||0);return{x:v.x*c.z,y:v.y*c.z}}
export function anchorCamera(c,world,screen){const v=rotate({x:screen.x/c.z,y:screen.y/c.z},-(c.rotation||0));c.x=world.x-v.x;c.y=world.y-v.y;return c}
export function zoomAt(c,p,z){const world=screenToWorld(p,c);c.z=clamp(z,.25,12);return anchorCamera(c,world,p)}
export function localToWorld(p,o){const v=rotate({x:p.x-o.w/2,y:p.y-o.h/2},radians(o.rotation||0));return{x:o.x+o.w/2+v.x,y:o.y+o.h/2+v.y}}
export function worldToLocal(p,o){const v=rotate({x:p.x-o.x-o.w/2,y:p.y-o.y-o.h/2},-radians(o.rotation||0));return{x:v.x+o.w/2,y:v.y+o.h/2}}
export function contains(o,p,padding=0){const q=worldToLocal(p,o);return q.x>=-padding&&q.x<=o.w+padding&&q.y>=-padding&&q.y<=o.h+padding}
export function pointBounds(points){const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return{x,y,w:Math.max(...points.map(p=>p.x))-x,h:Math.max(...points.map(p=>p.y))-y}}
export function objectCorners(o,inset=0){return[{x:0,y:inset},{x:o.w,y:inset},{x:o.w,y:o.h},{x:0,y:o.h}].map(p=>localToWorld(p,o))}
export const objectBounds=o=>pointBounds(objectCorners(o));
export function applyObjectTransform(ctx,o){ctx.translate(o.x+o.w/2,o.y+o.h/2);ctx.rotate(radians(o.rotation||0));ctx.translate(-o.w/2,-o.h/2)}
const adjustedImages=new WeakMap();
const adjustedColors=new Map();
function adjustedColor(color,adjust){if(!adjust)return color;const key=color+JSON.stringify(adjust);if(adjustedColors.has(key))return adjustedColors.get(key);const pixel=document.createElement('canvas');pixel.width=pixel.height=1;const ctx=pixel.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const transformed=adjustedImage(pixel,adjust).getContext('2d').getImageData(0,0,1,1).data;const result='#'+[transformed[0],transformed[1],transformed[2]].map(n=>n.toString(16).padStart(2,'0')).join('');adjustedColors.set(key,result);if(adjustedColors.size>256)adjustedColors.delete(adjustedColors.keys().next().value);return result}
export function adjustedImage(image,adjust){if(!image||!adjust||Object.entries(adjust).every(([k,v])=>v===(k==='white'?255:0)))return image;
 const key=JSON.stringify(adjust),cache=adjustedImages.get(image)||new Map();if(cache.has(key))return cache.get(key);
 const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);const frame=c.getImageData(0,0,w,h),d=frame.data,black=adjust.black??0,white=Math.max(black+1,adjust.white??255),shift=(adjust.hue||0)/360,saturation=(adjust.saturation||0)/100,brightness=(adjust.brightness||0)/100;
 for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;let r=clamp((d[i]-black)/(white-black),0,1),g=clamp((d[i+1]-black)/(white-black),0,1),b=clamp((d[i+2]-black)/(white-black),0,1),hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo,hue=0;if(delta){hue=hi===r?((g-b)/delta)%6:hi===g?(b-r)/delta+2:(r-g)/delta+4;hue/=6}let sat=hi===0?0:delta/hi;sat=clamp(saturation<0?sat*(1+saturation):sat+(1-sat)*saturation,0,1);const value=clamp(hi+brightness,0,1),q=(n)=>{const k=((n+(hue+shift)*6)%6+6)%6;return Math.round((value-value*sat*Math.max(0,Math.min(k,4-k,1)))*255)};d[i]=q(5);d[i+1]=q(3);d[i+2]=q(1)}c.putImageData(frame,0,0);cache.set(key,canvas);if(cache.size>8)cache.delete(cache.keys().next().value);adjustedImages.set(image,cache);return canvas}
const artworkTileImages=new WeakMap();
function artworkRepeat(ctx,image,source,w,h){if(typeof ctx.createPattern!=='function')return false;let cache=artworkTileImages.get(image);if(!cache){cache=new Map();artworkTileImages.set(image,cache)}const key=[source.x,source.y,source.w,source.h].join(',');let tile=cache.get(key);if(!tile){if(typeof OffscreenCanvas!=='undefined')tile=new OffscreenCanvas(source.w,source.h);else if(typeof document!=='undefined'){tile=document.createElement('canvas');tile.width=source.w;tile.height=source.h}else return false;tile.getContext('2d').drawImage(image,source.x,source.y,source.w,source.h,0,0,source.w,source.h);cache.set(key,tile);if(cache.size>32)cache.delete(cache.keys().next().value)}const pattern=ctx.createPattern(tile,'repeat');if(!pattern)return false;ctx.fillStyle=pattern;ctx.fillRect(0,0,w,h);return true}
// Draw treatment inside the authored shape. Atlas coordinates use the request's
// original world frame even for rotated pieces, then follow later object moves.
function drawArtwork(ctx,o,image){
 const a=o.artwork;ctx.beginPath();ctx.rect(0,0,o.w,o.h);ctx.clip();ctx.imageSmoothingEnabled=false;
 if(a.mode==='atlas'){const t=a.transform,b=a.bounds;if(!!o.flip!==!!t.flip){ctx.translate(o.w,0);ctx.scale(-1,1)}ctx.scale(o.w/t.w,o.h/t.h);ctx.translate(t.w/2,t.h/2);ctx.rotate(-radians(t.rotation||0));ctx.translate(-t.x-t.w/2,-t.y-t.h/2);ctx.drawImage(image,b.x,b.y,b.w,b.h);return}
 if(o.flip){ctx.translate(o.w,0);ctx.scale(-1,1)}const s=a.source;
 if(a.mode==='stretch'){ctx.drawImage(image,s.x,s.y,s.w,s.h,0,0,o.w,o.h);return}
 if(a.mode==='tile'){if(artworkRepeat(ctx,image,s,o.w,o.h))return;for(let y=0;y<o.h;y+=s.h)for(let x=0;x<o.w;x+=s.w){const w=Math.min(s.w,o.w-x),h=Math.min(s.h,o.h-y);ctx.drawImage(image,s.x,s.y,w,h,x,y,w,h)}return}
 const tile=a.tileSize,cols=Math.ceil(o.w/tile),rows=Math.ceil(o.h/tile),joined=(side,position)=>(a.joins?.[side]||[]).some(([lo,hi])=>position>=lo&&position<=hi);
 const drawCell=(row,col)=>{const x=col*tile,y=row*tile,w=Math.min(tile,o.w-x),h=Math.min(tile,o.h-y),cx=x+w/2,cy=y+h/2,left=col===0&&!joined('left',cy),right=col===cols-1&&!joined('right',cy),top=row===0&&!joined('top',cx),bottom=row===rows-1&&!joined('bottom',cx),sx=left?0:right?2:1,sy=top?0:bottom?2:1;ctx.drawImage(image,s.x+sx*tile+(right&&!left?tile-w:0),s.y+sy*tile+(bottom&&!top?tile-h:0),w,h,x,y,w,h)};
 // Fill the repeated middle once, then draw only the perimeter cells. Large
 // terrain shapes cost perimeter work rather than one draw per square pixel.
 if(artworkRepeat(ctx,image,{x:s.x+tile,y:s.y+tile,w:tile,h:tile},o.w,o.h)){for(let col=0;col<cols;col++){drawCell(0,col);if(rows>1)drawCell(rows-1,col)}for(let row=1;row<rows-1;row++){drawCell(row,0);if(cols>1)drawCell(row,cols-1)}}else for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)drawCell(row,col);
}
export function drawObject(ctx,o,image,{alpha=1,fill='#fff',stroke=null,lineWidth=1}={}){if(o.collisionOnly)return;ctx.save();ctx.globalAlpha=alpha*(o.opacity??1);applyObjectTransform(ctx,o);if(image){image=adjustedImage(image,o.adjust);if(o.artwork)drawArtwork(ctx,o,image);else{if(o.flip){ctx.translate(o.w,0);ctx.scale(-1,1)}const crop=o.crop||{x:0,y:0,w:1,h:1},w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;ctx.drawImage(image,crop.x*w,crop.y*h,crop.w*w,crop.h*h,0,0,o.w,o.h)}}else{ctx.fillStyle=adjustedColor(o.color||fill,o.adjust);ctx.fillRect(0,0,o.w,o.h);if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.strokeRect(0,0,o.w,o.h)}}ctx.restore()}

export function resizeFromCorner(o,w,h){const corner=localToWorld({x:0,y:0},o),offset=rotate({x:w/2,y:h/2},radians(o.rotation||0));o.inset=clamp((o.inset||0)*h/o.h,0,h-1);Object.assign(o,{x:corner.x+offset.x-w/2,y:corner.y+offset.y-h/2,w,h});return o}
export function snapObject(o,grid=1,{dimensions=false}={}){if(o.locked)return o;grid=[1,4,8,16].includes(grid)?grid:1;if(dimensions){o.w=clamp(Math.round(o.w),1,8192);o.h=clamp(Math.round(o.h),1,8192)}o.x=Math.round(o.x/grid)*grid;o.y=Math.round(o.y/grid)*grid;o.inset=clamp(Math.round(o.inset||0),0,o.h-1);o.rotation=Math.round((o.rotation||0)/5)*5;return o}
export function cropObject(o,rect){if(o.locked)throw Error('Unlock the piece before cropping.');const r={x:clamp(rect.x,0,o.w),y:clamp(rect.y,0,o.h)};r.w=Math.min(rect.w,o.w-r.x);r.h=Math.min(rect.h,o.h-r.y);if(r.w<1||r.h<1)throw Error('Crop must be at least one pixel.');const old=o.crop||{x:0,y:0,w:1,h:1},center=localToWorld({x:r.x+r.w/2,y:r.y+r.h/2},o);o.crop={x:old.x+(o.flip?(o.w-r.x-r.w):r.x)/o.w*old.w,y:old.y+r.y/o.h*old.h,w:r.w/o.w*old.w,h:r.h/o.h*old.h};o.inset=clamp(o.inset-r.y,0,r.h-1);Object.assign(o,{x:center.x-r.w/2,y:center.y-r.h/2,w:r.w,h:r.h});return o}
export function resetCrop(o){if(o.locked)throw Error('Unlock the piece before cropping.');if(!o.crop)return o;const c=o.crop,w=o.w/c.w,h=o.h/c.h;if(w>8192||h>8192)throw Error('Uncropped piece exceeds 8192 pixels.');const center=localToWorld({x:-(o.flip?1-c.x-c.w:c.x)*w+w/2,y:-c.y*h+h/2},o);o.inset=clamp(o.inset+c.y*h,0,h-1);Object.assign(o,{x:center.x-w/2,y:center.y-h/2,w,h,crop:null});return o}
const pair=(a,b)=>({center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x)});
// A transform is rebased whenever the tracked fingers change. Finger identity is
// stable; angle deltas unwrap at ±π. A short baseline never divides by zero.
export class TwoFingerTransform{
 constructor(target,a,b,kind='object',camera,options={}){this.target=target;this.base={...target};this.kind=kind;this.camera=camera;this.start=pair(a,b);this.previousAngle=this.start.angle;this.turn=0;this.ready=this.start.distance>=8;this.anchor=kind==='camera'?screenToWorld(this.start.center,target):screenToWorld(this.start.center,camera);this.axes='both';if(kind==='object'&&options.free){const v=rotate({x:b.x-a.x,y:b.y-a.y},-(camera.rotation||0)-radians(target.rotation||0));this.axes=Math.abs(v.x)>Math.abs(v.y)*2?'x':Math.abs(v.y)>Math.abs(v.x)*2?'y':'both'}}
 update(a,b){const now=pair(a,b);if(now.distance<8){this.ready=false;this.base={...this.target};this.turn=0;return}
  if(!this.ready){this.start=now;this.previousAngle=now.angle;this.ready=true;this.anchor=screenToWorld(now.center,this.kind==='camera'?this.target:this.camera);return}
  this.turn+=wrap(now.angle-this.previousAngle);this.previousAngle=now.angle;
  if(this.kind==='camera'){this.target.z=clamp(this.base.z*now.distance/this.start.distance,.25,12);this.target.rotation=0;anchorCamera(this.target,this.anchor,now.center);return}
  const b0=this.base,ratio=now.distance/this.start.distance,scale=clamp(ratio,Math.max(1/b0.w,1/b0.h),Math.min(8192/b0.w,8192/b0.h)),sx=this.axes==='y'?1:this.axes==='x'?clamp(ratio,1/b0.w,8192/b0.w):scale,sy=this.axes==='x'?1:this.axes==='y'?clamp(ratio,1/b0.h,8192/b0.h):scale,mid=screenToWorld(now.center,this.camera),local=worldToLocal(this.anchor,b0);
  const angle=radians(Math.round(degrees(wrap(radians(b0.rotation||0)+this.turn))/5)*5),offset=rotate({x:(b0.w/2-local.x)*sx,y:(b0.h/2-local.y)*sy},angle);
  this.target.w=b0.w*sx;this.target.h=b0.h*sy;this.target.x=mid.x+offset.x-this.target.w/2;this.target.y=mid.y+offset.y-this.target.h/2;this.target.rotation=degrees(angle);this.target.inset=clamp((b0.inset||0)*sy,0,this.target.h-1);
 }
}
