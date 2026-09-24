// Pointer capture lets a small number field scrub beyond its visible bounds.
// A tap still opens the native keyboard; a drag never focuses the field.
export function installNumberScrub(fields,api={}){
 let active=null;
 const read=(field,key,fallback)=>field[key]!==''&&field[key]!=null&&Number.isFinite(Number(field[key]))?Number(field[key]):fallback;
 const stop=(cancelled=false)=>{
  const g=active;if(!g)return;active=null;
  g.field.classList.toggle('scrubbing',false);
  try{g.field.releasePointerCapture(g.id)}catch{}
  if(g.dragging){if(cancelled){g.field.value=g.original;api.cancel?.(g.field)}else api.commit?.(g.field)}
 };
 for(const field of fields){
  let suppressClick=0;
  field.setAttribute('aria-description','Drag left or right to adjust. Tap to type.');
  field.setAttribute('inputmode','decimal');
  field.addEventListener('pointerdown',e=>{
   if(field.disabled||field.readOnly||e.button!==0)return;
   if(active){stop(true);return}
   if(e.isPrimary===false)return;
   e.preventDefault();e.stopPropagation();suppressClick=Date.now()+1000;
   active={field,id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,remainder:0,original:field.value,value:read(field,'value',0),dragging:false};
   try{field.setPointerCapture(e.pointerId)}catch{}
  },{passive:false});
  const move=e=>{
   const g=active;if(!g||g.field!==field||g.id!==e.pointerId)return;
   e.preventDefault();e.stopPropagation();
   if(!g.dragging){
    const dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(Math.abs(dx)<6){if(Math.abs(dy)>12)stop(true);return}
    if(Math.abs(dy)>Math.abs(dx)*1.5){stop(true);return}
    field.blur();g.value=read(field,'value',g.value);
    if(api.start?.(field)===false){stop(true);return}
    g.dragging=true;field.classList.toggle('scrubbing',true);
   }
   g.remainder+=e.clientX-g.lastX;g.lastX=e.clientX;
   const ticks=Math.trunc(g.remainder/4);if(!ticks)return;g.remainder-=ticks*4;
   const step=read(field,'step',1)>0?read(field,'step',1):1;
   const min=read(field,'min',-Infinity),max=read(field,'max',Infinity);
   const raw=g.value+ticks*step,value=Math.max(min,Math.min(max,Number(raw.toFixed(8))));
   if(value===min||value===max)g.remainder=0;
   if(value!==g.value){g.value=value;field.value=String(value);const actual=api.preview?.(field,value);if(Number.isFinite(actual)){g.value=actual;field.value=String(actual)}}
  };
  field.addEventListener('pointermove',move,{passive:false});
  field.addEventListener('pointerup',e=>{
   const g=active;if(!g||g.field!==field||g.id!==e.pointerId)return;
   move(e);if(!active)return;const tap=!g.dragging;
   e.preventDefault();e.stopPropagation();suppressClick=Date.now()+1000;stop();
   if(tap){field.focus({preventScroll:true});try{field.select()}catch{}}
  },{passive:false});
  for(const type of ['pointercancel','lostpointercapture'])field.addEventListener(type,e=>{if(active?.field===field&&active.id===e.pointerId)stop(true)});
  field.addEventListener('click',e=>{if(e.detail!==0&&Date.now()<suppressClick){e.preventDefault();e.stopPropagation()}},true);
  field.addEventListener('keydown',e=>{if(e.key==='Escape')stop(true)});
 }
 return{cancel:()=>stop(true),active:()=>!!active};
}
