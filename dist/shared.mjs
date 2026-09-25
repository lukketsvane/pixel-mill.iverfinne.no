import {projectDiff,patchSourceHash} from './agent.mjs';
import {LiveUpdates} from './live-updates.mjs';
const sharedSourceVersions=assets=>assets.filter(asset=>typeof asset.src==='string').map(asset=>[asset.id,patchSourceHash(asset.src)]);
function sharedVersionQuery(assets){
 const pairs=[];let length=6;for(const asset of assets.filter(a=>typeof a.src==='string').sort((a,b)=>b.src.length-a.src.length)){const pair=[asset.id,patchSourceHash(asset.src)],size=encodeURIComponent(JSON.stringify(pair)).length+3;if(length+size>6000)continue;pairs.push(pair);length+=size}
 return'assetVersions='+encodeURIComponent(JSON.stringify(pairs));
}
function sharedVisualAssets(project){const ids=new Set(project.objects.flatMap(object=>[object.asset,object.artwork?.asset]).filter(Boolean));for(const id of [...ids]){const asset=project.assets.find(a=>a.id===id);for(const frame of asset?.spriteSheet?.frames||[]){if(frame.sourceAssetId)ids.add(frame.sourceAssetId);if(frame.artwork?.asset)ids.add(frame.artwork.asset)}}return ids}
export class SharedLevel{
 constructor(api){
  this.api=api;this.token=null;this.revision=0;this.applied=-1;this.pending=0;this.queue=Promise.resolve();this.canUndo=false;this.paused=false;this.lastControl=null;this.epoch=0;this.acceptSequence=0;
  this.live=new LiveUpdates({revision:()=>this.applied,refresh:guard=>this.poll(guard),status:text=>{if(!this.paused)this.api.status?.(text)},gone:text=>{this.paused=true;this.api.status?.('Link inactive · local copy kept');this.api.error(text);this.api.connection?.()}});
 }
 get connected(){return !!this.token&&!this.paused}
 async request(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});if(r.status===304)return null;const data=await r.json();if(!r.ok||data.isError)throw Object.assign(Error(data.error||data.content?.[0]?.text||'Agent connection failed.'),{status:r.status});return data}
 async connect(token){
  await this.queue;const project=await this.api.beforeConnect?.(token);const epoch=++this.epoch;this.live.stop();this.paused=false;
  const starting=this.api.snapshot();let room;
  try{
   if(token){this.token=token;room=await this.request('/api/rooms/'+token)}
   else{room=await this.request('/api/rooms',{method:'POST',body:JSON.stringify(project?.projectToken?project:starting)});if(epoch!==this.epoch)return;this.token=room.token}
   if(epoch!==this.epoch)return;
   this.revision=room.revision;this.applied=-1;this.incoming=null;this.lastControl=null;
   if(!token&&JSON.stringify(starting)!==JSON.stringify(this.api.snapshot()))await this.push(starting,this.api.snapshot());
   else await this.accept(room);
   if(epoch!==this.epoch)return;
   this.live.start('/api/rooms/'+this.token);void this.live.pull();this.capture();this.api.connection?.();return this.url();
  }catch(error){if(epoch===this.epoch){this.paused=true;this.live.stop();this.api.connection?.()}throw error}
 }
 detach(){this.epoch++;this.live.stop();this.token=null;this.paused=false;this.incoming=null;this.lastControl=null;clearTimeout(this.timer);clearTimeout(this.previewTimer);this.api.connection?.()}
 url(){return location.origin+'/mcp/'+this.token}
 async accept(room){
  if(!room||room.revision<this.revision||room.revision<=this.applied)return;
  const ticket=++this.acceptSequence,epoch=this.epoch,previous=this.api.snapshot();
  const cache=new Map(previous.assets.map(asset=>[asset.id,asset]));let missing=false;
  room.project.assets=room.project.assets.map(value=>{const {sourceHash,...asset}=value;if(typeof asset.src==='string'||asset.spriteSheet?.source==='assets')return asset;const cached=cache.get(asset.id);if(typeof cached?.src==='string'&&sourceHash===patchSourceHash(cached.src))return{...asset,src:cached.src};missing=true;return asset});
  if(missing){if(!this.token)throw Error('Missing image source. Reconnect the agent session.');const fresh=await this.request('/api/rooms/'+this.token);if(ticket===this.acceptSequence&&epoch===this.epoch)return this.accept(fresh);return}
  const visualChanged=JSON.stringify(previous.objects)!==JSON.stringify(room.project.objects)||JSON.stringify(previous.spawn)!==JSON.stringify(room.project.spawn)||[...sharedVisualAssets(room.project)].some(id=>{const old=cache.get(id),current=room.project.assets.find(asset=>asset.id===id);return old?.src!==current?.src||JSON.stringify(old?.spriteSheet)!==JSON.stringify(current?.spriteSheet)});
  this.revision=room.revision;this.canUndo=room.canUndo;
  if(this.api.busy()||this.pending){this.incoming=room;this.api.status?.('Changes waiting…');return false}
  const guard=()=>ticket===this.acceptSequence&&epoch===this.epoch&&room.revision>=this.revision&&!this.pending&&!this.paused;
  if(await this.api.apply(room.project,{guard,remote:true})===false){if(guard())this.incoming=room;return false}
  if(!guard())return false;
  this.applied=room.revision;this.incoming=null;
  if(room.control&&room.control.id!==this.lastControl){this.lastControl=room.control.id;this.api.setPlay(room.control.playing)}
  this.api.accepted?.(room,this.token);this.api.changed();this.api.status?.('Live · r'+room.revision);if(visualChanged)this.capture();return true;
 }
 push(before,after){
  if(!this.connected)return;const diff=projectDiff(before,after);if(!Object.keys(diff).some(k=>Array.isArray(diff[k])?diff[k].length:true))return;
  const epoch=this.epoch,token=this.token;this.pending++;this.api.status?.('Saving…');
  this.queue=this.queue.then(async()=>{
   if(epoch!==this.epoch||this.paused)return;
   const room=await this.request('/api/rooms/'+token,{method:'PATCH',body:JSON.stringify({diff,knownAssets:sharedSourceVersions(after.assets)})});
   if(epoch===this.epoch&&room.revision>=this.revision){this.revision=room.revision;this.incoming=room}
  }).catch(error=>{if(epoch!==this.epoch)return;this.paused=true;this.live.stop();this.api.status?.(error.status===409?'Conflict · local copy kept':'Offline · local copy kept');this.api.error(error.message+' Your local edits are kept. Open Projects to save a recovery copy or load the latest version.');this.api.connection?.()}).finally(async()=>{this.pending--;if(epoch===this.epoch&&!this.pending&&!this.paused&&this.incoming)await this.accept(this.incoming)});
  return this.queue;
 }
 async poll(guard=()=>true){
  const epoch=this.epoch,token=this.token;if(!token||this.paused)return;
  if(this.pending||this.api.busy())return false;
  if(this.incoming&&await this.accept(this.incoming)===false)return false;
  const versions=sharedVersionQuery(this.api.snapshot().assets),room=await this.request('/api/rooms/'+token+'?revision='+this.applied+'&'+versions);
  if(epoch===this.epoch&&guard())return this.accept(room);return true;
 }
 async tool(name,args={}){await this.queue;if(this.paused)throw Error('Reconnect the agent session first.');const epoch=this.epoch,token=this.token;const result=await this.request('/api/rooms/'+token,{method:'POST',body:JSON.stringify({name,arguments:args})});if(epoch!==this.epoch)throw Error('The active project changed.');if(!['get_level','get_asset_image','get_artwork_request','get_asset_artwork_request','inspect_sprite_sheet','simulate_player','get_canvas_preview','export_sprite_sheet'].includes(name)){const versions=sharedVersionQuery(this.api.snapshot().assets);const room=await this.request('/api/rooms/'+token+'?'+versions);if(epoch===this.epoch)await this.accept(room)}return result}
 capture(){if(!this.connected)return;clearTimeout(this.previewTimer);const epoch=this.epoch,token=this.token;this.previewTimer=setTimeout(async()=>{if(epoch!==this.epoch||this.api.busy()||this.pending)return;try{const revision=this.applied,src=await this.api.preview();if(epoch===this.epoch&&revision===this.applied)await this.request('/api/rooms/'+token+'/preview',{method:'POST',body:JSON.stringify({src,revision})})}catch{}},400)}
 async disconnect(){await this.queue;const token=this.token;try{await this.request('/api/rooms/'+token,{method:'DELETE'})}catch(error){if(![404,410].includes(error.status))throw error}this.detach();this.api.changed()}
}
