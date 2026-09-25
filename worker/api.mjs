import {designWithAgent,reserveChat} from './chat.mjs';
import {prepareArtwork,getArtworkRequest,applyArtwork,applyAssetSheet,prepareAssetArtwork,getAssetArtworkRequest,applyAssetArtwork} from '../dist/artwork.mjs';
import {validateProject} from '../dist/engine.mjs';
import {requireProjectName} from '../dist/project-name.mjs';
import {agentTools,editProject,projectInfo,compactProjectInfo,editSummary,projectDiff,applyDiff,simulate,imageProject,spriteSheetProject,inspectSpriteSheet,exportProjectSpriteSheet,getProjectAssetImage,patchSourceHash} from '../dist/agent.mjs';
const MAX_BYTES=32*1024*1024,TTL=7*86400000;
const response=(value,status=200,headers={})=>new Response(value===null?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
const toolResult=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
const fail=message=>({content:[{type:'text',text:message}],isError:true});
async function body(request){const length=Number(request.headers.get('content-length')||0);if(length>MAX_BYTES)throw Error('Project exceeds the 32 MB agent limit.');const text=await request.text();if(new TextEncoder().encode(text).length>MAX_BYTES)throw Error('Project exceeds the 32 MB agent limit.');return JSON.parse(text)}
async function keyFor(token){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return'rooms/'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}
function publicRoom(room,known=[]){
 if(!Array.isArray(known)||known.length>2000)throw Error('Invalid known asset versions.');
 // Old clients send only IDs, which cannot prove that their cached PNG is current.
 const versions=new Map(known.filter(pair=>Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&typeof pair[1]==='string'&&/^[a-f0-9]{64}$/.test(pair[1])));
 return{revision:room.revision,project:{...room.project,assets:room.project.assets.map(asset=>{const hash=versions.get(asset.id);return hash&&typeof asset.src==='string'&&patchSourceHash(asset.src)===hash?{...asset,src:undefined,sourceHash:hash}:asset})},control:room.control||null,canUndo:room.history.length>0};
}
async function saveRoom(bucket,key,room,etag){const text=JSON.stringify(room);if(new TextEncoder().encode(text).length>MAX_BYTES)throw Error('Agent project is full. Save locally or use fewer images.');const result=await bucket.put(key,text,{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!result)throw Error('Conflict: another edit arrived. Read the current revision and try again.');return result}
function revisionCheck(room,revision){if(!Number.isInteger(revision)||room.revision!==revision)throw Error('Conflict: read get_level again and use its current revision.')}
function commitRoom(room,next){const inverse=projectDiff(next,room.project);room.project=next;room.history.push(inverse);if(room.history.length>25)room.history.shift();room.revision++;room.expires=Date.now()+TTL}
function artworkHandoff(request,revision,includeImages=false){
 const {map,references=[],...manifest}=request;
 const info={revision,request:{...manifest,references:references.map(({src,...reference})=>reference)}};
 return{...toolResult(info),...(includeImages?{content:[{type:'text',text:JSON.stringify(info)},...(map?[{type:'image',mimeType:'image/png',data:map.split(',')[1]}]:[]),...references.map(reference=>({type:'image',mimeType:'image/png',data:reference.src.split(',')[1]}))]}:{})};
}
async function executeTool(name,args,room,bucket,key,etag){
 if(name==='inspect_sprite_sheet'){const info=await inspectSpriteSheet(room.project,args),image=args.includeImage?await getProjectAssetImage(room.project,{id:args.assetId}):null;return{...toolResult(info),...(image?{content:[{type:'text',text:JSON.stringify(info)},{type:'image',mimeType:'image/png',data:image.src.split(',')[1]}]}:{})}}
 if(name==='export_sprite_sheet'){const {src,w,h,name:filename}=await exportProjectSpriteSheet(room.project,args),info={assetId:args.assetId,name:filename,width:w,height:h};return{...toolResult(info),content:[{type:'text',text:JSON.stringify(info)},{type:'image',mimeType:'image/png',data:src.split(',')[1]}]}}
 if(['group_sprite_sheet','edit_sprite_sheet','group_workspace_sprites','ungroup_sprite_sheet'].includes(name)){revisionCheck(room,args.revision);const edited=await spriteSheetProject(room.project,name,args);commitRoom(room,edited.project);await saveRoom(bucket,key,room,etag);return toolResult({revision:room.revision,...edited.details})}
 if(name==='get_asset_artwork_request')return artworkHandoff(await getAssetArtworkRequest(room.project,{...args,includeImages:!!args.includeImages}),room.revision,!!args.includeImages);
 if(['prepare_asset_artwork','apply_asset_artwork'].includes(name)){revisionCheck(room,args.revision);const edited=await(name==='prepare_asset_artwork'?prepareAssetArtwork(room.project,{...args,includeImages:!!args.includeImages}):applyAssetArtwork(room.project,args));commitRoom(room,edited.project);await saveRoom(bucket,key,room,etag);return edited.request?artworkHandoff(edited.request,room.revision,!!args.includeImages):toolResult({revision:room.revision,...edited.details})}
 if(name==='get_artwork_request')return artworkHandoff(await getArtworkRequest(room.project,{...args,includeImages:!!args.includeImages}),room.revision,!!args.includeImages);
 if(['prepare_artwork','apply_artwork','apply_asset_sheet'].includes(name)){
  revisionCheck(room,args.revision);
  const edited=await(name==='prepare_artwork'?prepareArtwork(room.project,{...args,includeImages:!!args.includeImages}):name==='apply_artwork'?applyArtwork(room.project,args):applyAssetSheet(room.project,args));
  commitRoom(room,edited.project);await saveRoom(bucket,key,room,etag);
  return name==='prepare_artwork'?artworkHandoff(edited.request,room.revision,!!args.includeImages):toolResult({revision:room.revision,...edited.details});
 }
 if(name==='get_level')return toolResult({revision:room.revision,...(args.mode==='full'?projectInfo(room.project):compactProjectInfo(room.project))});
 if(name==='get_asset_image'){const a=await getProjectAssetImage(room.project,args);return{content:[{type:'text',text:JSON.stringify({id:a.id,name:a.name,width:a.w,height:a.h})},{type:'image',mimeType:'image/png',data:a.src.split(',')[1]}]}}
 if(name==='simulate_player')return toolResult(simulate(room.project,args.route));
 if(name==='get_canvas_preview'){const object=await bucket.get(key+'/preview');if(!object)throw Error('No preview yet. Open the connected editor.');const preview=await object.json();return{content:[{type:'text',text:JSON.stringify({revision:preview.revision,currentRevision:room.revision,capturedAt:preview.capturedAt})},{type:'image',mimeType:'image/png',data:preview.src.split(',')[1]}]}}
 if(['import_image','slice_spritesheet','create_spritesheet'].includes(name)){
  revisionCheck(room,args.revision);
  const edited=await imageProject(room.project,name,args);commitRoom(room,edited.project);
  await saveRoom(bucket,key,room,etag);
  const info={revision:room.revision,...edited.details};
  return{content:[{type:'text',text:JSON.stringify(info)},...(args.includeImage&&edited.image?[edited.image]:[])],structuredContent:info};
 }
 if(name==='edit_level'){
  revisionCheck(room,args.revision);const before=room.project,next=editProject(before,args.operations),delta=editSummary(before,next);
  commitRoom(room,next);
  try{await saveRoom(bucket,key,room,etag)}catch(error){
   if(!error.message.startsWith('Conflict:'))throw error;
   // Rebase only when every edited field still matches the read snapshot.
   const freshObject=await bucket.get(key);if(!freshObject)throw error;
   const fresh=await freshObject.json(),merged=applyDiff(fresh.project,projectDiff(before,next));
   commitRoom(fresh,merged);await saveRoom(bucket,key,fresh,freshObject.etag);
   room=fresh;
  }
  const info={revision:room.revision,...delta};
  if(args.verify){const objects=new Map(compactProjectInfo(room.project).objects.map(o=>[o.id,o]));info.objects=delta.changedIds.map(id=>objects.get(id)).filter(Boolean)}
  return toolResult(info);
 }
 else if(name==='undo_level'){revisionCheck(room,args.revision);if(!room.history.length)throw Error('Nothing to undo.');room.project=applyDiff(room.project,room.history.pop());room.revision++}
 else if(name==='set_play_mode'){if(typeof args.playing!=='boolean')throw Error('playing must be boolean.');room.control={id:crypto.randomUUID(),playing:args.playing};room.revision++}
 else throw Error('Unknown tool: '+name);
 await saveRoom(bucket,key,room,etag);return toolResult({revision:room.revision,...projectInfo(room.project),control:room.control||null});
}
export async function agentFetch(request,env){
 const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');if(origin&&origin!==url.origin&&origin!=='https://chatgpt.com')return response({error:'Origin not allowed'},403);
 if(path==='/api/chat/status')return response({enabled:!!env.OPENAI_API_KEY});
 if(!env.BUCKET)return response({error:'Agent sharing is not configured on this host.'},503);
 try{
  if(path==='/api/projects'&&request.method==='POST'){
   const value=await body(request),project=validateProject(value.project),token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),key='projects/'+await keyFor(token);
   requireProjectName(project.name);if(value.roomToken!==undefined&&!/^[a-f0-9]{64}$/.test(value.roomToken))throw Error('Invalid room link.');
   await saveRoom(env.BUCKET,key,{project,revision:0,...(value.roomToken?{roomToken:value.roomToken}:{})});return response({token,revision:0},201);
  }
  const projectMatch=path.match(/^\/api\/projects\/([a-f0-9]{64})$/);
  if(projectMatch){
   const key='projects/'+await keyFor(projectMatch[1]),object=await env.BUCKET.get(key);if(!object)return response({error:'Project not found.'},404);const saved=await object.json();
   if(request.method==='GET')return saved.deletedAt?response({error:'Project was deleted. Restore it from the deleting device.'},410):response(saved);
   if(!['PUT','DELETE','POST'].includes(request.method))return response({error:'Method not allowed'},405);
   const value=await body(request);revisionCheck(saved,value.revision);
   if(request.method==='DELETE'){saved.deletedAt=Date.now();saved.revision++;await saveRoom(env.BUCKET,key,saved,object.etag);return response({revision:saved.revision,deleted:true})}
   if(request.method==='POST'){if(!value.restore||!saved.deletedAt)throw Error('No deleted project to restore.');delete saved.deletedAt;saved.revision++;await saveRoom(env.BUCKET,key,saved,object.etag);return response({revision:saved.revision,restored:true})}
   if(saved.deletedAt)return response({error:'Project was deleted. Your local copy is kept.'},410);
   const project=validateProject(value.project);requireProjectName(project.name);if(value.roomToken!==undefined&&!/^[a-f0-9]{64}$/.test(value.roomToken))throw Error('Invalid room link.');
   const next={project,revision:saved.revision+1,...(value.roomToken||saved.roomToken?{roomToken:value.roomToken||saved.roomToken}:{})};await saveRoom(env.BUCKET,key,next,object.etag);return response({revision:next.revision})
  }
  if(path==='/api/rooms'&&request.method==='POST'){
   const project=validateProject(await body(request)),token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),key=await keyFor(token),room={project,revision:0,history:[],expires:Date.now()+TTL};await saveRoom(env.BUCKET,key,room);return response({token,...publicRoom(room)},201);
  }
  const match=path.match(/^\/(api\/rooms|mcp)\/([a-f0-9]{64})(\/(?:preview|chat))?$/);if(!match)return response({error:'Not found'},404);
  const [,route,token,preview]=match,key=await keyFor(token),object=await env.BUCKET.get(key);if(!object)return response({error:'Agent link is inactive.'},404);const room=await object.json();if(room.expires<Date.now()){await env.BUCKET.delete([key,key+'/preview']);return response({error:'Agent link expired. Create a new link in the editor.'},410)}
  if(route==='mcp'){
   if(request.method!=='POST')return response({error:'Use Streamable HTTP POST. Server-initiated SSE is not offered.'},405,{Allow:'POST'});
   const version=request.headers.get('mcp-protocol-version');if(version&&!['2025-03-26','2025-06-18','2025-11-25'].includes(version))return response({error:'Unsupported protocol version'},400);
   let rpc;try{rpc=await body(request)}catch{return response({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},400)}
   if(!rpc||Array.isArray(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')return response({jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'Invalid Request'}},400);
   if(rpc.id===undefined)return response(null,202);
   let result;if(rpc.method==='initialize')result={protocolVersion:['2025-03-26','2025-06-18','2025-11-25'].includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'pixel-mill',version:'1.4.0'},instructions:'Read the compact level once and batch edits. Use prepare_artwork to hand off the semantic sketch with selected sheets, apply_artwork to map a returned coherent PNG onto original shapes, or apply_asset_sheet to reuse sheets without generating pixels. Request images only for handoff or visual inspection. Tool schemas define parameters. The private URL grants access only to this level.'};
   else if(rpc.method==='ping')result={};
   else if(rpc.method==='tools/list')result={tools:agentTools};
   else if(rpc.method==='tools/call'){try{result=await executeTool(rpc.params?.name,rpc.params?.arguments||{},room,env.BUCKET,key,object.etag)}catch(error){result=fail(error.message)}}
   else return response({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Method not found'}});
   return response({jsonrpc:'2.0',id:rpc.id,result});
  }
  if(preview==='/chat'){
   if(request.method==='GET')return response({messages:room.chat||[]});
   if(request.method!=='POST')return response({error:'Method not allowed'},405);
   if(!env.OPENAI_API_KEY)return response({error:'Chat is not connected yet. The site owner needs to connect OpenAI.'},503);
   const value=await body(request);revisionCheck(room,value.revision);
   if(typeof value.message!=='string'||!value.message.trim()||value.message.length>4000)throw Error('Write a message under 4,000 characters.');
   if(room.lastChat&&Date.now()-room.lastChat<5000)throw Error('Wait a moment before sending again.');
   await reserveChat(env.BUCKET,env);
   const answer=await designWithAgent({project:room.project,message:value.message,history:room.chat,grid:value.grid,preview:value.preview,assetIds:value.assetIds,objectIds:value.objectIds},env);
   // Conditional save rejects any human/agent edit made while GPT was thinking.
   const changed=JSON.stringify(room.project)!==JSON.stringify(answer.project);if(changed)commitRoom(room,answer.project);else room.revision++;
   room.chat=[...(room.chat||[]),{role:'user',content:value.message},{role:'assistant',content:answer.reply}].slice(-24);room.lastChat=Date.now();room.expires=Date.now()+TTL;
   await saveRoom(env.BUCKET,key,room,object.etag);return response({reply:answer.reply,changed,room:publicRoom(room)});
  }
  if(preview){if(request.method!=='POST')return response({error:'Method not allowed'},405);const value=await body(request);if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.src)||value.src.length>3000000||!Number.isInteger(value.revision))throw Error('Invalid preview.');await env.BUCKET.put(key+'/preview',JSON.stringify({src:value.src,revision:value.revision,capturedAt:new Date().toISOString()}));return response({ok:true})}
  if(request.method==='GET'){if(url.searchParams.get('revision')===String(room.revision))return response(null,304);const known=url.searchParams.has('assetVersions')?JSON.parse(url.searchParams.get('assetVersions')):[];return response(publicRoom(room,known))}
  if(request.method==='DELETE'){await env.BUCKET.delete([key,key+'/preview']);return response({revoked:true})}
  if(request.method==='PATCH'){const value=await body(request);commitRoom(room,applyDiff(room.project,value.diff));await saveRoom(env.BUCKET,key,room,object.etag);return response(publicRoom(room,value.knownAssets||[]))}
  if(request.method==='POST'){const value=await body(request);const result=await executeTool(value.name,value.arguments||{},room,env.BUCKET,key,object.etag);return response(result)}
  return response({error:'Method not allowed'},405);
 }catch(error){return response({error:error.message},error.message.startsWith('Conflict:')?409:400)}
}
