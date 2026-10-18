const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const merge=spans=>{const result=[];for(const [a,b] of spans.sort((a,b)=>a[0]-b[0])){const last=result.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else result.push([a,b])}return result};

export function validateMask(mask){
 if(!mask||!integer(mask.w,1,8192)||!integer(mask.h,1,8192)||!Array.isArray(mask.runs)||mask.runs.length>262144)throw Error('Invalid pixel mask.');
 const runs=[];let previous=null;
 for(const run of mask.runs){if(!Array.isArray(run)||run.length!==3||!integer(run[0],0,mask.h-1)||!integer(run[1],0,mask.w-1)||!integer(run[2],run[1]+1,mask.w)||previous&&(run[0]<previous[0]||run[0]===previous[0]&&run[1]<previous[2]))throw Error('Invalid pixel mask runs.');const next=[...run];if(previous&&next[0]===previous[0]&&next[1]===previous[2])previous[2]=next[2];else{runs.push(next);previous=next}}
 return{w:mask.w,h:mask.h,runs};
}

export function fullMask(w,h){if(!integer(w,1,8192)||!integer(h,1,8192))throw Error('Invalid pixel mask dimensions.');return{w,h,runs:Array.from({length:h},(_,y)=>[y,0,w])}}

export function maskContains(mask,x,y){
 x=Math.floor(x);y=Math.floor(y);if(x<0||x>=mask.w||y<0||y>=mask.h)return false;
 let lo=0,hi=mask.runs.length;
 while(lo<hi){const mid=(lo+hi)>>>1,run=mask.runs[mid];if(run[0]<y||run[0]===y&&run[1]<=x)lo=mid+1;else hi=mid}
 const run=mask.runs[lo-1];return!!run&&run[0]===y&&x<run[2];
}

export function maskRectangles(mask){
 const result=[],active=new Map();let row=-1;
 for(const [y,x0,x1] of mask.runs){if(y!==row){for(const [key,r] of active)if(r.y+r.h!==y)active.delete(key);row=y}const key=x0+':'+x1,prior=active.get(key);if(prior&&prior.y+prior.h===y)prior.h++;else{const rect={x:x0,y,w:x1-x0,h:1};result.push(rect);active.set(key,rect)}}
 return result;
}

export function compositeMask(base,paint,{x=0,y=0,erase=false}={}){
 if(!Number.isInteger(x)||!Number.isInteger(y))throw Error('Mask offsets must use whole pixels.');
 const rows=new Map();for(const [row,a,b] of base.runs){if(!rows.has(row))rows.set(row,[]);rows.get(row).push([a,b])}
 const applied=new Map();for(const [row,a,b] of paint.runs){const at=row+y,left=Math.max(0,a+x),right=Math.min(base.w,b+x);if(at<0||at>=base.h||left>=right)continue;if(!applied.has(at))applied.set(at,[]);applied.get(at).push([left,right])}
 for(const [row,spans] of applied){const old=rows.get(row)||[];if(!erase){rows.set(row,merge([...old,...spans]));continue}const result=[];let i=0;for(const [a,b] of old){let left=a;while(i<spans.length&&spans[i][1]<=left)i++;for(let k=i;k<spans.length&&spans[k][0]<b;k++){if(spans[k][0]>left)result.push([left,Math.min(b,spans[k][0])]);left=Math.max(left,spans[k][1]);if(left>=b)break}if(left<b)result.push([left,b])}rows.set(row,result)}
 return{w:base.w,h:base.h,runs:[...rows].sort((a,b)=>a[0]-b[0]).flatMap(([row,spans])=>spans.map(([a,b])=>[row,a,b]))};
}

