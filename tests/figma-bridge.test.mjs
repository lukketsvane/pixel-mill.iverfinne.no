import test from 'node:test';
import assert from 'node:assert/strict';
import {figmaPluginMain} from '../dist/figma-plugin.mjs';
import {mergeFigmaReturn,readFigmaReturn} from '../dist/figma-bridge.mjs';
import {validateProject,bounds,platforms} from '../dist/engine.mjs';
import {editProject,projectDiff} from '../dist/agent.mjs';
import {hasProjectChanges} from '../dist/project-state.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';
const png=dataURL(await encodePNG({w:2,h:2,pixels:new Uint8Array(16).fill(255)}));
const project=validateProject({format:'max-level-studio',version:1,name:'Figma garden',spawn:{x:-30,y:42},assets:[{id:'fern',name:'Fern',w:2,h:2,src:png}],objects:[{id:'floor',asset:null,name:'Floor',x:-64,y:42,w:120,h:12,kind:'solid',color:'#334455'},{id:'vine',asset:'fern',name:'Fern',x:-25.5,y:11.5,w:12,h:20,kind:'decor',rotation:35,flip:true,opacity:.6},{id:'ladder',asset:null,name:'Ladder',x:10,y:-40,w:12,h:82,kind:'ladder'},{id:'ledge',asset:null,name:'Ledge',x:-10,y:-40,w:54,h:8,kind:'platform',inset:2}]});
function mockFigma(){
 let counter=0;const nodes=new Map(),images=new Map(),messages=[];
 const mul=(a,b)=>[[a[0][0]*b[0][0]+a[0][1]*b[1][0],a[0][0]*b[0][1]+a[0][1]*b[1][1],a[0][0]*b[0][2]+a[0][1]*b[1][2]+a[0][2]],[a[1][0]*b[0][0]+a[1][1]*b[1][0],a[1][0]*b[0][1]+a[1][1]*b[1][1],a[1][0]*b[0][2]+a[1][1]*b[1][2]+a[1][2]]];
 class Node{
  constructor(type){this.type=type;this.id='1:'+ ++counter;this.data=new Map();this.children=[];this.width=this.height=100;this.relativeTransform=[[1,0,0],[0,1,0]];this.name=type;this.opacity=1;this.visible=true;this.locked=false;this.strokes=[];this.effects=[];this.fills=[];this.cornerRadius=0;this.strokeWeight=1;nodes.set(this.id,this)}
  get absoluteTransform(){return this.parent?mul(this.parent.absoluteTransform,this.relativeTransform):this.relativeTransform}
  get x(){return this.relativeTransform[0][2]}set x(v){this.relativeTransform[0][2]=v}get y(){return this.relativeTransform[1][2]}set y(v){this.relativeTransform[1][2]=v}get rotation(){return Math.atan2(this.relativeTransform[1][0],this.relativeTransform[0][0])*180/Math.PI}
  resize(w,h){this.width=w;this.height=h}
  appendChild(n){if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n);n.parent=this;this.children.push(n)}
  remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);nodes.delete(this.id);for(const child of [...this.children])child.remove()}
  setSharedPluginData(ns,k,v){assert.ok(Buffer.byteLength(ns+k+v)<100000);this.data.set(ns+':'+k,v)}getSharedPluginData(ns,k){return this.data.get(ns+':'+k)||''}
  createInstance(){const instance=new Node('INSTANCE');instance.main=this;instance.resize(this.width,this.height);Object.defineProperty(instance,'fills',{configurable:true,get:()=>this.fills});return instance}
  async getMainComponentAsync(){return this.main}
  clone(){const c=new Node(this.type);for(const k of ['width','height','name','opacity','locked','visible','fills','strokes','effects','cornerRadius','strokeWeight','relativeTransform'])c[k]=structuredClone(this[k]);c.data=new Map(this.data);if(this.main)c.main=this.main;for(const child of this.children)c.appendChild(child.clone());return c}
  async exportAsync(){return Buffer.from(png.split(',')[1],'base64')}
 }
 const page=new Node('PAGE');page.selection=[];
 const figma={currentPage:page,viewport:{scrollAndZoomIntoView(){}},commitUndo(){},showUI(){},ui:{postMessage:m=>messages.push(m)},base64Decode:t=>Uint8Array.from(Buffer.from(t,'base64')),base64Encode:b=>Buffer.from(b).toString('base64'),createImage(bytes){const hash=Buffer.from(bytes).toString('base64');images.set(hash,bytes);return{hash}},getImageByHash:hash=>images.has(hash)?{getBytesAsync:async()=>images.get(hash)}:null,getNodeByIdAsync:async id=>nodes.get(id)||null};
 for(const [method,type] of [['createFrame','FRAME'],['createComponent','COMPONENT'],['createRectangle','RECTANGLE'],['createEllipse','ELLIPSE'],['createVector','VECTOR']])figma[method]=()=>{const n=new Node(type);page.appendChild(n);return n};
 const get=(n,k)=>{const count=Number(n.getSharedPluginData('pixelMill',k+'Count'));return count?JSON.parse(Array.from({length:count},(_,i)=>n.getSharedPluginData('pixelMill',k+i)).join('')):null};
 return{figma,page,messages,get};
}
async function fixture(){const mock=mockFigma();globalThis.figma=mock.figma;globalThis.__html__='';figmaPluginMain();const payload={format:'pixel-mill-figma',version:1,project,rasters:[{id:'fern',w:2,h:2,src:png}],appearances:[{id:'ladder',w:12,h:82,src:png}],bounds:bounds(project.objects,project.spawn)};await mock.figma.ui.onmessage({type:'import',data:payload});assert.equal(mock.messages.some(m=>m.type==='error'),false);mock.root=mock.page.selection[0];mock.export=async()=>{mock.messages.length=0;await mock.figma.ui.onmessage({type:'export'});const error=mock.messages.find(m=>m.type==='error');if(error)throw Error(error.text);return mock.messages.find(m=>m.type==='download').data};return mock}

