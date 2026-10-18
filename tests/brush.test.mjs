import test from 'node:test';
import assert from 'node:assert/strict';
import {strokeMask,paintMask,compositeMask,fullMask,validateMask,maskContains,maskRectangles} from '../dist/brush.mjs';
import {contains,objectMaskRects,localToWorld,cropObject,resetCrop,drawObject} from '../dist/geometry.mjs';
import {platforms,solid,landing,validateProject,newPlayer,stepPlayer} from '../dist/engine.mjs';

const shape=mask=>({id:'paint',asset:null,name:'Paint',x:0,y:0,w:mask.w,h:mask.h,kind:'solid',inset:0,rotation:0,flip:false,mask});
const ring=()=>compositeMask(fullMask(64,40),fullMask(32,24),{x:16,y:8,erase:true});

test('pressure strokes interpolate sparse pen events into continuous native pixels',()=>{
 const stroke=strokeMask([{x:-20,y:0,pressure:.2},{x:40,y:0,pressure:1}],{size:20});
 assert.ok([stroke.x,stroke.y,stroke.w,stroke.h].every(Number.isInteger));
 for(let x=-20;x<=40;x++)assert.ok(maskContains(stroke.mask,x-stroke.x,-stroke.y));
 assert.equal(maskContains(stroke.mask,-20-stroke.x,8-stroke.y),false);
 assert.equal(maskContains(stroke.mask,39-stroke.x,8-stroke.y),true);
 assert.deepEqual(strokeMask([{x:0,y:0,pressure:0},{x:30,y:6,pressure:1}],{size:12,pressure:false}),strokeMask([{x:0,y:0},{x:30,y:6}],{size:12}));
 const tiny=strokeMask([{x:0,y:0}],{size:1});assert.equal(tiny.mask.runs.length,1);assert.equal(maskContains(tiny.mask,0,0),true);
});

test('elliptical raster scaling preserves a circular eraser on nonuniformly resized sources',()=>{
 const stroke=strokeMask([{x:20,y:20}],{size:8,scaleX:2,scaleY:.5});
 assert.deepEqual([stroke.w,stroke.h],[16,4]);
 assert.equal(maskContains(stroke.mask,14,1),true);assert.equal(maskContains(stroke.mask,0,0),false);
 const erased=paintMask(fullMask(40,40),[{x:20,y:20}],{size:8,scaleX:2,scaleY:.5,erase:true});
 assert.equal(maskContains(erased,26,20),false);assert.equal(maskContains(erased,20,24),true);
 const smallImport=paintMask(fullMask(4096,4096),[{x:2048,y:2048},{x:3072,y:2048}],{size:64,scaleX:256,scaleY:256,erase:true});assert.deepEqual(smallImport.runs,[]);
 assert.equal(strokeMask([{x:80,y:80}],{size:4,clip:{x:0,y:0,w:40,h:40}}),null);
 const crossing=strokeMask([{x:-20000,y:2000},{x:2000,y:2000}],{size:4,scaleX:256,scaleY:256,clip:{x:0,y:0,w:4096,h:4096}});assert.equal(crossing.x,0);for(let x=0;x<=2000;x++)assert.ok(maskContains(crossing.mask,x,2000-crossing.y));
});

test('RLE union and erasure retain disconnected pixels and holes without mutating source masks',()=>{
 const base=fullMask(12,8),saved=structuredClone(base),cut=fullMask(4,8),erased=compositeMask(base,cut,{x:4,erase:true});
 assert.deepEqual(base,saved);assert.deepEqual(erased.runs[0],[0,0,4]);assert.deepEqual(erased.runs[1],[0,8,12]);
 assert.deepEqual(compositeMask(erased,cut,{x:4}),base);
 assert.deepEqual(compositeMask(base,fullMask(20,20),{x:-4,y:-4,erase:true}).runs,[]);
 assert.deepEqual(maskRectangles(fullMask(8192,8192)),[{x:0,y:0,w:8192,h:8192}]);
 const large=paintMask(fullMask(8192,8192),[{x:4096,y:4096}],{size:16,erase:true});assert.ok(large.runs.length<8300);assert.equal(maskContains(large,4096,4096),false);
});

