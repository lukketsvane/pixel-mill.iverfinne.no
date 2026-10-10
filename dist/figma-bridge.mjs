import {validateProject,bounds} from './engine.mjs';
import {drawObject} from './geometry.mjs';
import {projectDiff,applyDiff} from './agent.mjs';
import {exportSpriteSheet} from './spritesheets.mjs';
import {zipStore,safeName} from './pixel-core.mjs';
import {download,imageCanvas,decode} from './io.mjs';
import {figmaPluginMain,figmaPluginUI} from './figma-plugin.mjs';

export function readFigmaReturn(raw){
 if(raw?.format!=='pixel-mill-figma-return'||raw.version!==1)throw Error('Choose the return JSON exported by the Pixel Mill Figma bridge.');
 return{base:validateProject(raw.base),project:validateProject(raw.project)};
}
export function mergeFigmaReturn(current,raw){
 const {base,project}=readFigmaReturn(raw),known=new Set([...current.objects,...current.assets].map(item=>item.id));
 if((base.objects.length||base.assets.length)&&![...base.objects,...base.assets].some(item=>known.has(item.id)))throw Error('This return belongs to a different level. Use Open as new project.');
 try{return validateProject(applyDiff(current,projectDiff(base,project)))}catch(error){if(error.message.startsWith('Conflict:'))throw Error(error.message.replace(' Refresh before editing.','')+' Use Open as new project to keep both versions.');throw error}
}
export async function createFigmaTransfer(raw,images=new Map()){
 const project=validateProject(raw),rasters=[],appearances=[],cache=new Map(images),variants=new Map();
 for(const asset of project.assets){const raster=asset.spriteSheet?await exportSpriteSheet(asset,{},project.assets):asset;rasters.push({id:asset.id,w:raster.w,h:raster.h,src:raster.src});if(!cache.has(asset.id))cache.set(asset.id,await decode(raster.src))}
 for(const object of project.objects){
  if(object.collisionOnly||!object.artwork&&!object.crop&&!object.adjust&&(object.asset||object.kind!=='ladder'))continue;
  const visual={...object,x:0,y:0,rotation:0,flip:false,opacity:1},key=JSON.stringify([object.asset,object.artwork,object.crop,object.adjust,object.color,object.kind,object.w,object.h]);
  if(variants.has(key)){appearances.push({id:object.id,reuse:variants.get(key)});continue}
  const w=Math.ceil(object.w),h=Math.ceil(object.h);if(w>4096||h>4096||w*h>16000000)throw Error('A treated piece exceeds the Figma image limit. Split it into pieces of at most 4096 pixels per side before exporting.');
  const canvas=imageCanvas(w,h),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.scale(w/object.w,h/object.h);drawObject(ctx,visual,cache.get(object.artwork?.asset||object.asset));
  appearances.push({id:object.id,w,h,src:canvas.toDataURL('image/png')});variants.set(key,object.id);canvas.width=canvas.height=1;
 }
 const b=bounds(project.objects,project.spawn),x=Math.floor(b.x),y=Math.floor(b.y);
 return{format:'pixel-mill-figma',version:1,project,rasters,appearances,bounds:{x,y,w:Math.ceil(b.x+b.w)-x,h:Math.ceil(b.y+b.h)-y}};
}
export const FIGMA_README=`Pixel Mill Figma bridge

1. Unzip this kit. In the Figma desktop app choose Plugins > Development > Import plugin from manifest and select figma-plugin/manifest.json.
2. Run Pixel Mill Bridge, then choose the included level.figma.json.
3. Edit the Level frame. Assets and appearance variants are reusable native components beside it. Move, resize, rotate, flip, duplicate, reorder or remove pieces. Drag component instances into the Level frame to add pieces. Move the Spawn marker to change the starting point. Select a piece and use the bridge's collision selector for solids, platforms, ladders or decoration.
4. Select the Level frame and choose Export back to Pixel Mill. Open Pixel Mill > Figma import / export > Import changes. Independent local and ChatGPT edits merge; conflicting edits stop with an error. Open as new project keeps both versions separate.

Every import creates a separate Figma snapshot so it cannot overwrite a designer's edits. Coordinates use native pixels and retain the original world origin. Original PNG sources, sprite sheet metadata, artwork bindings and collision data are retained. Modified artwork and new Figma drawings return as separate PNG assets; the original sources remain available. New rectangles become decoration until assigned collision. Keep the Spawn marker and the Level frame's metadata. Resizing painted collision must be uniform; unsupported skew is rejected. Rotation and reflection are supported.

The plugin runs locally without network access, cloud storage, tokens or API keys. It is a development plugin, not a published Community plugin. If your Figma client requests a registered plugin ID, create a new local plugin, keep its assigned manifest ID and copy this kit's code.js and ui.html into that plugin folder.
`;
export async function exportFigmaKit(project,images){
 const transfer=await createFigmaTransfer(project,images),manifest={name:'Pixel Mill Bridge',id:'pixel-mill-local-bridge',api:'1.0.0',main:'code.js',ui:'ui.html',editorType:['figma'],documentAccess:'dynamic-page',networkAccess:{allowedDomains:['none']}};
 const transferJSON=JSON.stringify(transfer);if(new Blob([transferJSON]).size>100*1024*1024)throw Error('This Figma kit exceeds 100 MB. Split the level or remove unused sources before exporting.');
 const entries=[{name:'level.figma.json',data:transferJSON},{name:'level.json',data:JSON.stringify(transfer.project)},{name:'figma-plugin/manifest.json',data:JSON.stringify(manifest,null,2)},{name:'figma-plugin/code.js',data:'('+figmaPluginMain.toString()+')();'},{name:'figma-plugin/ui.html',data:figmaPluginUI},{name:'README.txt',data:FIGMA_README}];
 download(zipStore(entries),safeName(project.name,'level')+'-figma.zip');
 return{components:transfer.rasters.length+transfer.appearances.filter(a=>!a.reuse).length,objects:transfer.project.objects.length};
}