test('Figma round trip preserves source PNG, world origin, flipped rotation, opacity, ladder and collision data',async()=>{
 const f=await fixture(),result=await f.export();assert.deepEqual(readFigmaReturn(result).base,project);assert.deepEqual(readFigmaReturn(result).project,project);assert.equal(hasProjectChanges(projectDiff(project,readFigmaReturn(result).project)),false);
 assert.equal(f.page.children.length,2);const library=f.page.children.find(n=>n!==f.root);assert.ok(library.children.some(n=>n.visible===false&&n.fills[0].type==='IMAGE'));assert.equal(library.children.filter(n=>n.type==='COMPONENT').length,2);
});
test('Figma movement, resizing, duplicated instances, new library instances, ordering, spawn and collision selection return editable objects',async()=>{
 const f=await fixture(),vine=f.root.children.find(n=>n.name==='Fern'),ladder=f.root.children.find(n=>n.name==='Ladder');vine.x+=17;vine.y-=9;ladder.resize(12,100);const copy=vine.clone();f.root.appendChild(copy);copy.x+=60;const spawn=f.root.children.find(n=>n.name==='Spawn');spawn.x+=12;
 const library=f.page.children.find(n=>n!==f.root),fresh=library.children.find(n=>n.type==='COMPONENT'&&f.get(n,'component')?.assetId).createInstance();f.root.appendChild(fresh);fresh.name='New fern';fresh.x=120;fresh.y=60;f.page.selection=[fresh];await f.figma.ui.onmessage({type:'kind',kind:'ladder'});f.page.selection=[f.root];
 const returned=readFigmaReturn(await f.export()).project;assert.equal(returned.objects.length,6);assert.equal(returned.objects[1].x,project.objects[1].x+17);assert.equal(returned.objects[1].y,project.objects[1].y-9);assert.equal(returned.objects[2].h,100);assert.equal(returned.objects[4].asset,'fern');assert.notEqual(returned.objects[4].id,'vine');assert.equal(returned.objects[5].asset,'fern');assert.equal(returned.objects[5].kind,'ladder');assert.equal(returned.spawn.x,project.spawn.x+12);
});
test('Figma import rebases independent current edits and rejects conflicting same-field edits atomically',async()=>{
 const f=await fixture();f.root.children.find(n=>n.name==='Fern').x+=8;const raw=await f.export(),human=editProject(project,[{type:'update',id:'floor',changes:{color:'#8899aa'}},{type:'update',id:'vine',changes:{name:'Human name'}}]),merged=mergeFigmaReturn(human,raw);assert.equal(merged.objects[0].color,'#8899aa');assert.equal(merged.objects[1].name,'Human name');assert.equal(merged.objects[1].x,project.objects[1].x+8);
 const conflicting=editProject(human,[{type:'update',id:'vine',changes:{x:90}}]),before=structuredClone(conflicting);assert.throws(()=>mergeFigmaReturn(conflicting,raw),/conflict|changed/i);assert.deepEqual(conflicting,before);assert.deepEqual(mergeFigmaReturn(merged,raw),merged);
});
test('Figma refuses missing spawn and skew instead of returning damaged game data',async()=>{
 const f=await fixture(),vine=f.root.children.find(n=>n.name==='Fern');vine.relativeTransform=[[1,.4,0],[0,1,0]];await assert.rejects(f.export,/skew/);vine.relativeTransform=[[1,0,0],[0,1,0]];f.root.children.find(n=>n.name==='Spawn').remove();await assert.rejects(f.export,/Spawn/);
});
test('Figma snapshots do not overwrite earlier imports; metadata chunks stay under the API limit',async()=>{
 const f=await fixture(),first=f.root;first.name='Designer working';await f.figma.ui.onmessage({type:'import',data:{format:'pixel-mill-figma',version:1,project:{...project,name:'New snapshot'},rasters:[{id:'fern',w:2,h:2,src:png}],appearances:[],bounds:bounds(project.objects,project.spawn)}});assert.equal(first.name,'Designer working');assert.equal(f.page.children.length,4);assert.equal(f.page.selection[0].name,'New snapshot');
});

