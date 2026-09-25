import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePNG,decodePNG,pngBytes,dataURL} from '../dist/png.mjs';
import {detectSpriteGrid,groupSpriteSheet,editSpriteSheet,validateSpriteSheet,exportSpriteSheet,groupWorkspaceSprites,ungroupWorkspaceSprites,spriteSheetLayout} from '../dist/spritesheets.mjs';
import {validateProject} from '../dist/engine.mjs';
import {spriteSheetProject,inspectSpriteSheet,compactProjectInfo} from '../dist/agent.mjs';
import {prepareArtwork} from '../dist/artwork.mjs';

async function source({cols=8,rows=8,cell=16,gutter=0,margin=0,padding=3,empty=[],opaque=false}={}){
 const w=margin*2+cols*cell+(cols-1)*gutter,h=margin*2+rows*cell+(rows-1)*gutter,pixels=new Uint8Array(w*h*4);
 if(opaque)pixels.fill(255);
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  if(empty.includes(row+':'+col))continue;
  for(let y=padding;y<cell-padding;y++)for(let x=padding;x<cell-padding;x++)pixels.set([20+col*20,20+row*20,65,255],((margin+row*(cell+gutter)+y)*w+margin+col*(cell+gutter)+x)*4);
 }
 return{id:'character',name:'Character',w,h,src:dataURL(await encodePNG({w,h,pixels}))};
}
const pixel=(image,x,y)=>[...image.pixels.subarray((y*image.w+x)*4,(y*image.w+x)*4+4)];

test('transparent regular character sheet becomes one parent, eight rows, and 64 source frames',async()=>{
 const asset=await source(),proposal=await detectSpriteGrid(asset);
 assert.equal(proposal.cellWidth,16);assert.equal(proposal.cellHeight,16);assert.equal(proposal.rows,8);assert.equal(proposal.cols,8);assert.ok(proposal.confidence>.8);assert.equal(proposal.grouping,'row');
 const grouped=await groupSpriteSheet(asset);
 assert.equal(grouped.type,'sprite_sheet');assert.equal(grouped.src,asset.src);assert.equal(grouped.spriteSheet.type,'character');assert.equal(grouped.spriteSheet.groups.length,8);assert.equal(grouped.spriteSheet.frames.length,64);assert.equal(grouped.spriteSheet.groups[0].name,'row-01');
 assert.deepEqual(grouped.spriteSheet.groups[1].frameIds,Array.from({length:8},(_,n)=>'frame-1-'+n));assert.equal(asset.spriteSheet,undefined);
 assert.deepEqual(validateSpriteSheet(grouped.spriteSheet,asset),grouped.spriteSheet);
});

test('flat white backgrounds can inform detection while original pixels remain untouched',async()=>{
 const asset=await source({opaque:true}),proposal=await detectSpriteGrid(asset);
 assert.equal(proposal.rows,8);assert.equal(proposal.cols,8);assert.equal(proposal.method,'background-spacing');
 const grouped=await groupSpriteSheet(asset),exported=await exportSpriteSheet(grouped),decoded=await decodePNG(pngBytes(exported.src));
 assert.equal(grouped.src,asset.src);assert.deepEqual(pixel(decoded,0,0),[255,255,255,255]);
});

test('spacing detects gutters and manual overrides preserve the requested empty cells',async()=>{
 const asset=await source({gutter:2,padding:0}),proposal=await detectSpriteGrid(asset);
 assert.equal(proposal.cellWidth,16);assert.equal(proposal.cellHeight,16);assert.equal(proposal.gutterX,2);assert.equal(proposal.gutterY,2);
 const sparse=await source({cols:3,rows:2,empty:['0:1']}),kept=await groupSpriteSheet(sparse,{cellWidth:16,cellHeight:16,rows:2,cols:3});
 assert.equal(kept.spriteSheet.frames.length,6);assert.equal(kept.spriteSheet.frames.find(frame=>frame.row===0&&frame.col===1).empty,true);
 const omitted=await groupSpriteSheet(sparse,{cellWidth:16,cellHeight:16,rows:2,cols:3,preserveEmpty:false});assert.equal(omitted.spriteSheet.frames.length,5);assert.equal(omitted.spriteSheet.groups[0].frameIds.length,2);
 await assert.rejects(()=>groupSpriteSheet(sparse,{cellWidth:17,cellHeight:16,cols:3,rows:2}),/exceeds/);
});

