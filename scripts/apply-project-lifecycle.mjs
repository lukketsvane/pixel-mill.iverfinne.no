import fs from 'node:fs';
function replace(file,before,after){const source=fs.readFileSync(file,'utf8');if(source.includes(after))return;if(!source.includes(before))throw Error('Expected source changed: '+file+' / '+before.slice(0,100));fs.writeFileSync(file,source.replace(before,after))}
const routes='worker/project-routes.mjs';
replace(routes,"import {validateProject} from '../dist/engine.mjs';", "import {validateProject} from '../dist/engine.mjs';\nimport {resolveSavedProject} from './legacy-projects.mjs';");
replace(routes,"const existing=await resolveProject(bucket,key);return response({token,...publicRoom(existing.record)})", "const existing=await resolveSavedProject(bucket,keyFor,token);return response({token,...publicRoom(existing.record)})");
replace(routes,"resolveProject(bucket,'projects/'+await keyFor(match[1]),{allowDeleted:request.method==='POST'})", "resolveSavedProject(bucket,keyFor,match[1],{allowDeleted:request.method==='POST'})");
replace(routes,"resolveProject(bucket,'projects/'+await keyFor(value.projectToken)),room=found.record", "resolveSavedProject(bucket,keyFor,value.projectToken),room=found.record");
replace('scripts/build.mjs',"+'\\n'+fs.readFileSync('worker/project-routes.mjs','utf8')", "+'\\n'+fs.readFileSync('worker/legacy-projects.mjs','utf8')+'\\n'+fs.readFileSync('worker/project-routes.mjs','utf8')");
replace('dist/autosave.mjs',"if(!remote.projectToken&&projectName(remote.project.name))remote=", "if(!remote.projectToken&&saved?.token)remote=await this.request('/api/projects/'+saved.token);else if(!remote.projectToken&&projectName(remote.project.name))remote=");
replace('dist/autosave.mjs',"if(remote&&!saved?.dirty)saved=", "if(remote?.projectToken)token=remote.projectToken;\n  if(remote&&!saved?.dirty)saved=");
// A legacy deleted record has a valid snapshot; the undo path already accepts
// deletedAt and restores it through the original capability. This test also
// verifies the old separate snapshot cannot overrule subsequent GPT edits.
const file='tests/project-lifecycle.test.mjs';let tests=fs.readFileSync(file,'utf8');
if(!tests.includes('legacy separate saved snapshots resolve to live room state'))tests+=`
test('legacy separate saved snapshots resolve to live room state without forking or losing the old recovery',async()=>{
 const {call,env}=harness();const room=await json(await call('/api/rooms','POST',base('Current room')),201);
 const saved=await json(await call('/api/projects','POST',{project:base('Old saved snapshot')}),201),path='/api/projects/'+saved.token;
 const key=[...env.BUCKET.data.keys()].find(k=>k.startsWith('projects/'));
 await env.BUCKET.put(key,JSON.stringify({project:base('Old saved snapshot'),revision:4,roomToken:room.token}));
 let current=await json(await call(path));assert.equal(current.project.name,'Current room');assert.equal(current.projectToken,saved.token);assert.equal(current.roomToken,room.token);
 assert.equal(JSON.parse(env.BUCKET.data.get(key).text).project.name,'Old saved snapshot');
 const changed=await json(await call('/mcp/'+room.token,'POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'edit_level',arguments:{revision:current.revision,operations:[{type:'rename',name:'Live after migration'}]}}}));assert.equal(changed.result.isError,undefined);
 current=await json(await call(path));assert.equal(current.project.name,'Live after migration');
 const deleted=await json(await call(path,'DELETE',{revision:current.revision}));assert.equal((await call(path)).status,410);assert.equal((await call('/api/rooms/'+room.token)).status,410);
 await json(await call(path,'POST',{restore:true,revision:deleted.revision}));assert.equal((await json(await call(path))).project.name,'Live after migration');assert.equal((await call('/api/rooms/'+room.token)).status,410);
});
`;
fs.writeFileSync(file,tests);
console.log('Integrated legacy project compatibility.');
