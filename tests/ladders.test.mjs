import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,platforms,newPlayer,stepPlayer} from '../dist/engine.mjs';
import {simulate,editProject} from '../dist/agent.mjs';
import {localToWorld,worldToLocal} from '../dist/geometry.mjs';
import {MaxTouchInput} from '../dist/play-input.mjs';
const project=validateProject({format:'max-level-studio',version:1,name:'Climb',assets:[],spawn:{x:6,y:0},objects:[{id:'floor',asset:null,name:'Floor',x:-50,y:0,w:100,h:12,kind:'solid'},{id:'ladder',asset:null,name:'Ladder',x:0,y:-80,w:12,h:80,kind:'ladder'},{id:'upper',asset:null,name:'Top',x:-30,y:-80,w:70,h:4,kind:'platform'}]});
const tick=(p,input,n,ps=platforms(project.objects))=>{for(let i=0;i<n;i++)stepPlayer(p,input,ps);return p};
test('ladders support climb, release to hold, top exit, descent through a one-way top and bottom exit',()=>{
 const p=newPlayer(project.spawn);tick(p,{},2);assert.equal(p.grounded,true);tick(p,{climb:-1,jump:true},120);assert.equal(p.climbing,'ladder');assert.ok(Math.abs(p.y+42)<.01);
 const held=p.y;tick(p,{},90);assert.equal(p.y,held);assert.equal(p.vy,0);
 tick(p,{climb:-1},160);assert.ok(Math.abs(p.y+80)<.01);assert.equal(p.grounded,true);assert.equal(p.climbing,null);
 tick(p,{climb:1},140);assert.ok(p.y>-40&&p.y<-20);assert.equal(p.climbing,'ladder');tick(p,{climb:1},160);assert.equal(p.y,0);assert.equal(p.grounded,true);
});
test('ladders are non-solid and cannot become invisible landing platforms',()=>{
 const ps=platforms(project.objects.filter(o=>o.id==='ladder')),p=newPlayer({x:6,y:-100});tick(p,{},160,ps);assert.ok(p.y>100);assert.equal(p.grounded,false);assert.equal(p.climbing,null);
 const q=newPlayer({x:-20,y:-40});tick(q,{axis:1},60,ps);assert.ok(q.x>12);
});
test('jump and lateral movement leave a ladder without an immediate regrab; ceilings remain solid',()=>{
 const p=newPlayer(project.spawn);tick(p,{climb:-1},90);const y=p.y;tick(p,{jump:true,jumpOff:true,climb:-1},1);assert.equal(p.climbing,null);assert.ok(p.vy<0);assert.ok(p.y<y);tick(p,{jump:true,jumpOff:true,climb:-1},10);assert.equal(p.climbing,null);
 const q=newPlayer(project.spawn);tick(q,{climb:-1},60);tick(q,{axis:1},30);assert.equal(q.climbing,null);assert.ok(q.x>12);
 const ceiling={id:'ceiling',x:-30,y:-55,w:70,h:6,solid:true};const r=newPlayer(project.spawn);tick(r,{climb:-1},240,[...platforms(project.objects),ceiling]);assert.ok(r.y>=-31-.001);
});
test('ChatGPT creates and simulates ladders with the same controls as the game',()=>{
 const edited=editProject(project,[{type:'block',id:'next',x:60,y:-90,width:12,height:90,kind:'ladder'}]);assert.equal(edited.objects.at(-1).kind,'ladder');
 const result=simulate(project,[{seconds:1,climb:-1}]);assert.ok(Math.abs(result.end.y+42)<.01);assert.equal(result.end.climbing,'ladder');assert.throws(()=>simulate(project,[{seconds:1,climb:4}]),/Invalid movement/);
});
test('keyboard and sustained vertical touch provide climbing while Space is an explicit jump off',()=>{
 const controls=new MaxTouchInput();assert.equal(controls.read(new Set(['ArrowUp'])).climb,-1);assert.equal(controls.read(new Set(['KeyS'])).climb,1);assert.equal(controls.read(new Set(['Space'])).jumpOff,true);
 controls.down(1,100,200,0);controls.move(1,100,160);assert.equal(controls.read(new Set()).climb,-1);assert.equal(controls.read(new Set()).climb,-1);controls.up(1,100,160,100);assert.equal(controls.read(new Set()).climb,0);
 controls.down(2,100,200,200);controls.move(2,100,240);assert.equal(controls.read(new Set()).climb,1);controls.reset();assert.equal(controls.read(new Set()).climb,0);
});

test('an angled ladder follows its authored climb axis',()=>{
 const object={id:'angled',x:10,y:20,w:12,h:90,rotation:30,inset:0,kind:'ladder'},p=newPlayer(localToWorld({x:6,y:70},object));tick(p,{climb:-1},120,platforms([object]));const local=worldToLocal(p,object);assert.ok(Math.abs(local.x-6)<1e-6);assert.ok(Math.abs(local.y-28)<1e-6);assert.equal(p.climbing,'angled');
});