test('group and frame ordering exports source pixels in the new order with no resampling',async()=>{
 const asset=await source({cols:3,rows:2}),grouped=await groupSpriteSheet(asset,{cellWidth:16,cellHeight:16,cols:3,rows:2});
 const edited=editSpriteSheet(grouped,[{type:'rename_group',groupId:'row-02',name:'Walk'},{type:'reorder_groups',groupIds:['row-02','row-01']},{type:'reorder_frames',groupId:'row-02',frameIds:['frame-1-2','frame-1-1','frame-1-0']}]);
 assert.equal(edited.src,asset.src);assert.equal(grouped.spriteSheet.groups[0].id,'row-01');assert.equal(edited.spriteSheet.groups[0].name,'Walk');
 const exported=await exportSpriteSheet(edited),decoded=await decodePNG(pngBytes(exported.src));
 assert.equal(exported.w,48);assert.equal(exported.h,32);assert.deepEqual(pixel(decoded,4,4),[60,40,65,255]);assert.deepEqual(pixel(decoded,36,4),[20,40,65,255]);assert.deepEqual(pixel(decoded,4,20),[20,20,65,255]);
 const strip=await exportSpriteSheet(edited,{groupId:'row-02'});assert.equal(strip.w,48);assert.equal(strip.h,16);assert.equal(strip.name,'Character-Walk');
 const frame=await exportSpriteSheet(edited,{frameId:'frame-0-1'});assert.equal(frame.w,16);assert.equal(frame.h,16);assert.deepEqual(pixel(await decodePNG(pngBytes(frame.src)),4,4),[40,20,65,255]);
 const original=await exportSpriteSheet(edited,{original:true});assert.equal(original.src,asset.src);
});

test('column, merge, split and manual selection retain exactly one membership per frame',async()=>{
 const asset=await source({cols:3,rows:2}),grouped=await groupSpriteSheet(asset,{cellWidth:16,cellHeight:16,cols:3,rows:2,grouping:'column'});
 assert.equal(grouped.spriteSheet.groups.length,3);assert.deepEqual(grouped.spriteSheet.groups[0].frameIds,['frame-0-0','frame-1-0']);
 const exported=await exportSpriteSheet(grouped);assert.equal(exported.w,48);assert.equal(exported.h,32);
 const merged=editSpriteSheet(grouped,[{type:'merge_groups',groupIds:['column-01','column-02'],name:'move'}]);assert.equal(merged.spriteSheet.groups.length,2);assert.equal(merged.spriteSheet.groups[0].frameIds.length,4);assert.equal(merged.spriteSheet.grouping,'manual');
 const split=editSpriteSheet(merged,[{type:'split_group',groupId:'column-01',at:2}]);assert.equal(split.spriteSheet.groups.length,3);
 const manual=editSpriteSheet(split,[{type:'group_frames',frameIds:['frame-0-0','frame-0-1','frame-0-2'],name:'first row'}]);
 assert.equal(manual.spriteSheet.groups.at(-1).name,'first row');assert.equal(new Set(manual.spriteSheet.groups.flatMap(group=>group.frameIds)).size,6);assert.equal(manual.spriteSheet.groups.flatMap(group=>group.frameIds).length,6);
 const initiallyManual=await groupSpriteSheet(asset,{cellWidth:16,cellHeight:16,grouping:'manual'});assert.equal(initiallyManual.spriteSheet.groups.length,1);assert.equal(initiallyManual.spriteSheet.groups[0].frameIds.length,6);
 const scoped={...grouped,selectedForGeneration:true,referenceSelection:{groupIds:['column-02']}},mergedScope=editSpriteSheet(scoped,[{type:'merge_groups',groupIds:['column-01','column-02']}]);assert.deepEqual(mergedScope.referenceSelection,{frameIds:['frame-0-1','frame-1-1']});assert.equal(mergedScope.selectedForGeneration,true);
});

test('validation rejects missing/duplicate frame membership, out-of-bounds sources, and non-atomic bad edits',async()=>{
 const grouped=await groupSpriteSheet(await source({cols:2,rows:2}),{cellWidth:16,cellHeight:16});
 const copy=()=>JSON.parse(JSON.stringify(grouped.spriteSheet));let bad=copy();bad.groups[0].frameIds.push(bad.groups[1].frameIds[0]);assert.throws(()=>validateSpriteSheet(bad,grouped),/exactly one/);
 bad=copy();bad.groups[0].frameIds.pop();assert.throws(()=>validateSpriteSheet(bad,grouped),/exactly one/);
 bad=copy();bad.frames[0].x=10000;assert.throws(()=>validateSpriteSheet(bad,grouped),/source grid|source x/);
 bad=copy();bad.rows=300;assert.throws(()=>validateSpriteSheet(bad,grouped),/exceeds/);
 const before=JSON.stringify(grouped);assert.throws(()=>editSpriteSheet(grouped,[{type:'rename_group',groupId:'row-01',name:'Changed'},{type:'reorder_groups',groupIds:['row-01','row-01']}]),/exactly once/);assert.equal(JSON.stringify(grouped),before);
 await assert.rejects(()=>groupSpriteSheet(grouped,{cellWidth:0}),/Invalid/);
});

