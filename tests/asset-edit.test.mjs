import test from 'node:test';
import assert from 'node:assert/strict';
import {removeAssetBackground,segmentAssetImage} from '../dist/asset-edit.mjs';
import {imageProject,projectDiff,applyDiff,patchSourceHash} from '../dist/agent.mjs';
import {validateProject} from '../dist/engine.mjs';
import {encodePNG,decodePNG,dataURL,pngBytes} from '../dist/png.mjs';
import {groupSpriteSheet} from '../dist/spritesheets.mjs';

const image=(w,h,color=[0,0,0,0])=>{const pixels=new Uint8Array(w*h*4);for(let at=0;at<pixels.length;at+=4)pixels.set(color,at);return{w,h,pixels}};
const pixel=(value,x,y)=>[...value.pixels.subarray((y*value.w+x)*4,(y*value.w+x+1)*4)];
const rectangle=(value,x,y,w,h,color)=>{for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)value.pixels.set(color,(row*value.w+col)*4)};
async function project(value){const src=dataURL(await encodePNG(value));return validateProject({format:'max-level-studio',version:1,name:'Asset edit',spawn:{x:3,y:9},assets:[{id:'source',name:'Source',w:value.w,h:value.h,src,selectedForGeneration:true,sheet:{tileSize:16}}],objects:[{id:'placed',asset:'source',name:'Placed',x:10,y:20,w:value.w,h:value.h,kind:'decor',rotation:0}]})}
function whiteFixture(){const value=image(12,10,[255,255,255,255]);rectangle(value,4,3,4,4,[20,30,40,255]);rectangle(value,5,4,2,1,[255,255,255,255]);rectangle(value,4,4,1,1,[25,50,75,91]);rectangle(value,1,1,1,1,[244,250,252,255]);return value}
function partsFixture(){const value=image(28,12);rectangle(value,1,1,3,6,[80,90,100,91]);rectangle(value,3,6,1,1,[0,0,0,0]);rectangle(value,12,1,4,5,[150,60,10,255]);rectangle(value,25,1,2,8,[25,35,45,255]);return value}

test('background removal preserves interior matching colors, framing and exact foreground alpha',()=>{
 const source=whiteFixture(),before=new Uint8Array(source.pixels),result=removeAssetBackground(source);
 assert.deepEqual(source.pixels,before);assert.equal(result.removedPixels,104);assert.deepEqual(pixel({...source,pixels:result.pixels},1,1),[0,0,0,0]);
 for(let y=3;y<7;y++)for(let x=4;x<8;x++)assert.deepEqual(pixel({...source,pixels:result.pixels},x,y),pixel(source,x,y));
 assert.deepEqual(result.rect,{x:0,y:0,w:12,h:10});
 const scoped=removeAssetBackground(source,{x:0,y:0,w:3,h:3});assert.equal(scoped.removedPixels,9);assert.deepEqual(pixel({...source,pixels:scoped.pixels},3,0),[255,255,255,255]);
 const transparent=image(5,5);rectangle(transparent,1,1,3,3,[255,255,255,73]);const unchanged=removeAssetBackground(transparent);assert.equal(unchanged.removedPixels,0);assert.deepEqual(unchanged.pixels,transparent.pixels);
 const corner=image(8,8);rectangle(corner,0,0,4,5,[70,90,110,255]);assert.deepEqual(removeAssetBackground(corner).pixels,corner.pixels);
});

