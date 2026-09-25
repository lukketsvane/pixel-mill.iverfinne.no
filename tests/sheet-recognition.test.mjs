import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizeSheetPixels} from '../dist/sheet-recognition.mjs';
import {autoGroupSpriteSheet,editSpriteSheet,exportSpriteSheet} from '../dist/spritesheets.mjs';
import {encodePNG,decodePNG,pngBytes,dataURL} from '../dist/png.mjs';
import {prepareAssetArtwork,applyAssetArtwork,getAssetReference} from '../dist/artwork.mjs';
import {validateProject} from '../dist/engine.mjs';

function image(w,h){return{w,h,pixels:new Uint8Array(w*h*4)}}
function rect(im,x,y,w,h,color=[90,40,10,255]){for(let dy=y;dy<y+h;dy++)for(let dx=x;dx<x+w;dx++)im.pixels.set(color,(dy*im.w+dx)*4)}
async function asset(im,id='source'){return{id,name:id,w:im.w,h:im.h,src:dataURL(await encodePNG(im))}}
function atlas(){const im=image(193,93),bounds=[[3,3,83,22],[95,3,56,18],[160,3,29,27],[4,42,17,11],[34,43,8,8],[58,42,23,14],[7,71,5,8],[30,72,11,6]];for(const b of bounds)rect(im,...b);return{im,bounds}}

test('recognition keeps noisy, non-divisible animation sheets as eight rows with complete frames',async()=>{
 const im=image(257,259);for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const noise=(x*17+y*31)%9-4;im.pixels.set([127+noise,163+noise,185+noise,255],(y*im.w+x)*4)}
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){if(row===4||row===7&&col===7)continue;rect(im,col*32+6,row*32+5,12,21);rect(im,col*32+24,row*32+24,3,3)}
 const source=await asset(im),grouped=await autoGroupSpriteSheet(source),meta=grouped.spriteSheet;
 assert.equal(meta.type,'character');assert.equal(meta.layout,'atlas');assert.deepEqual([meta.rows,meta.cols,meta.frames.length,meta.groups.length],[8,8,64,8]);assert.deepEqual(meta.groups.map(g=>g.frameIds.length),Array(8).fill(8));
 assert.equal(meta.frames.filter(f=>f.empty).length,9,'blank rows and cells retain source order');
 const frame=meta.frames[5*8+2];assert.ok(frame.x<=2*32+6&&frame.x+frame.w>2*32+26&&frame.y+frame.h>5*32+26,'detached details stay within the pose frame');
 assert.equal(grouped.src,source.src);assert.equal((await exportSpriteSheet(grouped)).src,source.src);
 const strip=await exportSpriteSheet(grouped,{groupId:meta.groups[5].id});assert.equal(strip.w,257);assert.equal(strip.h,meta.frames[40].h);
});

test('irregular atlases retain separate native bounds and export the untouched full source',async()=>{
 const {im,bounds}=atlas(),source=await asset(im),grouped=await autoGroupSpriteSheet(source),meta=grouped.spriteSheet;
 assert.equal(meta.type,'environment');assert.equal(meta.layout,'atlas');assert.equal(meta.frames.length,bounds.length);
 assert.deepEqual(meta.frames.map(f=>[f.x,f.y,f.w,f.h]),bounds);assert.equal((await exportSpriteSheet(grouped)).src,source.src);
 const selected=meta.frames[4],output=await exportSpriteSheet(grouped,{frameId:selected.id});assert.deepEqual([output.w,output.h],[8,8]);
 const decoded=await decodePNG(pngBytes(output.src));assert.deepEqual([...decoded.pixels.slice(0,4)],[90,40,10,255]);
 const edited=editSpriteSheet(grouped,[{type:'rename_group',groupId:meta.groups[1].id,name:'Plants'},{type:'reorder_frames',groupId:meta.groups[1].id,frameIds:[...meta.groups[1].frameIds].reverse()}]);
 assert.equal(edited.src,source.src);assert.deepEqual(edited.spriteSheet.frames,meta.frames);assert.equal(edited.spriteSheet.groups[1].name,'Plants');
});

test('atlas references and returned artwork target the selected native region only',async()=>{
 const {im}=atlas(),source=await asset(im),grouped=await autoGroupSpriteSheet(source),frame=grouped.spriteSheet.frames[4];
 const project=validateProject({format:'max-level-studio',version:1,name:'Atlas',spawn:{x:0,y:0},objects:[],assets:[grouped]});
 const reference=await getAssetReference(project,{...grouped,referenceSelection:{frameIds:[frame.id]}});assert.deepEqual([reference.w,reference.h],[8,8]);assert.equal(reference.spriteSheet.type,'environment');assert.equal(reference.spriteSheet.frames[0].id,frame.id);
 const prepared=await prepareAssetArtwork(project,{assetId:grouped.id,frameIds:[frame.id],id:'replace-asset',includeImages:false});assert.deepEqual([prepared.request.width,prepared.request.height],[8,8]);
 const replacement=image(16,16);rect(replacement,0,0,16,16,[5,100,200,255]);
 const applied=await applyAssetArtwork(prepared.project,{requestId:'replace-asset',dataUrl:(await asset(replacement)).src,id:'returned'}),updated=applied.project.assets.find(a=>a.id===grouped.id),output=await decodePNG(pngBytes((await exportSpriteSheet(updated,{},applied.project.assets)).src));
 assert.equal(updated.src,source.src);assert.deepEqual(updated.spriteSheet.groups,grouped.spriteSheet.groups);
 for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const inside=x>=frame.x&&x<frame.x+frame.w&&y>=frame.y&&y<frame.y+frame.h,i=(y*im.w+x)*4;assert.deepEqual([...output.pixels.slice(i,i+4)],inside?[5,100,200,255]:[...im.pixels.slice(i,i+4)])}
 const tooLarge={asset:'returned',x:0,y:0,w:16,h:16,targetW:20,targetH:20};assert.throws(()=>editSpriteSheet(updated,[{type:'replace_frame',frameId:frame.id,artwork:tooLarge}],applied.project.assets),/exceeds/);
});

test('ambiguous images remain one image instead of receiving an arbitrary cutting grid',async()=>{
 const im=image(37,29);for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)im.pixels.set([x*6,y*8,100,255],(y*im.w+x)*4);
 assert.equal(recognizeSheetPixels(im).kind,'image');const source=await asset(im);assert.deepEqual(await autoGroupSpriteSheet(source),source);
});

test('a single pose and its detached droplet remain one editable source',async()=>{
 const im=image(16,16);rect(im,3,4,7,8);rect(im,13,14,1,1,[60,170,255,255]);
 const source=await asset(im);assert.deepEqual(await autoGroupSpriteSheet(source),source);
});
