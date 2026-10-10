import {patchSourceHash} from './agent.mjs';

export const projectTokenPrefix='706d763200000001';
export const createProjectToken=()=>projectTokenPrefix+Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');

export function projectName(value){
 const name=typeof value==='string'?value.trim():'';
 return name&&name.length<=60&&!/^untitled(?:\s+\d+)?$/i.test(name)&&/[^\s\u200b-\u200d\ufeff]/u.test(name)?name:null;
}
export function requireProjectName(project){
 const name=projectName(project?.name);
 if(!name)throw Error('Give the project a name before saving.');
 return name;
}
export const hasProjectChanges=diff=>Object.values(diff).some(value=>Array.isArray(value)?value.length:!!value);
export const projectSourceVersions=assets=>assets.filter(a=>typeof a.src==='string').map(a=>[a.id,patchSourceHash(a.src)]);
export function projectVersionQuery(assets){
 const pairs=[];let length=6;
 for(const asset of assets.filter(a=>typeof a.src==='string').sort((a,b)=>b.src.length-a.src.length)){
  const pair=[asset.id,patchSourceHash(asset.src)],size=encodeURIComponent(JSON.stringify(pair)).length+3;
  if(length+size>6000)continue;pairs.push(pair);length+=size;
 }
 return'assetVersions='+encodeURIComponent(JSON.stringify(pairs));
}
export function hydrateProject(project,...sources){
 const cached=new Map();for(const source of sources)for(const asset of source?.assets||[])if(typeof asset.src==='string')cached.set(asset.id,asset);
 return{...project,assets:project.assets.map(value=>{
  const {sourceHash,...asset}=value;
  if(typeof asset.src==='string'||asset.spriteSheet?.source==='assets')return asset;
  const old=cached.get(asset.id);
  if(typeof old?.src!=='string'||patchSourceHash(old.src)!==sourceHash)throw Error('Image cache changed. Reconnect to load the complete project.');
  return{...asset,src:old.src};
 })};
}
