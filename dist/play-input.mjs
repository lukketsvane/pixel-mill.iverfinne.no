// Relative steering, floating 76px origin, swipe thresholds and flick timing
// ported from max.iverfinne.no. No on-screen joystick or movement buttons.
export class MaxTouchInput{
 constructor(){this.reset()}
 reset(){this.touches=new Map();this.moveId=null;this.jump=false;this.dodge=0;this.exitCandidate=null}
 down(id,x,y,time){this.touches.set(id,{x,y,x0:x,y0:y,ax:x,gx:x,gy:y,travelX:0,t0:time,j:false,jumped:false,jumpY:y,low:false,dragged:false});if(this.moveId===null)this.moveId=id;if(this.touches.size===2&&!this.exitCandidate){const values=[...this.touches.values()];if(values.every(t=>!t.dragged)&&time-Math.min(...values.map(t=>t.t0))<240)this.exitCandidate={ids:new Set(this.touches.keys()),time:Math.min(...values.map(t=>t.t0)),valid:true}}if(this.touches.size>2&&this.exitCandidate)this.exitCandidate.valid=false}
 move(id,x,y){const t=this.touches.get(id);if(!t)return;t.travelX+=Math.abs(x-t.x);t.x=x;t.y=y;t.ax=Math.max(x-76,Math.min(x+76,t.ax));let dx=x-t.gx,dy=y-t.gy;if(Math.abs(dx)>12||Math.abs(dy)>12)t.dragged=true;if(this.exitCandidate&&t.dragged)this.exitCandidate.valid=false;
  if(t.j){t.jumpY=Math.min(t.jumpY,y);if(y-t.jumpY>=18){t.j=false;t.gx=x;t.gy=y;dx=dy=0}}
  if(!t.j&&dy<-24&&-dy>Math.abs(dx)*1.2){t.j=true;t.jumped=true;t.jumpY=y;t.low=false;this.jump=true}
  if(!t.jumped&&dy>26&&dy>Math.abs(dx)*1.2)t.low=true;else if(t.low&&Math.abs(dx)>18&&Math.abs(dx)>Math.abs(dy)){t.low=false;t.ax=x-(dx<0?-18:18)}
  if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.2){t.gx=x;t.gy=y}
 }
 up(id,x,y,time,cancel=false){const t=this.touches.get(id);if(!t)return false;if(cancel){this.reset();return false}const dx=x-t.x0,dy=y-t.y0;if(this.moveId===id&&!t.jumped&&!t.low&&t.dragged&&time-t.t0<=180&&Math.abs(dx)>=44&&Math.abs(dx)>Math.abs(dy)*2&&Math.abs(dx)>=t.travelX*.8)this.dodge=dx<0?-1:1;this.touches.delete(id);if(this.moveId===id)this.moveId=this.touches.keys().next().value??null;
  if(this.exitCandidate?.ids.has(id))this.exitCandidate.ids.delete(id);const exit=!!this.exitCandidate&&this.exitCandidate.ids.size===0&&this.exitCandidate.valid&&time-this.exitCandidate.time<240;if(!this.touches.size)this.exitCandidate=null;return exit;
 }
 read(keys){let axis=Number(keys.has('ArrowRight')||keys.has('KeyD'))-Number(keys.has('ArrowLeft')||keys.has('KeyA')),top=keys.has('ShiftLeft')||keys.has('ShiftRight')?88:48;if(!axis){const t=this.touches.get(this.moveId);if(t&&!t.low){const dx=t.x-t.ax,mag=Math.abs(dx);if(mag>12){axis=dx<0?-1:1;top=48+40*Math.min(1,(mag-12)/64)}}}const jump=keys.has('ArrowUp')||keys.has('KeyW');const result={axis,top,walk:top<68,jump,jumpPressed:this.jump,variableJump:!this.jump,dodge:this.dodge,crouch:keys.has('ArrowDown')||keys.has('KeyS')||keys.has('Space')||[...this.touches.values()].some(t=>t.low)};this.jump=false;this.dodge=0;return result}
}
export function installPlayInput(canvas,api){const controls=new MaxTouchInput();
 canvas.addEventListener('pointerdown',e=>{if(!api.playing()||e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();try{canvas.setPointerCapture(e.pointerId)}catch{}controls.down(e.pointerId,e.clientX,e.clientY,performance.now())},{passive:false});
 canvas.addEventListener('pointermove',e=>{if(!controls.touches.has(e.pointerId))return;e.preventDefault();controls.move(e.pointerId,e.clientX,e.clientY)},{passive:false});
 canvas.addEventListener('pointerup',e=>{if(controls.up(e.pointerId,e.clientX,e.clientY,performance.now())){controls.reset();api.exit()}});
 for(const type of ['pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(controls.touches.has(e.pointerId))controls.reset()});return controls;
}