test('ambiguous non-sheet images propose a modest 16px default instead of claiming certainty',async()=>{
 const pixels=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++)pixels.set([x*4,y*4,(x+y)%255,255],(y*64+x)*4);
 const asset={id:'photo',name:'Photo',w:64,h:64,src:dataURL(await encodePNG({w:64,h:64,pixels}))},proposal=await detectSpriteGrid(asset);
 assert.equal(proposal.cellWidth,16);assert.equal(proposal.cellHeight,16);assert.equal(proposal.confidence,.15);assert.equal(proposal.method,'16px-default');
});

test('project persistence, compact tools and generation references carry the hierarchy with one source image',async()=>{
 const asset=await source(),base={format:'max-level-studio',version:1,name:'Sketch',spawn:{x:0,y:0},assets:[{...asset,selectedForGeneration:true}],objects:[{id:'floor',asset:null,name:'Floor',x:0,y:0,w:128,h:16,kind:'solid',role:'platform',inset:0}]};
 const {project,details}=await spriteSheetProject(base,'group_sprite_sheet',{assetId:asset.id});
 const restored=validateProject(JSON.parse(JSON.stringify(project)));assert.equal(restored.assets.length,1);assert.equal(restored.assets[0].src,asset.src);assert.equal(restored.assets[0].spriteSheet.groups.length,8);assert.equal(details.spriteSheet.frameCount,64);
 const compact=compactProjectInfo(restored),inspected=await inspectSpriteSheet(restored,{assetId:asset.id});assert.equal(compact.assets[0].spriteSheet.groups.length,8);assert.equal(compact.assets[0].spriteSheet.frames,undefined);assert.equal(inspected.spriteSheet.frameCount,64);
 const {request}=await prepareArtwork(restored,{id:'sheet-handoff'});assert.equal(request.references.length,1);assert.equal(request.references[0].spriteSheet.type,'character');assert.equal(request.references[0].spriteSheet.groups.length,8);assert.equal(request.references[0].spriteSheet.frames.length,64);assert.equal(request.references[0].src,asset.src);
 const scoped={...restored,assets:[{...restored.assets[0],referenceSelection:{groupIds:['row-01']}}]},ungrouped=validateProject(ungroupWorkspaceSprites(scoped,{assetId:asset.id}).project);assert.equal(ungrouped.assets[0].src,asset.src);assert.equal(ungrouped.assets[0].referenceSelection,undefined);assert.equal(ungrouped.assets[0].spriteSheet,undefined);
 await assert.rejects(()=>groupWorkspaceSprites(restored,{assetIds:[asset.id]}),/Already grouped/);
});

