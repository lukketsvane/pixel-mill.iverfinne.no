import {findParts} from './pixel-core.mjs';

// Recognition uses a foreground mask only for finding boundaries. It never
// removes a background, changes source pixels, or recenters a pose.
const recognitionMedian=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]||0;
function recognitionMask({pixels,w,h}){
 let transparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]<16)transparent++;
 let background=null,tolerance=0;
 if(transparent<w*h*.01){
  const border=[];const add=(x,y)=>{const p=(y*w+x)*4;if(pixels[p+3]>127)border.push([pixels[p],pixels[p+1],pixels[p+2]])};
  const step=Math.max(1,Math.floor(Math.max(w,h)/400));for(let x=0;x<w;x+=step){add(x,0);add(x,h-1)}for(let y=0;y<h;y+=step){add(0,y);add(w-1,y)}
  if(border.length){const color=[0,1,2].map(c=>recognitionMedian(border.map(p=>p[c]))),distances=border.map(p=>Math.max(...p.map((v,c)=>Math.abs(v-color[c])))).sort((a,b)=>a-b),spread=distances[Math.floor(distances.length*.95)];if(spread<=35){background=color;tolerance=Math.max(20,Math.min(48,spread+10))}}
 }
 const mask=new Uint8Array(w*h);for(let p=0;p<mask.length;p++){const i=p*4;mask[p]=pixels[i+3]>0&&(!background||Math.max(Math.abs(pixels[i]-background[0]),Math.abs(pixels[i+1]-background[1]),Math.abs(pixels[i+2]-background[2]))>tolerance)?1:0}
 return{mask,method:background?'background-spacing':'transparency'};
}
function recognitionRuns(counts,threshold){const runs=[];let start=-1;for(let i=0;i<=counts.length;i++){if(counts[i]>=threshold&&start<0)start=i;if((i===counts.length||counts[i]<threshold)&&start>=0){runs.push({start,end:i});start=-1}}return runs}
function recognitionAxis(counts,otherSize){
 let runs=recognitionRuns(counts,Math.max(1,Math.floor(otherSize*.002)));
 // A small detached seed or effect can leave a second projection beside every
 // pose. Attach that run to the nearest substantial run before finding repeats.
 const typical=recognitionMedian(runs.map(r=>r.end-r.start)),main=runs.filter(r=>r.end-r.start>=typical*.5);
 if(main.length&&main.length<runs.length){const loose=[];for(const run of runs){if(main.includes(run))continue;let nearest=null,distance=Infinity;for(const candidate of main){const gap=Math.max(candidate.start-run.end,run.start-candidate.end,0);if(gap<distance){distance=gap;nearest=candidate}}if(distance<=Math.max(2,(nearest.end-nearest.start)*.8)){nearest.start=Math.min(nearest.start,run.start);nearest.end=Math.max(nearest.end,run.end)}else loose.push(run)}runs=[...main,...loose].sort((a,b)=>a.start-b.start)}
 if(runs.length<2||runs.length>128)return null;
 const centers=runs.map(r=>(r.start+r.end)/2),sizes=runs.map(r=>r.end-r.start),gaps=centers.slice(1).map((v,i)=>v-centers[i]),pitch=recognitionMedian(gaps),steps=gaps.map(v=>Math.round(v/pitch));
 if(!pitch||Math.max(...sizes)>recognitionMedian(sizes)*2.6||gaps.some((v,i)=>steps[i]<1||steps[i]>4||Math.abs(v/pitch-steps[i])>.22))return null;
 const count=1+steps.reduce((n,v)=>n+v,0);if(count>128||count*3>counts.length)return null;
 const indexes=[0];for(const step of steps)indexes.push(indexes.at(-1)+step);
 // Prefer exact source cells only when every foreground run actually fits.
 const uniform=counts.length/count;
 if(Number.isInteger(uniform)&&runs.every((r,i)=>r.start>=indexes[i]*uniform&&r.end<=(indexes[i]+1)*uniform))return{count,cell:uniform,bounds:Array.from({length:count+1},(_,i)=>i*uniform),regular:true,score:.97};
 // A resized/JPEG sheet may have fractional cell dimensions and unequal row
 // spacing. Put each cut in the empty corridor, never through a sprite.
 const bounds=[0];for(let i=1;i<runs.length;i++){const previous=runs[i-1],next=runs[i],slots=steps[i-1];for(let k=1;k<=slots;k++)bounds.push(Math.round(slots===1?(previous.end+next.start)/2:centers[i-1]+pitch*(k-.5)))}bounds.push(counts.length);
 if(bounds.some((v,i)=>i&&v<=bounds[i-1]))return null;
 return{count,cell:Math.max(...bounds.slice(1).map((v,i)=>v-bounds[i])),bounds,regular:false,score:.9};
}
export function recognizeSheetPixels(image){
 const {w,h}=image,{mask,method}=recognitionMask(image),xs=new Uint32Array(w),ys=new Uint32Array(h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){xs[x]++;ys[y]++}
 const horizontal=recognitionAxis(xs,h),vertical=recognitionAxis(ys,w);
 if(horizontal&&vertical&&horizontal.count*vertical.count<=8192){
  const frames=[];let filled=0;for(let row=0;row<vertical.count;row++)for(let col=0;col<horizontal.count;col++){
   const x=horizontal.bounds[col],y=vertical.bounds[row],width=horizontal.bounds[col+1]-x,height=vertical.bounds[row+1]-y;let area=0;
   for(let dy=y;dy<y+height;dy++)for(let dx=x;dx<x+width;dx++)area+=mask[dy*w+dx];if(area)filled++;
   frames.push({id:`frame-${row}-${col}`,row,col,x,y,w:width,h:height,empty:!area});
  }
  if(filled>=frames.length*.55)return{kind:'character',method,confidence:Math.min(horizontal.score,vertical.score),layout:horizontal.regular&&vertical.regular?'grid':'atlas',rows:vertical.count,cols:horizontal.count,cellWidth:horizontal.cell,cellHeight:vertical.cell,frames};
 }
 // Irregular sheets need object bounds, not a forced tile grid. A three-pixel
 // neighborhood keeps nearby detached details together; the source's padding
 // between separate sprites remains a boundary.
 const rgba=new Uint8ClampedArray(w*h*4);for(let p=0;p<mask.length;p++)rgba[p*4+3]=mask[p]*255;
 const {parts}=findParts(rgba,w,h,1,8,2);
 if(parts.length<2)return{kind:'image',method,confidence:1,frames:[]};
 if(parts.length<=3){const largest=parts.reduce((a,b)=>a.area>b.area?a:b),area=parts.reduce((sum,p)=>sum+p.area,0),width=Math.max(...parts.map(p=>p.x+p.w))-Math.min(...parts.map(p=>p.x)),height=Math.max(...parts.map(p=>p.y+p.h))-Math.min(...parts.map(p=>p.y));if(largest.area>=area*.9&&width<=largest.w*1.8&&height<=largest.h*1.8)return{kind:'image',method,confidence:.9,frames:[]}}
 if(parts.length>2000)throw Error('This image contains over 2,000 separate regions. Import a smaller sheet.');
 const rows=[];for(const part of [...parts].sort((a,b)=>a.y-b.y||a.x-b.x)){let row=rows.find(r=>Math.abs(r.y-part.y)<=Math.max(2,Math.min(10,Math.min(r.height,part.h)*.3)));if(!row){row={y:part.y,height:part.h,parts:[]};rows.push(row)}row.parts.push(part)}
 const frames=[];rows.forEach((row,r)=>row.parts.sort((a,b)=>a.x-b.x).forEach((part,col)=>frames.push({id:`asset-${r}-${col}`,row:r,col,x:part.x,y:part.y,w:part.w,h:part.h,empty:false})));
 return{kind:'environment',method,confidence:.88,layout:'atlas',rows:rows.length,cols:Math.max(...rows.map(r=>r.parts.length)),cellWidth:Math.max(...frames.map(f=>f.w)),cellHeight:Math.max(...frames.map(f=>f.h)),frames};
}