test('segmentation preserves native component pixels, supports rectangle and point, and ignores only small components',()=>{
 const source=partsFixture(),before=new Uint8Array(source.pixels),parts=segmentAssetImage(source);
 assert.deepEqual(parts.map(({x,y,w,h,area})=>({x,y,w,h,area})),[{x:1,y:1,w:3,h:6,area:17},{x:12,y:1,w:4,h:5,area:20}]);assert.deepEqual(source.pixels,before);
 for(const part of parts)for(let y=0;y<part.h;y++)for(let x=0;x<part.w;x++)assert.deepEqual(pixel(part,x,y),pixel(source,x+part.x,y+part.y));
 assert.deepEqual(segmentAssetImage(source,{rect:{x:0,y:0,w:9,h:10}}).map(part=>part.x),[1]);assert.deepEqual(segmentAssetImage(source,{point:{x:13,y:2}}).map(part=>part.x),[12]);
 assert.throws(()=>segmentAssetImage(source,{point:{x:25,y:1}}),/17/);assert.throws(()=>segmentAssetImage(source,{point:{x:0,y:0}}),/17/);assert.throws(()=>segmentAssetImage(source,{rect:{x:0,y:0,w:29,h:1}}),/rectangle/);
 const white=image(10,10,[255,255,255,255]),whole=segmentAssetImage(white);assert.equal(whole.length,1);assert.equal(whole[0].area,100);assert.deepEqual(new Uint8Array(whole[0].pixels),white.pixels);
});

test('asset removal retains a hidden original and stable bindings; no-op does not add a backup',async()=>{
 const original=await project(whiteFixture()),before=structuredClone(original),edited=await imageProject(original,'edit_asset_image',{assetId:'source',action:'remove_background',sourceHash:patchSourceHash(original.assets[0].src)});
 assert.deepEqual(original,before);assert.equal(edited.details.assetIds[0],'source');assert.equal(edited.details.changed,true);assert.equal(edited.project.assets[0].id,'source');assert.deepEqual(edited.project.objects,original.objects);assert.deepEqual(edited.project.spawn,original.spawn);assert.equal(edited.project.assets.length,2);assert.equal(edited.project.assets[1].hidden,true);assert.equal(edited.project.assets[1].selectedForGeneration,false);assert.equal(edited.project.assets[1].src,original.assets[0].src);
 const decoded=await decodePNG(pngBytes(edited.project.assets[0].src));assert.deepEqual([decoded.w,decoded.h],[12,10]);assert.deepEqual(pixel(decoded,5,4),[255,255,255,255]);assert.deepEqual(pixel(decoded,4,4),[25,50,75,91]);
 assert.deepEqual(validateProject(JSON.parse(JSON.stringify(edited.project))),edited.project);assert.deepEqual(applyDiff(edited.project,projectDiff(edited.project,original)),original);
 const again=await imageProject(edited.project,'edit_asset_image',{assetId:'source',action:'remove_background'});assert.equal(again.details.changed,false);assert.deepEqual(again.project,edited.project);
 await assert.rejects(()=>imageProject(edited.project,'edit_asset_image',{assetId:'source',action:'segment',sourceHash:patchSourceHash(original.assets[0].src)}),/source image changed/);
});

test('segmentation adds plain exact crops without changing the source, and unsupported sheets and palette overflow reject atomically',async()=>{
 const original=await project(partsFixture()),edited=await imageProject(original,'edit_asset_image',{assetId:'source',action:'segment',rect:{x:0,y:0,w:24,h:12}});assert.deepEqual(edited.project.assets[0],original.assets[0]);assert.deepEqual(edited.project.objects,original.objects);assert.equal(edited.details.parts.length,2);assert.deepEqual(edited.project.assets.slice(1).map(asset=>[asset.w,asset.h]),[[3,6],[4,5]]);assert.ok(edited.project.assets.slice(1).every(asset=>!asset.spriteSheet));assert.deepEqual(applyDiff(edited.project,projectDiff(edited.project,original)),original);
 const grouped=structuredClone(original);grouped.assets[0]=await groupSpriteSheet(grouped.assets[0],{cellWidth:7,cellHeight:6});await assert.rejects(()=>imageProject(grouped,'edit_asset_image',{assetId:'source',action:'remove_background'}),/Ungroup/);
 const full=await project(whiteFixture());for(let index=1;index<2000;index++)full.assets.push({...full.assets[0],id:'copy-'+index});await assert.rejects(()=>imageProject(full,'edit_asset_image',{assetId:'source',action:'remove_background'}),/palette is full/);assert.equal(full.assets.length,2000);
});
