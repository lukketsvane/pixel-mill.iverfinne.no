// Stream small revision notifications; fetch project bytes only on a change.
// Requests and decodes keep their own generation guards in the consumer.
export class LiveUpdates{
 constructor({revision,refresh,status=()=>{},gone=()=>{}}){Object.assign(this,{revision,refresh,status,gone});this.epoch=0;this.source=null;this.path=null;this.inflight=null;this.again=false;this.deferred=false}
 start(path){this.stop();this.path=path;const epoch=this.epoch;
  this.wake=()=>{if(epoch!==this.epoch)return;if(globalThis.document?.hidden){this.closeSource();clearTimeout(this.timer);return}void this.pull();this.openSource(epoch);this.schedule(epoch)};
  globalThis.window?.addEventListener('online',this.wake);globalThis.window?.addEventListener('focus',this.wake);globalThis.document?.addEventListener('visibilitychange',this.wake);
  this.openSource(epoch);this.schedule(epoch);
 }
 closeSource(){this.source?.close();this.source=null;this.live=false}
 openSource(epoch){if(this.source||!this.path||globalThis.document?.hidden||typeof EventSource==='undefined')return;
  const source=this.source=new EventSource(this.path+'/events');
  source.addEventListener('change',event=>{if(epoch!==this.epoch)return;this.live=true;this.status('Live');let data;try{data=JSON.parse(event.data)}catch{return}if(Number.isInteger(data.revision)&&data.revision>this.revision())void this.pull()});
  source.addEventListener('gone',event=>{if(epoch!==this.epoch)return;let message='Project is no longer available.';try{message=JSON.parse(event.data).message||message}catch{}this.stop();this.gone(message)});
  source.addEventListener('retry',()=>{if(epoch===this.epoch){this.live=false;this.status('Reconnecting…');this.schedule(epoch)}});
  source.onerror=()=>{if(epoch===this.epoch){this.live=false;this.status('Reconnecting…');this.schedule(epoch)}};
 }
 schedule(epoch){clearTimeout(this.timer);if(epoch!==this.epoch||!this.path||globalThis.document?.hidden)return;this.timer=setTimeout(async()=>{if(epoch!==this.epoch)return;if(!this.live||this.deferred)await this.pull();this.schedule(epoch)},this.deferred?350:this.live?10000:2000)}
 async pull(){if(!this.path||globalThis.document?.hidden)return;if(this.inflight){this.again=true;return this.inflight}const epoch=this.epoch;
  const task=(async()=>{do{this.again=false;const applied=await this.refresh(()=>epoch===this.epoch);if(epoch===this.epoch)this.deferred=applied===false}while(this.again&&epoch===this.epoch)})().catch(error=>{if(epoch===this.epoch){if([404,410].includes(error.status)){this.stop();this.gone(error.message)}else{this.live=false;this.status('Offline · edits kept')}}}).finally(()=>{if(this.inflight===task)this.inflight=null;if(epoch===this.epoch)this.schedule(epoch)});
  this.inflight=task;return task;
 }
 stop(){this.epoch++;this.closeSource();clearTimeout(this.timer);this.path=null;this.again=false;this.deferred=false;this.inflight=null;if(this.wake){globalThis.window?.removeEventListener?.('online',this.wake);globalThis.window?.removeEventListener?.('focus',this.wake);globalThis.document?.removeEventListener?.('visibilitychange',this.wake);this.wake=null}}
}
