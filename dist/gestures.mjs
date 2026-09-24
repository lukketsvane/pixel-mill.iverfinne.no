import {clamp,rotate,radians,screenToWorld,worldToScreen,localToWorld,worldToLocal,contains,zoomAt,anchorCamera,resizeFromCorner,snapObject,TwoFingerTransform} from './geometry.mjs';
const snapped=(v,n)=>Math.round(v/n)*n;
export function installGestures(canvas,api,pointers=new Map()){
 let gesture=null,longPress=null;const types=new Map();
 const clearPress=()=>{clearTimeout(longPress);longPress=null};
 const publish=()=>api.preview(gesture);
 const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
 const hit=p=>[...api.get().state.objects].reverse().find(o=>contains(o,p));
 function release(){const ids=[...pointers.keys()];pointers.clear();types.clear();for(const id of ids){try{canvas.releasePointerCapture?.(id)}catch{}}}
 function cancel(){clearPress();const before=gesture?.before;if(gesture?.type==='mask')api.cancelMask?.();gesture=null;release();if(before)api.rollback(before);publish();api.refresh()}
 function beginPair(){
  clearPress();const s=api.get(),ids=[...pointers.keys()].slice(0,2),a=pointers.get(ids[0]),b=pointers.get(ids[1]);
  const object=gesture?.object;
  if(object){gesture={type:'transform',object,before:gesture.before,multi:true,ids,transform:new TwoFingerTransform(object,a,b,'object',s.camera,{free:ids.every(id=>types.get(id)==='touch')})}}
  else{if(gesture?.before)api.rollback(gesture.before);gesture={type:'camera',multi:true,ids,transform:new TwoFingerTransform(s.camera,a,b,'camera')}}
  publish();
 }
 function continueOne(){const s=api.get(),[id,p]=[...pointers.entries()][0];
  if(gesture.object)gesture={type:'move',object:gesture.object,before:gesture.before,multi:true,id,start:screenToWorld(p,s.camera),original:{...gesture.object}};
  else gesture={type:'pan',multi:true,id,p,c:{...s.camera}};
  publish();
 }
 function down(e){const s=api.get();if(s.playing||e.pointerType==='mouse'&&e.button!==0&&e.button!==1)return;e.preventDefault();canvas.focus({preventScroll:true});try{canvas.setPointerCapture(e.pointerId)}catch{}const p=point(e);pointers.set(e.pointerId,p);types.set(e.pointerId,e.pointerType);if(pointers.size===2){beginPair();return}if(pointers.size>2)return;
  api.closePanels();const world=screenToWorld(p,s.camera),before=api.snapshot();
  if(s.crop&&s.selected&&!s.selected.locked){const local=worldToLocal(world,s.selected);local.x=clamp(local.x,0,s.selected.w);local.y=clamp(local.y,0,s.selected.h);gesture={type:'crop',id:e.pointerId,before,object:s.selected,start:local,end:local}}
  else if(s.tool==='pan'||e.button===1||s.keys.has('Space'))gesture={type:'pan',id:e.pointerId,p,c:{...s.camera}};
  else if(s.tool==='block')gesture={type:'block',id:e.pointerId,start:world,end:world};
  else if(s.tool==='collision')gesture={type:'collision',id:e.pointerId,points:[world]};
  else if(s.tool==='mask'){const target=hit(world);if(target?.asset&&!target.locked&&api.beginMask?.(target)){api.select(target.id);gesture={type:'mask',id:e.pointerId,object:target,before,points:[world]};api.paintMask(world,world)}else{api.noMask?.();gesture={type:'pan',id:e.pointerId,p,c:{...s.camera}}}}
  else if(s.tool==='spawn'){gesture={type:'spawn',id:e.pointerId,before};s.state.spawn={x:world.x,y:world.y}}
  else if(s.tool==='stamp')gesture={type:'stamp',id:e.pointerId,start:p,world};
  else{
   const o=s.selected,handle=o&&worldToScreen(localToWorld({x:o.w,y:o.h},o),s.camera);
   if(handle&&!o.locked&&Math.hypot(p.x-handle.x,p.y-handle.y)<18){gesture={type:'resize',id:e.pointerId,before,object:o,start:worldToLocal(world,o),original:{...o}}}
   else if(Math.abs(world.x-s.state.spawn.x)<Math.max(8,16/s.camera.z)&&world.y>s.state.spawn.y-32&&world.y<s.state.spawn.y+4){api.select(null);gesture={type:'spawn',id:e.pointerId,before}}
   else{const found=hit(world);api.select(found?.id||null);gesture=found&&!found.locked?{type:'move',id:e.pointerId,before,object:found,start:world,original:{...found}}:{type:'pan',id:e.pointerId,p,c:{...s.camera}}}
  }
  const target=gesture.object||hit(world);if(target&&!s.crop&&e.button!==1&&!['mask','collision'].includes(s.tool)){const id=target.id,position={...p};longPress=setTimeout(()=>{if(pointers.size!==1)return;cancel();api.context?.(id,position)},450)}
  publish();api.refresh();
 }
 function move(e){const p=point(e),s=api.get();api.hover(screenToWorld(p,s.camera));if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();if(Math.hypot(p.x-pointers.get(e.pointerId).x,p.y-pointers.get(e.pointerId).y)>0){const start=gesture.pressStart||pointers.get(e.pointerId);gesture.pressStart=start;if(Math.hypot(p.x-start.x,p.y-start.y)>6)clearPress()}pointers.set(e.pointerId,p);const g=gesture,world=screenToWorld(p,s.camera);
  if(g.ids){if(g.ids.includes(e.pointerId))g.transform.update(pointers.get(g.ids[0]),pointers.get(g.ids[1]));api.viewChanged();return}
  if(e.pointerId!==g.id)return;
  if(g.type==='pan'){const start=screenToWorld(g.p,g.c);anchorCamera(s.camera,start,p)}
  else if(g.type==='move'){g.object.x=g.original.x+world.x-g.start.x;g.object.y=g.original.y+world.y-g.start.y}
  else if(g.type==='resize'){
   const local=worldToLocal(world,g.original),rawW=g.original.w+local.x-g.start.x,rawH=g.original.h+local.y-g.start.y,scale=clamp((rawW*g.original.w+rawH*g.original.h)/(g.original.w**2+g.original.h**2),Math.max(1/g.original.w,1/g.original.h),Math.min(8192/g.original.w,8192/g.original.h));Object.assign(g.object,g.original);resizeFromCorner(g.object,g.original.w*scale,g.original.h*scale);
  }else if(g.type==='crop'){const local=worldToLocal(world,g.object);g.end={x:clamp(local.x,0,g.object.w),y:clamp(local.y,0,g.object.h)}}else if(g.type==='spawn')s.state.spawn={x:world.x,y:world.y};else if(g.type==='block')g.end=world;else if(g.type==='collision'){const last=g.points.at(-1);if(Math.hypot(world.x-last.x,world.y-last.y)>=1&&g.points.length<1500)g.points.push(world)}else if(g.type==='mask'){const last=g.points.at(-1);api.paintMask(last,world);g.points.push(world)}
 }
 function up(e){clearPress();if(!pointers.has(e.pointerId))return;const tracked=gesture?.ids?.includes(e.pointerId);if(!gesture?.ids&&gesture?.type!=='stamp')move(e);pointers.delete(e.pointerId);types.delete(e.pointerId);if(!gesture)return;
  if(pointers.size){if(tracked){if(pointers.size>=2)beginPair();else continueOne()}return}
  const g=gesture,s=api.get();gesture=null;publish();
  if(g.type==='crop'){const a=g.start,b=g.end;api.crop?.({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)})}
  else if(g.type==='block'){const a=g.start,b=g.end;if(Math.hypot(a.x-b.x,a.y-b.y)*s.camera.z>5)api.addBlock(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y))}
  else if(g.type==='collision')api.addCollision(g.points);
  else if(g.type==='mask')api.finishMask(g.before);
  else if(g.type==='stamp'){const p=point(e);if(Math.hypot(p.x-g.start.x,p.y-g.start.y)<15)api.place(g.world.x,g.world.y)}
  else if(g.before){if(g.object&&JSON.stringify(g.before)!==JSON.stringify(api.snapshot()))snapObject(g.object,s.grid,{dimensions:!!g.multi});if(g.type==='spawn'){s.state.spawn.x=snapped(s.state.spawn.x,s.grid);s.state.spawn.y=snapped(s.state.spawn.y,s.grid)}if(JSON.stringify(g.before)!==JSON.stringify(api.snapshot()))api.commit(g.before)}
  api.refresh();
 }
 canvas.addEventListener('pointerdown',down,{passive:false});canvas.addEventListener('pointermove',move,{passive:false});canvas.addEventListener('pointerup',up,{passive:false});
 canvas.addEventListener('pointercancel',e=>{if(pointers.has(e.pointerId))cancel()});canvas.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))cancel()});canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(api.get().playing)return;const p=point(e),target=hit(screenToWorld(p,api.get().camera));cancel();if(target)api.context?.(target.id,p)});
 canvas.addEventListener('wheel',e=>{e.preventDefault();const s=api.get();if(s.playing||pointers.size)return;if(e.ctrlKey||e.metaKey||e.altKey)zoomAt(s.camera,point(e),s.camera.z*Math.exp(-e.deltaY*(e.altKey?.004:.012)));else{const delta=rotate({x:e.deltaX/s.camera.z,y:e.deltaY/s.camera.z},-(s.camera.rotation||0));s.camera.x+=delta.x;s.camera.y+=delta.y}api.viewChanged()},{passive:false});
 return{cancel,active:()=>!!gesture};
}
