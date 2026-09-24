import test from 'node:test';
import assert from 'node:assert/strict';
import {newPlayer,stepPlayer,landing,solid,platforms,screenToWorld,zoomAt,validateProject} from '../dist/engine.mjs';
import {hsbToHex} from '../dist/color.mjs';
import {editProject} from '../dist/agent.mjs';
const floor={id:'floor',x:-200,y:0,w:400,h:20,solid:true};
const step=(p,input,n,ps=[floor])=>{for(let i=0;i<n;i++)stepPlayer(p,input,ps);return p};
test('Max stands, accelerates to original run speed, jumps and lands',()=>{
 const p=newPlayer({x:0,y:0});step(p,{},2);assert.equal(p.grounded,true);step(p,{axis:1},60);assert.equal(p.vx,88);
 step(p,{jump:true},42);assert.ok(p.y < -26 && p.y > -29);assert.equal(p.grounded,false);step(p,{},120);assert.equal(p.y,0);assert.equal(p.grounded,true);
});
test('short jump, coyote time, one-way landing and no air jump',()=>{
 const held=newPlayer({x:0,y:0}),tap=newPlayer({x:0,y:0});step(held,{},1);step(tap,{},1);step(held,{jump:true},25);step(tap,{jump:true},2);step(tap,{},23);assert.ok(held.y<tap.y-10);
 const p=newPlayer({x:0,y:0});step(p,{},1);step(p,{axis:1},1,[]);step(p,{axis:1,jump:true},1,[]);assert.ok(p.vy<0);step(p,{},1,[]);p.coyote=0;const previous=p.vy;step(p,{jump:true},1,[]);assert.ok(p.vy>previous);
 const one={id:'one',x:0,y:10,w:20,h:1,solid:false};assert.equal(landing([one],10,0,10,30)?.id,'one');assert.equal(landing([one],10,20,10,0),null);assert.equal(landing([one],10,10,40,11),null);
});
test('walls, ceilings, collision inset, and decorations',()=>{
 const wall={id:'wall',x:20,y:-50,w:20,h:70,solid:true};const p=newPlayer({x:0,y:0});step(p,{axis:1},120,[floor,wall]);assert.equal(p.x,16);
 const ceiling={id:'ceiling',x:-50,y:-30,w:100,h:5,solid:true};const q=newPlayer({x:0,y:0});step(q,{},1);step(q,{jump:true},20,[floor,ceiling]);assert.ok(q.y>=-7);
 assert.deepEqual(platforms([{id:'a',x:0,y:5,w:30,h:20,inset:4,kind:'platform'},{kind:'decor'}]),[{id:'a',x:0,y:9,w:30,h:16,solid:false}]);
});
test('camera zoom keeps the touched world pixel anchored',()=>{const c={x:-50,y:8,z:3},point={x:70,y:155},before=screenToWorld(point,c);zoomAt(c,point,8);const after=screenToWorld(point,c);assert.ok(Math.abs(after.x-before.x)<1e-9);assert.ok(Math.abs(after.y-before.y)<1e-9)});
test('project validation is atomic, rejects corrupt references and nonfinite positions',()=>{
 const valid={format:'max-level-studio',version:1,name:'Mine',spawn:{x:0,y:0},assets:[],objects:[{id:'a',asset:null,name:'Floor',x:0,y:0,w:40,h:4,inset:0,kind:'solid'}]};assert.equal(validateProject(valid).objects.length,1);assert.throws(()=>validateProject({...valid,spawn:{x:NaN,y:0}}));assert.throws(()=>validateProject({...valid,objects:[{...valid.objects[0],asset:'missing'}]}));assert.equal(valid.objects[0].asset,null);
});
test('painted collision remains solid while asset adjustments survive save and agent edits',()=>{
 const base={format:'max-level-studio',version:1,name:'Paint',spawn:{x:20,y:0},assets:[{id:'image',name:'Sprite',w:2,h:2,src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6T3sAAAAASUVORK5CYII='}],objects:[{id:'piece',asset:'image',name:'Sprite',x:0,y:0,w:20,h:20,kind:'decor',inset:0}]};
 const result=editProject(base,[{type:'stroke',id:'paint',points:[{x:0,y:10},{x:40,y:10}],width:6},{type:'update',id:'piece',changes:{adjust:{hue:45,saturation:20,brightness:10,black:5,white:240}}}]);
 assert.equal(result.objects[1].collisionOnly,true);assert.equal(result.objects[0].adjust.hue,45);const collision=platforms(result.objects);assert.ok(collision.some(p=>p.solid&&p.x<=20&&p.x+p.w>=20&&p.y<=10&&p.y+p.h>=10));assert.equal(validateProject(result).objects[1].points.length,2);
 assert.throws(()=>validateProject({...result,objects:[{...result.objects[1],points:[{x:NaN,y:1}]}]}));
 const block=editProject({format:'max-level-studio',version:1,name:'Blocks',spawn:{x:0,y:0},assets:[],objects:[{id:'b',asset:null,name:'Stone',x:0,y:0,w:8,h:8,kind:'solid',inset:0,color:'#445566'}]},[{type:'update',id:'b',changes:{adjust:{hue:90,saturation:-20,brightness:5,black:0,white:255}}}]);assert.equal(block.objects[0].adjust.hue,90);
});
test('block picker color survives level edits and project validation',()=>{
 assert.equal(hsbToHex(0,100,100),'#ff0000');assert.equal(hsbToHex(120,100,100),'#00ff00');assert.equal(hsbToHex(240,100,100),'#0000ff');
 const base={format:'max-level-studio',version:1,name:'Color',spawn:{x:0,y:0},assets:[],objects:[]};
 const red=editProject(base,[{type:'block',id:'red',color:hsbToHex(0,100,100)}]);
 assert.equal(red.objects[0].color,'#ff0000');assert.equal(editProject(red,[{type:'update',id:'red',changes:{color:'#123ABC'}}]).objects[0].color,'#123abc');
 assert.throws(()=>editProject(red,[{type:'update',id:'red',changes:{color:'red'}}]),/Invalid block color/);
 assert.equal(validateProject({...red,objects:[{...red.objects[0],color:undefined}]}).objects[0].color,undefined);
});
