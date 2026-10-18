import {strokeMask,compositeMask,fullMask} from './brush.mjs';
import {worldToLocal} from './geometry.mjs';

export function appendStroke(object,stroke){
 const x=Math.min(object.x,stroke.x),y=Math.min(object.y,stroke.y),w=Math.max(object.x+object.w,stroke.x+stroke.w)-x,h=Math.max(object.y+object.h,stroke.y+stroke.h)-y;
 if(w>8192||h>8192||Math.abs(x)>100000||Math.abs(y)>100000)throw Error('Keep each brush stroke within 8192 pixels. Lift the pen to continue.');
 const base={w,h,runs:object.mask.runs.map(([row,left,right])=>[row+object.y-y,left+object.x-x,right+object.x-x])};
 object.mask=compositeMask(base,stroke.mask,{x:stroke.x-x,y:stroke.y-y});
 Object.assign(object,{x,y,w,h});
}

export function eraseStroke(object,points,{size,pressure=true,asset}={}){
 const w=object.mask?.w||asset?.w||Math.max(1,Math.ceil(object.w)),h=object.mask?.h||asset?.h||Math.max(1,Math.ceil(object.h)),crop=object.crop||{x:0,y:0,w:1,h:1};
 const mapped=points.map(p=>{const q=worldToLocal(p,object);return{x:(crop.x+(object.flip?1-q.x/object.w:q.x/object.w)*crop.w)*w,y:(crop.y+q.y/object.h*crop.h)*h,pressure:p.pressure}});
 const stroke=strokeMask(mapped,{size,pressure,scaleX:w*crop.w/object.w,scaleY:h*crop.h/object.h,clip:{x:0,y:0,w,h}});
 if(!stroke)return false;
 const before=object.mask||fullMask(w,h),after=compositeMask(before,stroke.mask,{x:stroke.x,y:stroke.y,erase:true});
 if(before.runs.length===after.runs.length&&before.runs.every((run,i)=>run.every((v,j)=>v===after.runs[i][j])))return false;
 object.mask=after;
 return true;
}