test('mask validation rejects corrupt runs and keeps saved legacy objects compatible',()=>{
 const project={format:'max-level-studio',version:1,name:'Masks',spawn:{x:0,y:0},assets:[],objects:[shape(ring()),{id:'old',asset:null,name:'Old rectangle',x:80,y:0,w:16,h:16,kind:'solid',inset:0}]};
 const saved=validateProject(JSON.parse(JSON.stringify(project)));assert.deepEqual(saved.objects[0].mask,ring());assert.equal(saved.objects[1].mask,undefined);
 for(const mask of [{w:0,h:4,runs:[]},{w:4,h:4,runs:[[0,1,5]]},{w:4,h:4,runs:[[0,0,2],[0,1,4]]},{w:4,h:4,runs:[[2,0,4],[1,0,4]]},{w:4,h:4,runs:[[0,.5,2]]}])assert.throws(()=>validateMask(mask),/mask/);
 assert.deepEqual(validateMask({w:4,h:1,runs:[[0,0,2],[0,2,4]]}).runs,[[0,0,4]]);
 assert.throws(()=>strokeMask([{x:0,y:0}],{size:512,scaleX:8192}),/8192/);
});

test('crop, reset, flip, resize and rotation share the original mask coordinate space',()=>{
 const o=shape({w:8,h:4,runs:[[0,0,2],[1,0,2],[2,6,8],[3,6,8]]});Object.assign(o,{x:10,y:20,w:16,h:8,flip:true,rotation:90});
 assert.deepEqual(objectMaskRects(o),[{x:12,y:0,w:4,h:4},{x:0,y:4,w:4,h:4}]);
 assert.equal(contains(o,localToWorld({x:13,y:1},o)),true);assert.equal(contains(o,localToWorld({x:8,y:1},o)),false);
 const original=structuredClone(o);cropObject(o,{x:0,y:4,w:8,h:4});assert.deepEqual(objectMaskRects(o),[{x:0,y:0,w:4,h:4}]);resetCrop(o);assert.deepEqual(o.mask,original.mask);assert.deepEqual(objectMaskRects(o),objectMaskRects(original));
});

test('native image and returned atlas artwork are clipped to identical painted holes',()=>{
 const o=shape(ring()),clips=[],draws=[],ctx={save(){},restore(){},translate(){},rotate(){},scale(){},beginPath(){this.path=[]},rect(...r){this.path.push(r)},clip(){clips.push(this.path)},drawImage(...args){draws.push(args)},fillRect(){}};
 drawObject(ctx,o,{width:64,height:40});const nativeClip=clips[0];assert.equal(ctx.imageSmoothingEnabled,false);
 assert.equal(nativeClip.some(([x,y,w,h])=>32>=x&&32<x+w&&20>=y&&20<y+h),false);
 clips.length=0;o.artwork={mode:'atlas',bounds:{x:0,y:0,w:64,h:40},transform:{x:0,y:0,w:64,h:40,rotation:0,flip:false}};drawObject(ctx,o,{width:64,height:40});assert.deepEqual(clips[0],nativeClip);assert.equal(draws.length,2);
});

test('solid mask holes remain empty while their authored floor, wall and ceiling collide',()=>{
 const ps=platforms([shape(ring())]);assert.equal(solid(ps,32,30,33,30),null);
 assert.equal(solid(ps,32,28,32,24)?.y,26);assert.equal(solid(ps,32,30,14,30)?.x,20);
 assert.equal(landing(ps,32,12,32,38)?.y,32);
 const p=newPlayer({x:32,y:30});for(let i=0;i<120;i++)stepPlayer(p,{},ps);assert.equal(p.y,32);assert.equal(p.grounded,true);
 assert.equal(platforms([{...shape(ring()),kind:'decor'}]).length,0);
});

test('one-way masks expose only upper boundaries and never make erased gaps landable',()=>{
 const mask={w:64,h:40,runs:Array.from({length:40},(_,y)=>[y,0,y<20?16:64])},o={...shape(mask),kind:'platform'},ps=platforms([o]);
 assert.deepEqual(ps.map(p=>({x:p.x,y:p.y,w:p.w})),[{x:0,y:0,w:16},{x:16,y:20,w:48}]);
 assert.equal(landing(ps,8,5,8,35),null);assert.equal(landing(ps,40,5,40,35)?.y,20);assert.equal(solid(ps,40,35,40,10),null);
 const split={...shape(compositeMask(fullMask(64,8),fullMask(24,8),{x:20,erase:true})),kind:'platform'};assert.equal(landing(platforms([split]),32,-20,32,20),null);
});

test('flipped and rotated mask collision follows painted pixels instead of object bounds',()=>{
 const o={...shape({w:20,h:20,runs:Array.from({length:20},(_,y)=>[y,0,4])}),flip:true,rotation:90},ps=platforms([o]);
 assert.ok(ps.length>0);assert.ok(ps.every(p=>p.y>=16-1e-7&&p.y+p.h<=20+1e-7));
 assert.equal(landing(ps,10,-20,10,10),null);assert.ok(Math.abs(landing(ps,10,10,10,30).y-16)<1e-7);
});
