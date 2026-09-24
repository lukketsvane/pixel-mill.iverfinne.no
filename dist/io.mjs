import {detectBackground,extractPart,processPixels,safeName,zipStore} from './pixel-core.mjs';
import {drawObject} from './geometry.mjs';
import {bounds,platforms,validateProject} from './engine.mjs';
export const uid=()=>crypto.randomUUID();
export async function decode(src){const img=new Image();img.src=src;await img.decode();return img}
export function imageCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
async function process(input){if(typeof Worker==='undefined')return processPixels(input);return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(Error('This image took too long to process.'))},60000);const done=()=>{clearTimeout(timer);worker.terminate()};worker.onmessage=({data})=>{done();data.error?reject(Error(data.error)):resolve(data.result)};worker.onerror=()=>{done();reject(Error('Image processing failed.'))};worker.postMessage({job:1,...input},[input.data.buffer])})}
export async function importImages(files,options,onProgress=()=>{}){
 const assets=[],failed=[];let n=0;
 for(const file of files){let url;try{
  if(!file.type.startsWith('image/'))continue;if(file.size>32*1024*1024)throw Error('Image is over 32 MB.');
  onProgress(`${++n} / ${files.length}`);url=URL.createObjectURL(file);const img=await decode(url),w=img.naturalWidth,h=img.naturalHeight;
  if(w*h>12000000)throw Error('Use images under 12 megapixels.');
  const c=imageCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,w,h).data;c.width=c.height=1;
  const tw=Math.max(1,Math.round(w*options.scale)),th=Math.max(1,Math.round(h*options.scale));if(tw*th>4000000)throw Error('Choose a smaller import scale.');
  const result=await process({data,width:w,height:h,options:{width:tw,height:th,color:detectBackground(data,w,h),tolerance:options.tolerance,mode:'all',remove:options.remove,palette:0,minArea:options.minArea,connectivity:8,bridge:0}});
  let parts=result.parts;if(!options.split&&parts.length){const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y));parts=[{x,y,w:Math.max(...parts.map(p=>p.x+p.w))-x,h:Math.max(...parts.map(p=>p.y+p.h))-y,labels:parts.flatMap(p=>p.labels)}]}
  if(assets.length+parts.length>2000)throw Error('Too many parts. Raise the minimum pixels.');
  for(let i=0;i<parts.length;i++){const p=extractPart(result,parts[i],0),canvas=imageCanvas(p.width,p.height);canvas.getContext('2d').putImageData(new ImageData(p.data,p.width,p.height),0,0);assets.push({id:uid(),name:`${safeName(file.name.replace(/\.[^.]+$/,''))}-${String(i+1).padStart(3,'0')}`,w:p.width,h:p.height,src:canvas.toDataURL('image/png')});canvas.width=canvas.height=1}
  if(!parts.length)failed.push(`${file.name}: no visible pixels`);
 }catch(e){failed.push(`${file.name}: ${e.message}`)}finally{if(url)URL.revokeObjectURL(url)}}return{assets,failed};
}
export function snapshot(state){return{format:'max-level-studio',version:1,name:state.name,spawn:{...state.spawn},objects:state.objects.map(o=>({...o})),assets:state.assets.map(a=>({...a}))}}
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
export function saveProject(state){download(new Blob([JSON.stringify(snapshot(state))],{type:'application/json'}),safeName(state.name,'level')+'.json')}
export async function readProject(file){if(!file||file.size>100*1024*1024)throw Error('Choose a project under 100 MB.');const project=validateProject(JSON.parse(await file.text()));await Promise.all(project.assets.map(a=>decode(a.src)));return project}
export async function exportProject(state,images){
 const project=snapshot(state),entries=[{name:'level.json',data:JSON.stringify(project)}],enc=new TextEncoder();
 for(const [i,a] of state.assets.entries()){const bytes=Uint8Array.from(atob(a.src.split(',')[1]),c=>c.charCodeAt(0));entries.push({name:`assets/${String(i+1).padStart(3,'0')}-${safeName(a.name)}.png`,data:bytes})}
 const b=bounds(state.objects,state.spawn),w=Math.ceil(b.w),h=Math.ceil(b.h);if(w*h>16000000||w>16384||h>16384)throw Error('Level is too large for a PNG. Use Save for the editable project.');
 const c=imageCanvas(w,h),ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
 ctx.translate(-b.x,-b.y);
 for(const o of state.objects)drawObject(ctx,o,images.get(o.asset));
 const png=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!png)throw Error('PNG export failed.');entries.push({name:'level.png',data:new Uint8Array(await png.arrayBuffer())});c.width=c.height=1;
 const garden={name:state.name,ledges:[],blocks:[],spots:{start:[{x:state.spawn.x,rise:-state.spawn.y}]}};
 for(const o of platforms(state.objects)){const p={x:o.x,rise:-o.y,w:o.w,style:'stone'};if(o.solid)garden.blocks.push({...p,h:o.h});else garden.ledges.push(p)}
 entries.push({name:'garden-geometry.json',data:JSON.stringify(garden,null,2)},{name:'README.txt',data:enc.encode('Unzip and drag the PNG files into Figma.\nOpen level.json in Max Level Studio to continue editing.\nlevel.png is the placed artwork; assets/ contains the transparent pieces.\nGarden geometry uses Max x/rise coordinates, origin 0 and baseline 0. It is a geometry reference, not an automatic game deployment.\nMax sprite and base movement: lukketsvane/max.iverfinne.no.\n')});
 download(zipStore(entries),safeName(state.name,'level')+'.zip');
}