export function strokeMask(points,{size=16,pressure=true,scaleX=1,scaleY=1,clip=null}={}){
 if(!Array.isArray(points)||!points.length)return null;
 if(!Number.isFinite(size)||size<=0||size>512||![scaleX,scaleY].every(v=>Number.isFinite(v)&&v>0&&v<=8192))throw Error('Invalid brush size.');
 if(clip&&(!Number.isSafeInteger(clip.x)||!Number.isSafeInteger(clip.y)||!integer(clip.w,1,8192)||!integer(clip.h,1,8192)))throw Error('Invalid brush clipping bounds.');
 const rows=new Map(),radius=p=>Math.max(1,size*(pressure?Math.max(.05,Math.min(1,p.pressure??1)):1))/2;
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const p of points){if(!p||![p.x,p.y,p.pressure??1].every(Number.isFinite)||![p.x,p.y].every(v=>Number.isSafeInteger(Math.floor(v))))throw Error('Invalid brush point.');const r=radius(p);left=Math.min(left,p.x-r*scaleX);top=Math.min(top,p.y-r*scaleY);right=Math.max(right,p.x+r*scaleX);bottom=Math.max(bottom,p.y+r*scaleY)}
 if(clip){left=Math.max(left,clip.x);top=Math.max(top,clip.y);right=Math.min(right,clip.x+clip.w);bottom=Math.min(bottom,clip.y+clip.h);if(left>=right||top>=bottom)return null}
 if(right-left>8192||bottom-top>8192)throw Error('Brush stroke exceeds 8192 pixels.');
 let fullRows=0;
 const add=(row,left,right)=>{if(clip){if(row<clip.y||row>=clip.y+clip.h)return;left=Math.max(left,clip.x);right=Math.min(right,clip.x+clip.w)}if(left>=right)return;const prior=rows.get(row)||[];if(clip&&prior.length===1&&prior[0][0]===clip.x&&prior[0][1]===clip.x+clip.w)return;const next=merge([...prior,[left,right]]);rows.set(row,next);if(clip&&next.length===1&&next[0][0]===clip.x&&next[0][1]===clip.x+clip.w)fullRows++};
 const dab=(x,y,r)=>{const rx=r*scaleX,ry=r*scaleY;let filled=false;const start=Math.max(Math.ceil(y-ry-.5),clip?clip.y:-Infinity),end=Math.min(Math.floor(y+ry-.5),clip?clip.y+clip.h-1:Infinity);for(let row=start;row<=end;row++){const dy=(row+.5-y)/ry,dx=rx*Math.sqrt(Math.max(0,1-dy*dy)),left=Math.ceil(x-dx-.5),right=Math.floor(x+dx-.5)+1;if(left>=right)continue;add(row,left,right);filled=true}if(!filled)add(Math.floor(y),Math.floor(x),Math.floor(x)+1)};
 let prior=null;
 for(const p of points){if(clip&&fullRows===clip.h)break;const r=radius(p);if(prior){const steps=Math.max(1,Math.ceil(Math.hypot((p.x-prior.x)/scaleX,(p.y-prior.y)/scaleY)*2));if(steps>32768)throw Error('Brush stroke exceeds the canvas limit.');for(let i=1;i<=steps;i++){const t=i/steps;dab(prior.x+(p.x-prior.x)*t,prior.y+(p.y-prior.y)*t,prior.r+(r-prior.r)*t);if(clip&&fullRows===clip.h)break}}else dab(p.x,p.y,r);prior={x:p.x,y:p.y,r}}
 if(!rows.size)return null;
 let x=Infinity;right=-Infinity;const ordered=[...rows].sort((a,b)=>a[0]-b[0]),y=ordered[0][0],h=ordered.at(-1)[0]-y+1;for(const [,spans] of ordered)for(const [a,b] of spans){x=Math.min(x,a);right=Math.max(right,b)}const w=right-x;if(w>8192||h>8192)throw Error('Brush stroke exceeds 8192 pixels.');
 return{x,y,w,h,mask:validateMask({w,h,runs:ordered.flatMap(([row,spans])=>spans.map(([a,b])=>[row-y,a-x,b-x]))})};
}

export function paintMask(mask,points,options={}){const stroke=strokeMask(points,{...options,clip:{x:0,y:0,w:mask.w,h:mask.h}});return stroke?compositeMask(mask,stroke.mask,{x:stroke.x,y:stroke.y,erase:!!options.erase}):{w:mask.w,h:mask.h,runs:mask.runs.map(run=>[...run])}}
