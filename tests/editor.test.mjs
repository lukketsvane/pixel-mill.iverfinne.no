import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const downloads=[],blobStore=new Map();let frame;
class Element{
 constructor(tag='div'){this.tagName=tag;this.dataset={};this.attrs={};this.listeners={};this.children=[];this.hidden=false;this.value='';this.checked=false;this.disabled=false;this.open=false;this.clientWidth=390;this.clientHeight=844;this.style={setProperty(){}};this.classList={toggle(){}}}
 setAttribute(k,v){this.attrs[k]=v}addEventListener(k,v){const previous=this.listeners[k];this.listeners[k]=e=>{previous?.(e);v(e)}}append(...xs){this.children.push(...xs)}replaceChildren(...xs){this.children=xs}focus(){document.activeElement=this}blur(){if(document.activeElement===this)document.activeElement=null}select(){}remove(){}closest(){return null}setPointerCapture(){}getBoundingClientRect(){return{left:0,top:0}}showModal(){this.open=true}close(){this.open=false}
 click(){if(this.download)downloads.push({name:this.download,blob:blobStore.get(this.href)});else this.onclick?.({target:this})}
 getContext(){return new Proxy({getImageData:(x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const on=x>=4&&x<12&&y>=4&&y<12||x>=20&&x<28&&y>=20&&y<28;data.set([on?255:0,on?255:0,on?255:0,255],(y*w+x)*4)}return{data}},putImageData(){},drawImage(){}},{get:(target,k)=>k in target?target[k]:()=>{}})}
 toDataURL(){return png}toBlob(cb){cb(new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}))}
}
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),all=[],ids=new Map();
for(const m of html.matchAll(/<([a-z]+)\b([^>]*)>/g)){const e=new Element(m[1]),a=m[2];for(const d of a.matchAll(/data-([a-z]+)="([^"]+)"/g))e.dataset[d[1]]=d[2];const id=a.match(/\bid="([^"]+)"/)?.[1];if(id){e.id=id;ids.set(id,e)}for(const key of ['type','min','max','step'])e[key]=a.match(new RegExp(key+'="([^"]+)"'))?.[1]||'';e.value=a.match(/value="([^"]+)"/)?.[1]||'';e.checked=/\bchecked\b/.test(a);e.hidden=/\bhidden\b/.test(a);all.push(e)}
for(const [id,value] of Object.entries({background:'auto',scale:'0.25',grid:'4'}))ids.get(id).value=value;
const docListeners={},windowListeners={},tools=new Map();
globalThis.document={querySelector:s=>ids.get(s.slice(1)),querySelectorAll:s=>s==='input[type="number"]'?all.filter(e=>e.type==='number'):all.filter(e=>e.dataset[s.match(/data-(\w+)/)?.[1]]),createElement:t=>new Element(t),createDocumentFragment:()=>new Element(),body:new Element(),addEventListener:(k,f)=>docListeners[k]=f,modelContext:{registerTool:t=>tools.set(t.name,t)}};
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:3,addEventListener:(k,f)=>windowListeners[k]=f};globalThis.requestAnimationFrame=f=>frame=f;globalThis.ImageData=class{constructor(data,w,h){Object.assign(this,{data,width:w,height:h})}};globalThis.Worker=undefined;
const originalURL=globalThis.URL;globalThis.URL=class extends originalURL{static createObjectURL(blob){const url='blob:'+blobStore.size;blobStore.set(url,blob);return url}static revokeObjectURL(url){blobStore.delete(url)}};
globalThis.Image=class{set src(s){this._src=s;queueMicrotask(()=>this.onload?.())}get src(){return this._src}async decode(){if(blobStore.get(this.src)?.name==='bad.png')throw Error('Bad image');this.naturalWidth=this.naturalHeight=32}};
// Timers in production are UI lifetimes, not work that should keep the test runner open.
const timeout=globalThis.setTimeout;globalThis.setTimeout=(...args)=>{const t=timeout(...args);t.unref?.();return t};
await import('../dist/app.mjs');await Promise.resolve();
const read=()=>tools.get('get_level').execute({}),file=name=>({name,type:'image/png',size:10});
const wait=async()=>{for(let i=0;i<100;i++){if(!(await read()).importing)return;await new Promise(r=>timeout(r,5))}throw Error('Import timeout')};
const pressTool=t=>all.find(e=>e.dataset.tool===t).onclick();
const event=(x,y,id=1)=>({pointerId:id,clientX:x,clientY:y,button:0,preventDefault(){},target:ids.get('canvas')});
test('complete editor flow: empty canvas, multi-upload, placement, physics mode, save/open, ZIP and validation',async()=>{
 assert.equal((await read()).objects.length,0);assert.equal((await read()).assets.length,0);assert.match(html,/<input[^>]*id="files"[^>]*multiple/);assert.match(html,/maximum-scale=1,user-scalable=no/);
 ids.get('files').files=[file('first.png'),file('second.png'),file('bad.png')];ids.get('files').onchange({target:ids.get('files')});await wait();assert.equal((await read()).assets.length,4);assert.match(ids.get('status').textContent,/bad.png/);
 const palette=ids.get('asset-items').children[0].children;palette[0].onclick();const c=ids.get('canvas');c.listeners.pointerdown(event(100,300));c.listeners.pointerup(event(100,300));assert.equal((await read()).objects.length,1);assert.equal(all.find(e=>e.dataset.tool==='select').attrs['aria-pressed'],'true');assert.equal((await read()).selected,(await read()).objects[0].id);c.listeners.pointerdown(event(300,200));c.listeners.pointerup(event(300,200));assert.equal((await read()).objects.length,1);
 pressTool('block');c.listeners.pointerdown(event(80,440));c.listeners.pointermove(event(300,480));c.listeners.pointerup(event(300,480));assert.equal((await read()).objects.length,2);assert.equal((await read()).objects[1].kind,'solid');
 const pieceBefore={...(await read()).objects[1]},revisionBefore=(await read()).revision;ids.get('piece-options').onclick();const field=ids.get('piece-w');const scrub=(type,x)=>field.listeners[type]({...event(x,0),target:field,pointerType:'touch',stopPropagation(){}});scrub('pointerdown',100);scrub('pointermove',140);assert.equal(ids.get('dimensions').hidden,false);assert.equal((await read()).revision,revisionBefore);assert.ok((await read()).objects[1].w>pieceBefore.w);scrub('pointerup',140);assert.equal((await read()).revision,revisionBefore+1);assert.equal(ids.get('dimensions').hidden,false);
 ids.get('duplicate').onclick();assert.equal((await read()).objects.length,3);await ids.get('undo').onclick();assert.equal((await read()).objects.length,2);
 const before=JSON.stringify((await read()).objects);ids.get('play').onclick();assert.equal((await read()).playing,true);frame(100);frame(120);ids.get('exit-play').onclick();assert.equal((await read()).playing,false);assert.equal(JSON.stringify((await read()).objects),before);
 const invalid=()=>tools.get('edit_level').execute({revision:0,operations:[{type:'block',x:0,y:0,width:-1,height:10}]});await assert.rejects(invalid);assert.equal((await read()).objects.length,2);
 const added=await tools.get('edit_level').execute({revision:(await read()).revision,operations:[{type:'block',x:8,y:8,width:48,height:8}]});assert.equal(added.objects.at(-1).kind,'solid');assert.equal((await read()).objects.length,3);assert.equal(tools.get('get_level').annotations.readOnlyHint,true);await assert.rejects(()=>tools.get('set_play_mode').execute({playing:'yes'}));
 ids.get('save').onclick();const saved=downloads.at(-1);assert.ok(saved.name.endsWith('.json'));const project=JSON.parse(await saved.blob.text());assert.equal(project.assets.length,4);assert.equal(project.objects.length,3);
 ids.get('clear').onclick();assert.equal((await read()).objects.length,0);ids.get('project-file').files=[{size:saved.blob.size,text:()=>saved.blob.text()}];await ids.get('project-file').onchange({target:ids.get('project-file')});assert.equal((await read()).objects.length,3);assert.equal((await read()).assets.length,4);
 await ids.get('export').onclick();const zip=downloads.at(-1);assert.ok(zip.name.endsWith('.zip'));const bytes=new Uint8Array(await zip.blob.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[80,75,3,4]);const text=new TextDecoder().decode(bytes);for(const file of ['level.json','level.png','garden-geometry.json','README.txt'])assert.ok(text.includes(file));
 // Play mode has no on-screen movement controls and cancellation is safe.
 await tools.get('set_play_mode').execute({playing:true});
 assert.equal(ids.has('touch-controls'),false);c.listeners.pointerdown(event(50,600));c.listeners.pointermove(event(110,600));windowListeners.blur();
 await tools.get('set_play_mode').execute({playing:false});
 assert.equal(ids.get('canvas').width,1170);assert.equal(ids.get('canvas').height,2532);
});