test('existing sprites form a virtual collection with spatial rows, repeated sources, and empty cells',async()=>{
 const a={...await source({cols:1,rows:1}),id:'a'},b={...await source({cols:1,rows:1,empty:['0:0']}),id:'b'},objects=[['one','a',0,0],['two','a',16,0],['three','a',32,0],['four','a',0,16],['five','b',32,16]].map(([id,asset,x,y])=>({id,asset,x,y,w:16,h:16,kind:'decor'}));
 const base={format:'max-level-studio',version:1,name:'Sources',spawn:{x:0,y:0},assets:[a,b],objects},before=JSON.stringify(base);
 const result=await groupWorkspaceSprites(base,{objectIds:['five','three','one','four','two'],id:'collection'}),parent=result.project.assets.at(-1);
 assert.equal(JSON.stringify(base),before);assert.equal(parent.src,undefined);assert.equal(parent.selectedForGeneration,true);assert.equal(parent.spriteSheet.source,'assets');assert.equal(parent.spriteSheet.rows,2);assert.equal(parent.spriteSheet.cols,3);assert.equal(parent.spriteSheet.frames.length,6);assert.equal(parent.spriteSheet.groups.length,2);assert.equal(parent.spriteSheet.groups[0].fps,8);assert.equal(parent.spriteSheet.groups[0].loop,true);
 assert.equal(parent.spriteSheet.frames[4].empty,true);assert.equal(parent.spriteSheet.frames[4].sourceAssetId,undefined);assert.equal(parent.spriteSheet.frames[5].empty,true);assert.equal(parent.spriteSheet.frames[5].sourceAssetId,'b');assert.equal(parent.spriteSheet.frames.filter(frame=>frame.sourceAssetId==='a').length,4);
 assert.deepEqual(result.project.assets.slice(0,2),base.assets);assert.equal(result.project.objects,base.objects);
 const exported=await exportSpriteSheet(parent,{},result.project.assets),image=await decodePNG(pngBytes(exported.src));assert.equal(image.w,48);assert.equal(image.h,32);assert.deepEqual(pixel(image,20,20),[0,0,0,0]);assert.deepEqual(pixel(image,4,4),pixel(image,36,4));
 const restored=validateProject(JSON.parse(JSON.stringify(result.project)));assert.equal(restored.assets.at(-1).src,undefined);assert.equal(restored.assets.at(-1).spriteSheet.frames[0].sourceAssetId,'a');
 const ungrouped=ungroupWorkspaceSprites(result.project,{assetId:parent.id});assert.deepEqual(ungrouped.project,base);
 for(const change of [{rotation:90},{flip:true},{opacity:.5},{adjust:{hue:30}}])await assert.rejects(()=>groupWorkspaceSprites({...base,objects:base.objects.map((object,n)=>n?object:{...object,...change})},{objectIds:['one']}),/unrotated/);
});

test('shared cell origins preserve disconnected details and source edits propagate without stored composite PNGs',async()=>{
 const pixels=new Uint8Array(16*16*4);pixels.set([120,20,30,255],(10*16+5)*4);pixels.set([20,80,200,255],(2*16+12)*4);
 const sprite={id:'body-and-drop',name:'Body and drop',w:16,h:16,src:dataURL(await encodePNG({w:16,h:16,pixels}))},project={assets:[sprite],objects:[]};
 const grouped=await groupWorkspaceSprites(project,{assetIds:[sprite.id,sprite.id],columns:2,cellWidth:24,cellHeight:24}),parent=grouped.project.assets.at(-1);
 const edited=editSpriteSheet(parent,[{type:'group_settings',groupId:'row-01',fps:12,loop:false,origin:{x:8,y:15}}],grouped.project.assets),output=await exportSpriteSheet(edited,{frameIds:['frame-0-1','frame-0-0']},grouped.project.assets),image=await decodePNG(pngBytes(output.src));
 assert.equal(edited.spriteSheet.groups[0].fps,12);assert.equal(edited.spriteSheet.groups[0].loop,false);assert.deepEqual(edited.spriteSheet.groups[0].origin,{x:8,y:15});assert.equal(image.w,48);assert.equal(image.h,24);assert.deepEqual(pixel(image,12,2),[20,80,200,255]);assert.deepEqual(pixel(image,36,2),[20,80,200,255]);assert.deepEqual(pixel(image,5,10),[120,20,30,255]);
 pixels.set([250,200,70,255],(2*16+12)*4);const changed={...sprite,src:dataURL(await encodePNG({w:16,h:16,pixels}))};
 const updated=await exportSpriteSheet(edited,{frameId:'frame-0-0'},[changed,edited]),updatedImage=await decodePNG(pngBytes(updated.src));assert.deepEqual(pixel(updatedImage,12,2),[250,200,70,255]);assert.equal(edited.src,undefined);assert.equal(parent.spriteSheet.frames[0].w,16);
});

