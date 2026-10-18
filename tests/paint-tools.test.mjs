import test from 'node:test';
import assert from 'node:assert/strict';
import {strokeMask,maskContains,fullMask} from '../dist/brush.mjs';
import {appendStroke,eraseStroke} from '../dist/paint-tools.mjs';
import {contains,localToWorld} from '../dist/geometry.mjs';
import {resolveShortcut} from '../dist/shortcuts.mjs';

test('incremental preview expands in every direction and retains earlier native pixels',()=>{
 const first=strokeMask([{x:10,y:10}],{size:8}),object={...first};
 const next=strokeMask([{x:10,y:10},{x:-12,y:-8}],{size:8});appendStroke(object,next);
 for(const stroke of [first,next])for(const [y,left,right] of stroke.mask.runs)for(let x=left;x<right;x++)assert.equal(maskContains(object.mask,stroke.x+x-object.x,stroke.y+y-object.y),true);
 assert.ok(object.x<0&&object.y<0);assert.equal(object.mask.w,object.w);assert.equal(object.mask.h,object.h);
});

test('native eraser modifies masks without altering the original artwork source or bounds',()=>{
 const object={x:0,y:0,w:32,h:32,asset:'source',rotation:0,flip:false,crop:null},before={...object};
 assert.equal(eraseStroke(object,[{x:16,y:16},{x:18,y:16}],{size:8,pressure:false,asset:{w:32,h:32}}),true);
 assert.equal(contains(object,{x:16,y:16}),false);assert.equal(contains(object,{x:2,y:2}),true);
 for(const key of Object.keys(before))assert.deepEqual(object[key],before[key]);
 assert.equal(eraseStroke(object,[{x:100,y:100}],{size:8}),false);
});

test('eraser keeps world-space alignment for cropped flipped rotated and stretched pieces',()=>{
 for(const rotation of [0,35,90])for(const flip of [false,true]){
  const object={x:20,y:30,w:80,h:40,rotation,flip,crop:{x:.25,y:.25,w:.5,h:.5},mask:fullMask(160,160)};
  const point=localToWorld({x:20,y:20},object),near=localToWorld({x:35,y:20},object);
  assert.equal(eraseStroke(object,[point],{size:8,pressure:false}),true);
  assert.equal(contains(object,point),false);assert.equal(contains(object,near),true);
 }
});

test('large world eraser clips to a very small resized image and can clear it completely',()=>{
 const object={x:0,y:0,w:16,h:16,asset:'large'};
 assert.equal(eraseStroke(object,[{x:8,y:8}],{size:256,asset:{w:4096,h:4096}}),true);
 assert.deepEqual(object.mask.runs,[]);
});

test('drawing shortcuts distinguish tools, modifiers and text input without hijacking browser commands',()=>{
 const event=(code,extra={})=>({code,target:{closest:()=>null},...extra});
 for(const [code,action] of [['KeyB','paint'],['KeyE','erase'],['KeyR','block'],['Digit1','walkable'],['BracketRight','larger'],['Tab','workspace']])assert.equal(resolveShortcut(event(code)),action);
 assert.equal(resolveShortcut(event('KeyZ',{ctrlKey:true})),'undo');assert.equal(resolveShortcut(event('KeyZ',{metaKey:true,shiftKey:true})),'redo');
 assert.equal(resolveShortcut(event('Enter',{ctrlKey:true})),'generate');assert.equal(resolveShortcut(event('Enter',{ctrlKey:true,shiftKey:true})),'applyArtwork');
 assert.equal(resolveShortcut(event('KeyA',{metaKey:true})),'selectAssets');assert.equal(resolveShortcut(event('KeyB',{ctrlKey:true,shiftKey:true})),'removeAssetBackground');assert.equal(resolveShortcut(event('KeyX',{metaKey:true,shiftKey:true})),'segmentAsset');
 assert.equal(resolveShortcut(event('KeyE',{altKey:true})),null);assert.equal(resolveShortcut(event('KeyB',{ctrlKey:true})),null);
 assert.equal(resolveShortcut(event('Minus',{key:'+'})),'zoomIn');assert.equal(resolveShortcut(event('Minus',{key:'?'})),'commands');assert.equal(resolveShortcut(event('Digit8',{key:'[',ctrlKey:true,altKey:true})),'smaller');
 assert.equal(resolveShortcut(event('KeyB',{repeat:true})),null);assert.equal(resolveShortcut(event('KeyB',{isComposing:true})),null);assert.equal(resolveShortcut(event('KeyB',{target:{closest:()=>({})}})),null);
});
