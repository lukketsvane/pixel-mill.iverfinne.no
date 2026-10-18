import {cloudRequest} from './cloud-request.mjs';
import {projectDiff,patchSourceHash} from './agent.mjs';
import {projectSourceVersions,projectVersionQuery} from './project-state.mjs';
import {LiveUpdates} from './live-updates.mjs';
function sharedVisualAssets(project){const ids=new Set(project.objects.flatMap(object=>[object.asset,object.artwork?.asset]).filter(Boolean));for(const id of [...ids]){const asset=project.assets.find(a=>a.id===id);for(const frame of asset?.spriteSheet?.frames||[]){if(frame.sourceAssetId)ids.add(frame.sourceAssetId);if(frame.artwork?.asset)ids.add(frame.artwork.asset)}}return ids}
export class SharedLevel{
 constructor(api){
  this.api=api;this.token=null;this.revision=0;this.applied=-1;this.pending=0;this.queue=Promise.resolve();this.canUndo=false;this.paused=false;this.lastControl=null;this.epoch=0;this.acceptSequence=0;
  this.live=new LiveUpdates({revision:()=>this.applied,refresh:guard=>this.poll(guard),status:text=>{if(!this.paused&&!this.api.localChanges?.())this.api.status?.(text)},gone:text=>{this.paused=true;this.api.status?.('Link inactive · local copy kept');this.api.error(text);this.api.connection?.()}});
 }
 get connected(){return !!this.token&&!this.paused}
 request(path,options={}){return cloudRequest(path,options)}
 connect(token){
  if(this.connecting)return this.connecting;
  const epoch=++this.epoch;this.live.stop();this.paused=true;
  this.connecting=this.connectRoom(token,epoch).finally(()=>{this.connecting=null});return this.connecting;
 }
 async connectRoom(token,epoch){
  await this.queue;if(epoch!==this.epoch)return;
  const project=await this.api.beforeConnect?.(token);if(epoch!==this.epoch)return;
  const starting=project?.project||this.api.committedSnapshot?.()||this.api.snapshot();let room;
  try{
   if(token)room=await this.request('/api/rooms/'+token);
   else room=await this.request('/api/rooms',{method:'POST',body:JSON.stringify(project?.projectToken?project:project?.connectionToken?{connectionToken:project.connectionToken,project:starting}:starting)});
   if(epoch!==this.epoch)return;
   this.token=token||room.token;this.paused=false;this.revision=room.revision;this.applied=-1;this.incoming=null;this.lastControl=null;
   const current=this.api.committedSnapshot?.()||this.api.snapshot(),base=project?.baseProject||starting;
   if((!token||project?.baseProject)&&JSON.stringify(base)!==JSON.stringify(current))await this.push(base,current);
   else await this.accept(room);
   if(epoch!==this.epoch)return;
   this.live.start('/api/rooms/'+this.token);void this.live.pull();this.capture();this.api.connection?.();return this.url();
  }catch(error){if(epoch===this.epoch){this.paused=true;this.live.stop();this.api.connection?.()}throw error}
 }
 detach(){this.epoch++;this.live.stop();this.token=null;this.paused=false;this.incoming=null;this.lastControl=null;this.lastPreviewSource=null;this.lastPreviewAt=0;clearTimeout(this.timer);clearTimeout(this.previewTimer);this.api.connection?.()}
 url(){return location.origin+'/mcp/'+this.token}
 async accept(room){
  if(!room||room.revision<this.revision||room.revision<=this.applied)return;
  const ticket=++this.acceptSequence,epoch=this.epoch,previous=this.api.snapshot();
  const cache=new Map(previous.assets.map(asset=>[asset.id,asset]));let missing=false;
  room.project.assets=room.project.assets.map(value=>{const {sourceHash,...asset}=value;if(typeof asset.src==='string'||asset.spriteSheet?.source==='assets')return asset;const cached=cache.get(asset.id);if(typeof cached?.src==='string'&&sourceHash===patchSourceHash(cached.src))return{...asset,src:cached.src};missing=true;return asset});
  if(missing){if(!this.token)throw Error('Missing image source. Reconnect the agent session.');const fresh=await this.request('/api/rooms/'+this.token);if(ticket===this.acceptSequence&&epoch===this.epoch)return this.accept(fresh);return}
  const visualChanged=JSON.stringify(previous.objects)!==JSON.stringify(room.project.objects)||JSON.stringify(previous.spawn)!==JSON.stringify(room.project.spawn)||[...sharedVisualAssets(room.project)].some(id=>{const old=cache.get(id),current=room.project.assets.find(asset=>asset.id===id);return old?.src!==current?.src||JSON.stringify(old?.spriteSheet)!==JSON.stringify(current?.spriteSheet)});
  this.revision=room.revision;this.canUndo=room.canUndo;
  if(this.api.busy()||this.pending||this.api.localChanges?.()){this.incoming=room;this.api.status?.('Changes waiting…');return false}
  const guard=()=>ticket===this.acceptSequence&&epoch===this.epoch&&room.revision>=this.revision&&!this.pending&&!this.paused&&!this.api.localChanges?.();
  if(await this.api.apply(room.project,{guard,remote:true})===false){if(guard())this.incoming=room;return false}
  if(!guard())return false;
  this.applied=room.revision;this.incoming=null;
  if(room.control&&room.control.id!==this.lastControl){this.lastControl=room.control.id;this.api.setPlay(room.control.playing)}
  this.api.accepted?.(room,this.token);this.api.changed();this.api.status?.('Live · r'+room.revision);if(visualChanged)this.capture();return true;
 }
 acknowledge(room,applied){
  if(!this.token||room.revision<this.revision)return;
  this.revision=room.revision;this.canUndo=room.canUndo;
  if(applied){this.applied=room.revision;this.incoming=null;if(room.control&&room.control.id!==this.lastControl){this.lastControl=room.control.id;this.api.setPlay(room.control.playing)}this.capture();this.api.changed()}
  else this.incoming=room;
 }
 push(before,after){
  if(this.connected){const persisted=this.api.persist?.();if(persisted){this.queue=Promise.all([this.queue,persisted]).then(()=>{});return this.queue}}
  if(!this.connected)return;const diff=projectDiff(before,after);if(!Object.keys(diff).some(k=>Array.isArray(diff[k])?diff[k].length:true))return;
  const epoch=this.epoch,token=this.token;this.pending++;this.api.status?.('Saving…');
  this.queue=this.queue.then(async()=>{
   if(epoch!==this.epoch||this.paused)return;
   const room=await this.request('/api/rooms/'+token,{method:'PATCH',body:JSON.stringify({diff,knownAssets:projectSourceVersions(after.assets)})});
   if(epoch===this.epoch&&room.revision>=this.revision){this.revision=room.revision;this.incoming=room}
  }).catch(error=>{if(epoch!==this.epoch)return;this.paused=true;this.live.stop();this.api.status?.(error.status===409?'Conflict · local copy kept':'Offline · local copy kept');this.api.error(error.message+' Your local edits are kept. Open Projects to save a recovery copy or load the latest version.');this.api.connection?.()}).finally(async()=>{this.pending--;if(epoch===this.epoch&&!this.pending&&!this.paused&&this.incoming)await this.accept(this.incoming)});
  return this.queue;
 }
 async poll(guard=()=>true){
  const epoch=this.epoch,token=this.token;if(!token||this.paused)return;
  if(this.api.localChanges?.()){await this.api.persist?.();if(this.api.localChanges?.())return true}
  if(this.pending||this.api.busy())return false;
  if(this.incoming&&await this.accept(this.incoming)===false)return false;
  const versions=projectVersionQuery(this.api.snapshot().assets),room=await this.request('/api/rooms/'+token+'?revision='+this.applied+'&'+versions);
  if(epoch===this.epoch&&guard())return this.accept(room);return true;
 }
 tool(name,args={},guard=()=>true){
  const epoch=this.epoch,token=this.token,readOnly=['get_level','get_asset_image','get_artwork_request','get_asset_artwork_request','inspect_sprite_sheet','simulate_player','get_canvas_preview','export_sprite_sheet'].includes(name);
  const result=this.queue.then(async()=>{if(epoch!==this.epoch||!guard())throw Error('The active project changed.');await this.api.persist?.();if(epoch!==this.epoch||!guard())throw Error('The active project changed.');if(this.api.localChanges?.())throw Error('Your changes are kept locally. Wait for cloud saving before using this tool.');if(this.paused)throw Error('Reconnect the agent session first.');const result=await this.request('/api/rooms/'+token,{method:'POST',body:JSON.stringify({name,arguments:args})});if(epoch!==this.epoch)throw Error('The active project changed.');if(!readOnly){const versions=projectVersionQuery(this.api.snapshot().assets);const room=await this.request('/api/rooms/'+token+'?'+versions);if(epoch===this.epoch)await this.accept(room)}return result});
  if(!readOnly)this.queue=result.catch(()=>{});return result;
 }
 capture(){if(!this.connected)return;clearTimeout(this.previewTimer);const epoch=this.epoch,token=this.token;this.previewTimer=setTimeout(async()=>{if(epoch!==this.epoch||this.api.busy()||this.pending)return;try{const revision=this.applied,src=await this.api.preview();if(epoch===this.epoch&&revision===this.applied&&src!==this.lastPreviewSource){await this.request('/api/rooms/'+token+'/preview',{method:'POST',body:JSON.stringify({src,revision})});if(epoch===this.epoch){this.lastPreviewSource=src;this.lastPreviewAt=Date.now()}}}catch{}},Math.max(800,(this.lastPreviewAt||0)+3000-Date.now()))}
 async disconnect(){await this.queue;const token=this.token;try{await this.request('/api/rooms/'+token,{method:'DELETE'})}catch(error){if(![404,410].includes(error.status))throw error}this.detach();this.api.changed()}
}