test('new instances of an appearance component retain ladder behavior and edited component art retains original sources',async()=>{
 const f=await fixture(),library=f.page.children.find(n=>n!==f.root),ladder=library.children.find(n=>f.get(n,'component')?.objectId==='ladder'),instance=ladder.createInstance();f.root.appendChild(instance);instance.name='Second climb';instance.x=140;instance.y=10;
 const assetComponent=library.children.find(n=>f.get(n,'component')?.assetId==='fern');assetComponent.name='Assets / Renamed fern';assetComponent.fills=[{type:'SOLID',color:{r:0,g:1,b:0}}];const result=readFigmaReturn(await f.export()).project;assert.equal(result.objects.at(-1).kind,'ladder');assert.equal(result.assets[0].src,png);assert.equal(result.assets[0].name,'Renamed fern');assert.notEqual(result.objects.find(o=>o.id==='vine').asset,'fern');assert.ok(result.assets.some(a=>a.id===result.objects.find(o=>o.id==='vine').asset));
});
test('large Unicode level metadata is chunked and returns intact',async()=>{
 const f=await fixture(),many=validateProject({...project,objects:Array.from({length:500},(_,i)=>({...project.objects[0],id:'rock-'+i,name:'🌿'.repeat(40),x:i*16}))});await f.figma.ui.onmessage({type:'import',data:{format:'pixel-mill-figma',version:1,project:many,rasters:[{id:'fern',w:2,h:2,src:png}],appearances:[],bounds:bounds(many.objects,many.spawn)}});f.root=f.page.selection[0];assert.ok(Number(f.root.getSharedPluginData('pixelMill','levelCount'))>1);assert.deepEqual(readFigmaReturn(await f.export()).project,many);
});

test('nested Figma groups retain piece identity, collision and inherited opacity',async()=>{
 const f=await fixture(),floor=f.root.children.find(n=>n.name==='Floor'),vine=f.root.children.find(n=>n.name==='Fern'),outer=f.figma.createFrame(),inner=f.figma.createFrame();f.root.appendChild(outer);outer.appendChild(inner);inner.appendChild(floor);inner.appendChild(vine);outer.x=20;outer.y=10;inner.x=3;inner.y=4;outer.opacity=.5;const result=readFigmaReturn(await f.export()).project;assert.equal(result.objects.length,project.objects.length);assert.equal(result.objects.find(o=>o.id==='floor').kind,'solid');assert.equal(result.objects.find(o=>o.id==='vine').x,project.objects[1].x+23);assert.equal(result.objects.find(o=>o.id==='vine').opacity,.3);
});