test('replacement art changes only its target while frame membership and originals remain intact',async()=>{
 const original={...await source({cols:1,rows:1}),id:'original'},replacement={...await source({cols:1,rows:1,cell:32,padding:0}),id:'replacement'},base={assets:[original,replacement],objects:[]};
 const grouped=await groupWorkspaceSprites(base,{assetIds:[original.id,original.id],columns:2}),parent=grouped.project.assets.at(-1),prior=JSON.stringify(parent);
 const edited=editSpriteSheet(parent,[{type:'replace_frame',frameId:'frame-0-1',artwork:{asset:replacement.id,x:0,y:0,w:32,h:32}}],grouped.project.assets);
 assert.equal(JSON.stringify(parent),prior);assert.equal(edited.spriteSheet.frames[1].sourceAssetId,original.id);assert.deepEqual(edited.spriteSheet.groups,parent.spriteSheet.groups);
 const layout=spriteSheetLayout(edited,{groupIds:['row-01']},grouped.project.assets),out=await exportSpriteSheet(edited,{groupIds:['row-01']},grouped.project.assets);assert.deepEqual(out.placements,layout.placements);const image=await decodePNG(pngBytes(out.src));assert.deepEqual(pixel(image,0,0),[0,0,0,0]);assert.deepEqual(pixel(image,16,0),[20,20,65,255]);
 const restored=editSpriteSheet(edited,[{type:'replace_frame',frameId:'frame-0-1',artwork:null}],grouped.project.assets);assert.deepEqual(restored,parent);
 assert.throws(()=>editSpriteSheet(parent,[{type:'replace_frame',frameId:'frame-0-1',artwork:{asset:parent.id,x:0,y:0,w:16,h:16}}],grouped.project.assets),/itself/);
 assert.throws(()=>validateSpriteSheet({...parent.spriteSheet,frames:parent.spriteSheet.frames.map((frame,n)=>n?frame:{...frame,sourceAssetId:'missing'})},parent,base.assets),/existing raster/);
 const hiddenReplacement={...replacement,hidden:true,parentAssetId:parent.id},dissolved=ungroupWorkspaceSprites({...grouped.project,assets:[original,hiddenReplacement,edited]},{assetId:parent.id});assert.equal(dissolved.project.assets.length,2);assert.equal(dissolved.project.assets[1].src,replacement.src);assert.equal(dissolved.project.assets[1].parentAssetId,undefined);assert.equal(dissolved.project.assets[1].hidden,undefined);
});

test('non-geometric regroup preserves replacements, names, ordering, timing and blank cells',async()=>{
 const asset=await source({rows:2,cols:3,empty:['0:1']}),replacement={...await source({rows:1,cols:1,padding:0}),id:'new-frame'},sources=[asset,replacement];
 let sheet=await groupSpriteSheet(asset,{cellWidth:16,cellHeight:16,rows:2,cols:2});
 sheet=editSpriteSheet(sheet,[{type:'rename_group',groupId:'row-01',name:'Walk'},{type:'group_settings',groupId:'row-01',fps:12,loop:false,origin:{x:8,y:15}},{type:'group_settings',groupId:'row-02',fps:12,loop:false,origin:{x:8,y:15}},{type:'reorder_groups',groupIds:['row-02','row-01']},{type:'reorder_frames',groupId:'row-01',frameIds:['frame-0-1','frame-0-0']},{type:'replace_frame',frameId:'frame-0-1',artwork:{asset:replacement.id,x:0,y:0,w:16,h:16}}],sources);
 const repeated=await groupSpriteSheet(sheet,{},sources);assert.deepEqual(repeated,sheet);
 const typed=await groupSpriteSheet(sheet,{sheetType:'environment'},sources);assert.deepEqual(typed.spriteSheet.frames,sheet.spriteSheet.frames);assert.deepEqual(typed.spriteSheet.groups,sheet.spriteSheet.groups);assert.equal(typed.spriteSheet.cols,2);
 const manual=await groupSpriteSheet(sheet,{grouping:'manual'},sources);assert.equal(manual.spriteSheet.groups.length,2);assert.equal(manual.spriteSheet.groups[1].name,'Walk');assert.deepEqual(manual.spriteSheet.groups[1].frameIds,['frame-0-1','frame-0-0']);assert.equal(manual.spriteSheet.groups[1].fps,12);
 const columns=await groupSpriteSheet(sheet,{grouping:'column'},sources);assert.deepEqual(columns.spriteSheet.frames,sheet.spriteSheet.frames);assert.equal(columns.spriteSheet.groups[0].fps,12);assert.equal(columns.spriteSheet.groups[0].loop,false);assert.deepEqual(columns.spriteSheet.groups[0].origin,{x:8,y:15});assert.equal(columns.spriteSheet.frames.find(frame=>frame.id==='frame-0-1').empty,true);
 const rendered=await exportSpriteSheet(columns,{frameId:'frame-0-1'},sources);assert.deepEqual(pixel(await decodePNG(pngBytes(rendered.src)),0,0),[20,20,65,255]);
 await assert.rejects(()=>groupSpriteSheet(sheet,{cellWidth:8},sources),/Restore generated frame replacements/);
 assert.equal(sheet.spriteSheet.groups[1].name,'Walk');
});
