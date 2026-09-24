export function installAssetTray(handle,api){
 let drag=null;
 const nearest=(height)=>[1,2,4].reduce((best,n)=>Math.abs(api.height(n)-height)<Math.abs(api.height(best)-height)?n:best,1);
 const finish=(cancel=false)=>{if(!drag)return;const g=drag;drag=null;api.setRows(cancel?g.rows:nearest(g.height));try{handle.releasePointerCapture(g.id)}catch{}};
 handle.addEventListener('pointerdown',e=>{if(e.button!==0||e.isPrimary===false)return;e.preventDefault();const rows=api.rows();drag={id:e.pointerId,y:e.clientY,rows,start:api.height(rows),height:api.height(rows)};try{handle.setPointerCapture(e.pointerId)}catch{}},{passive:false});
 handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();drag.height=Math.max(api.height(1),Math.min(api.height(4),drag.start+drag.y-e.clientY));api.preview(drag.height)},{passive:false});
 handle.addEventListener('pointerup',e=>{if(drag?.id!==e.pointerId)return;e.preventDefault();finish()});
 for(const type of ['pointercancel','lostpointercapture'])handle.addEventListener(type,e=>{if(drag?.id===e.pointerId)finish(true)});
 handle.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const rows=[1,2,4],index=rows.indexOf(api.rows());api.setRows(e.key==='Home'?1:e.key==='End'?4:rows[Math.max(0,Math.min(2,index+(e.key==='ArrowUp'?1:-1)))])});
 return{cancel:()=>finish(true)};
}
