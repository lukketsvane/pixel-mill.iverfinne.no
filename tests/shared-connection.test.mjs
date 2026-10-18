import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedLevel} from '../dist/shared.mjs';
import {applyDiff} from '../dist/agent.mjs';
import {validateProject} from '../dist/engine.mjs';

const blank=()=>({format:'max-level-studio',version:1,name:'Untitled',spawn:{x:0,y:0},assets:[],objects:[]});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function client(beforeConnect){let project=blank();const shared=new SharedLevel({snapshot:()=>structuredClone(project),committedSnapshot:()=>structuredClone(project),beforeConnect,busy:()=>false,localChanges:()=>false,async apply(value,{guard}){if(!guard())return false;project=structuredClone(value)},changed(){},status(){},setPlay(){},error(error){throw Error(error)}});shared.live.start=()=>{};shared.live.pull=async()=>{};shared.capture=()=>{};shared.url=()=>'/mcp/'+shared.token;return{shared,get:()=>project,set:value=>project=structuredClone(value)}}

test('background connections share one request and preserve committed edits while creating a link',async()=>{
 const gate=deferred(),started=deferred(),initial=blank();let calls=0,current;
 const c=client(async()=>({connectionToken:'706d763200000001'+'a'.repeat(48),project:initial}));
 c.shared.request=async(path,options)=>{calls++;if(path==='/api/rooms'){assert.deepEqual(JSON.parse(options.body).project,initial);started.resolve();await gate.promise;current={token:'room',revision:0,project:initial};return structuredClone(current)}assert.equal(path,'/api/rooms/room');current={...current,revision:current.revision+1,project:applyDiff(current.project,JSON.parse(options.body).diff)};return structuredClone(current)};
 const first=c.shared.connect(),second=c.shared.connect();assert.equal(first,second);await started.promise;
 const drawn=blank();drawn.objects=[{id:'new-floor',kind:'solid',x:0,y:0,w:32,h:8}];c.set(drawn);gate.resolve();await first;
 assert.equal(calls,2);assert.deepEqual(c.get(),validateProject(drawn));assert.equal(c.shared.connected,true);assert.equal(c.shared.revision,1);c.shared.detach();
});

test('switching project during background preparation cannot attach or overwrite the new project',async()=>{
 const gate=deferred(),started=deferred();let requests=0;const c=client(async()=>{started.resolve();await gate.promise;return{projectToken:'old'}});
 c.shared.request=async()=>{requests++;throw Error('The old project must not be requested')};
 const pending=c.shared.connect();await started.promise;c.shared.detach();const next={...blank(),name:'New project'};c.set(next);gate.resolve();await pending;
 assert.equal(requests,0);assert.equal(c.shared.token,null);assert.deepEqual(c.get(),next);
});

test('a lost connection response retries the same frozen draft and rebases later pen edits',async()=>{
 const initial=blank(),connectionToken='706d763200000001'+'b'.repeat(48);let attempts=0,current;
 const c=client(async()=>({connectionToken,project:initial}));c.shared.request=async(path,options)=>{const payload=JSON.parse(options.body);if(path==='/api/rooms'){assert.equal(payload.connectionToken,connectionToken);assert.deepEqual(payload.project,initial);if(!attempts++){current={token:'same-room',revision:0,project:initial};throw Error('Response lost')}return structuredClone(current)}current={...current,revision:current.revision+1,project:applyDiff(current.project,payload.diff)};return structuredClone(current)};
 await assert.rejects(c.shared.connect(),/Response lost/);const drawn=blank();drawn.objects=[{id:'retained-pen-stroke',kind:'solid',x:1,y:2,w:16,h:8}];c.set(drawn);await c.shared.connect();
 assert.equal(attempts,2);assert.equal(c.shared.token,'same-room');assert.deepEqual(c.get(),validateProject(drawn));c.shared.detach();
});

test('reads and persistence cannot overtake a remote undo while restored pixels are decoding',async()=>{
 const c=client(),decoding=deferred(),release=deferred(),restored={...blank(),name:'Restored artwork'};let reads=0;
 c.shared.token='room';c.shared.api.apply=async(next,{guard})=>{decoding.resolve();await release.promise;if(!guard())return false;c.set(next)};
 c.shared.request=async(path,options={})=>{if(!options.body)return{revision:1,project:restored};const {name}=JSON.parse(options.body);if(name==='get_level'){reads++;assert.equal(c.get().name,'Restored artwork')}return{structuredContent:{revision:1,name:restored.name}}};
 const undo=c.shared.tool('undo_level',{revision:0});await decoding.promise;c.shared.api.persist=()=>Promise.resolve();const save=c.shared.push(c.get(),c.get()),read=c.shared.tool('get_level');await Promise.resolve();await Promise.resolve();assert.equal(reads,0);
 release.resolve();await Promise.all([undo,save,read]);assert.equal(reads,1);assert.deepEqual(c.get(),restored);c.shared.detach();
});

test('an image action cannot dispatch after its selected project changes during persistence',async()=>{
 const c=client(),started=deferred(),release=deferred();let current=true,requests=0;
 c.shared.token='room';c.shared.api.persist=async()=>{started.resolve();await release.promise};c.shared.request=async()=>{requests++;throw Error('A stale image action must not be sent')};
 const edit=c.shared.tool('edit_asset_image',{revision:0,assetId:'same-id',action:'segment'},()=>current);await started.promise;current=false;release.resolve();
 await assert.rejects(edit,/active project changed/);assert.equal(requests,0);c.shared.detach();
});