test('native masks remain exact through Figma appearance instances, movement and duplication',async()=>{
 const f=await fixture(),mask={w:4,h:4,runs:[[0,0,4],[1,0,1],[1,3,4],[2,0,1],[2,3,4],[3,0,4]]},masked=editProject(project,[{type:'update',id:'floor',changes:{mask}}]);
 await f.figma.ui.onmessage({type:'import',data:{format:'pixel-mill-figma',version:1,project:masked,rasters:[{id:'fern',w:2,h:2,src:png}],appearances:[{id:'floor',w:120,h:12,src:png}],bounds:bounds(masked.objects,masked.spawn)}});f.root=f.page.selection[0];assert.deepEqual(readFigmaReturn(await f.export()).project,masked);
 const floor=f.root.children.find(n=>n.name==='Floor');assert.equal(floor.type,'INSTANCE');floor.x+=9;const copy=floor.clone();f.root.appendChild(copy);copy.x+=130;
 const result=readFigmaReturn(await f.export()).project;assert.deepEqual(result.objects[0].mask,mask);assert.deepEqual(result.objects.at(-1).mask,mask);assert.equal(result.objects[0].x,masked.objects[0].x+9);assert.notEqual(result.objects.at(-1).id,'floor');
});

test('repainted cropped mask rebases its native source while preserving flipped rotated collisions and holes',async()=>{
 const f=await fixture(),mask={w:8,h:8,runs:Array.from({length:8},(_,y)=>y===3||y===4?[[y,0,3],[y,5,8]]:[[y,0,8]]).flat()},cropped=editProject(project,[{type:'update',id:'vine',changes:{mask,kind:'solid'}},{type:'crop',id:'vine',rect:{x:3,y:5,w:6,h:10}}]);
 await f.figma.ui.onmessage({type:'import',data:{format:'pixel-mill-figma',version:1,project:cropped,rasters:[{id:'fern',w:2,h:2,src:png}],appearances:[{id:'vine',w:6,h:10,src:png}],bounds:bounds(cropped.objects,cropped.spawn)}});f.root=f.page.selection[0];const node=f.root.children.find(n=>n.name==='Fern'),component=await node.getMainComponentAsync();component.fills=[{type:'SOLID',color:{r:0,g:1,b:0}}];
 const returned=readFigmaReturn(await f.export()).project,changed=returned.objects.find(o=>o.id==='vine');assert.equal(changed.crop,null);assert.equal(changed.flip,true);assert.notEqual(changed.asset,'fern');assert.deepEqual(changed.mask,{w:4,h:4,runs:[[0,0,4],[1,0,1],[1,3,4],[2,0,1],[2,3,4],[3,0,4]]});assert.deepEqual(platforms(returned.objects),platforms(cropped.objects));assert.deepEqual(returned.assets[0],cropped.assets[0]);
});

test('repaint rejects a fractional native crop boundary instead of silently shifting a mask',async()=>{
 const f=await fixture(),mask={w:8,h:8,runs:Array.from({length:8},(_,y)=>[y,0,8])},cropped=editProject(project,[{type:'update',id:'vine',changes:{mask}},{type:'crop',id:'vine',rect:{x:1,y:1,w:6,h:10}}]);
 await f.figma.ui.onmessage({type:'import',data:{format:'pixel-mill-figma',version:1,project:cropped,rasters:[{id:'fern',w:2,h:2,src:png}],appearances:[{id:'vine',w:6,h:10,src:png}],bounds:bounds(cropped.objects,cropped.spawn)}});f.root=f.page.selection[0];const node=f.root.children.find(n=>n.name==='Fern'),component=await node.getMainComponentAsync(),original=component.fills;component.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];await assert.rejects(()=>f.export(),/would shift its cropped mask/);component.fills=original;assert.deepEqual(readFigmaReturn(await f.export()).project,cropped);
});
