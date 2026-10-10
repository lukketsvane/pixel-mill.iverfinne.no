import {createHash} from 'node:crypto';

const prefix='data:image/png;base64,',maxImageBytes=24*1024*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
const validURL=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='i.ibb.co'&&!url.username&&!url.password&&!url.port}catch{return false}};
async function download(url,fetcher,signal=AbortSignal.timeout(15000)){
 if(!validURL(url))throw Error('Invalid stored image host.');
 const response=await fetcher(url,{signal,redirect:'error'});
 if(!response.ok||Number(response.headers.get('content-length'))>maxImageBytes)throw Error('Stored image is unavailable.');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxImageBytes)throw Error('Stored image is too large.');chunks.push(Buffer.from(value))}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 return prefix+Buffer.concat(chunks).toString('base64');
}
export function createImageStorage({fetcher=fetch,key=()=>process.env.IMGBB_API_KEY,cacheLimit=32*1024*1024}={}){
 const cache=new Map();let cacheBytes=0,retryAfter=0;
 const remember=(hash,item)=>{
  const previous=cache.get(hash);if(previous)cacheBytes-=previous.source.length;
  cache.delete(hash);cache.set(hash,item);cacheBytes+=item.source.length;
  while(cacheBytes>cacheLimit&&cache.size){const [old,value]=cache.entries().next().value;cache.delete(old);cacheBytes-=value.source.length}
 };
 const upload=async(source,hash,signal,offload)=>{
  const cached=cache.get(hash);if(offload&&cached?.url)return{hash,url:cached.url};
  if(!offload||!key()||signal.aborted||Date.now()<retryAfter)return{source};
  try{
   const form=new FormData();form.set('key',key());form.set('image',source.slice(prefix.length));form.set('name',`pixel-mill-${hash}`);
   const response=await fetcher('https://api.imgbb.com/1/upload',{method:'POST',body:form,signal,redirect:'error'});
   if(!response.ok)throw Error('Image upload failed.');
   const result=await response.json(),url=result.data?.image?.url||result.data?.url;
   if(!result.success||!validURL(url))throw Error('Invalid image upload response.');
   const returned=await download(url,fetcher,signal);if(digest(returned)!==hash)throw Error('Image host changed the original pixels.');
   remember(hash,{source,url});return{hash,url};
  }catch{retryAfter=Date.now()+60000;return{source}}
 };
 return{
  async encode(text,{offload=true}={}){
   const record=JSON.parse(text),images=[],known=new Map();
   const visit=(value,path)=>{
    if(typeof value==='string'&&value.startsWith(prefix)&&value.length>prefix.length&&value.length<=maxImageBytes*4/3+prefix.length){
     const bytes=Buffer.from(value.slice(prefix.length),'base64');
     if(prefix+bytes.toString('base64')===value){
      let index=known.get(value);if(index===undefined){index=images.length;known.set(value,index);images.push({source:value,paths:[]})}
      images[index].paths.push(path);return null;
     }
    }
    if(Array.isArray(value))return value.map((item,index)=>visit(item,[...path,index]));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,visit(item,[...path,name])]));
    return value;
   };
   const data=visit(record,[]);if(!images.length)return text;
   const stored=[],signal=AbortSignal.timeout(8000);
   for(const image of images)stored.push({...await upload(image.source,digest(image.source),signal,offload),paths:image.paths});
   return JSON.stringify({pixelMillStorage:1,data,images:stored});
  },
  async decode(value){
   if(value?.pixelMillStorage!==1)return value;
   const {data,images}=value;
   if(!Array.isArray(images))throw Error('Invalid stored image table.');
   for(const image of images){
    let source=image.source;
    if(source===undefined){
     if(!/^[a-f0-9]{64}$/.test(image.hash)||!validURL(image.url))throw Error('Invalid stored image reference.');
     const cached=cache.get(image.hash);source=cached?.source||await download(image.url,fetcher);
     if(digest(source)!==image.hash)throw Error('Stored image failed its integrity check.');
     remember(image.hash,{source,url:image.url});
    }
    if(typeof source!=='string'||!source.startsWith(prefix)||!Array.isArray(image.paths))throw Error('Invalid stored image.');
    for(const path of image.paths){
     if(!Array.isArray(path)||!path.length)throw Error('Invalid image location.');
     let target=data;
     for(const part of path.slice(0,-1)){if(!target||!Object.hasOwn(target,part))throw Error('Invalid image location.');target=target[part]}
     const last=path.at(-1);
     if(!target||!Object.hasOwn(target,last)||target[last]!==null)throw Error('Invalid image location.');
     Object.defineProperty(target,last,{value:source,writable:true,enumerable:true,configurable:true});
    }
   }
   return data;
  }
 };
}
