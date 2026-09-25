import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedLevel} from '../dist/shared.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
const project=name=>({format:'max-level-studio',version:1,name,spawn:{x:0,y:0},assets:[],objects:[]});
const room=(revision,name)=>({revision,project:project(name),canUndo:revision>0});

test('a slow older room image decode cannot overwrite newer artwork',async()=>{
 let state=project('Original'),changes=0;const gates=new Map([['Old artwork',deferred()],['New artwork',deferred()]]),started=[];
 const shared=new SharedLevel({snapshot:()=>structuredClone(state),busy:()=>false,async apply(next,{guard}){started.push(next.name);await gates.get(next.name).promise;if(!guard())return false;state=next},changed(){changes++}});
 const old=shared.accept(room(1,'Old artwork'));
 const fresh=shared.accept(room(2,'New artwork'));
 gates.get('New artwork').resolve();await fresh;
 assert.equal(state.name,'New artwork');assert.equal(shared.applied,2);
 gates.get('Old artwork').resolve();await old;
 assert.equal(state.name,'New artwork');assert.equal(shared.applied,2);assert.equal(shared.incoming,null);assert.equal(changes,1);
 await shared.accept(room(1,'Old artwork'));await shared.accept(room(2,'New artwork'));
 assert.deepEqual(started,['Old artwork','New artwork'],'older and duplicate snapshots never trigger another decode');
});

test('disconnecting during image decode invalidates that room and busy edits retain only the newest incoming state',async()=>{
 let state=project('Human sketch'),busy=false;const gate=deferred();let changes=0;
 const shared=new SharedLevel({snapshot:()=>structuredClone(state),busy:()=>busy,async apply(next,{guard}){await gate.promise;if(!guard())return false;state=next},changed(){changes++}});
 const applying=shared.accept(room(1,'Cancelled artwork'));shared.detach();gate.resolve();await applying;
 assert.equal(state.name,'Human sketch');assert.equal(shared.applied,-1);assert.equal(shared.incoming,null);assert.equal(changes,0);
 busy=true;await shared.accept(room(2,'Waiting artwork'));await shared.accept(room(3,'Latest artwork'));await shared.accept(room(2,'Older poll'));
 assert.equal(shared.incoming.revision,3);assert.equal(state.name,'Human sketch');busy=false;await shared.accept(shared.incoming);
 assert.equal(state.name,'Latest artwork');assert.equal(shared.applied,3);assert.equal(changes,1);
});
