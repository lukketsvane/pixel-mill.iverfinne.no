import {detectBackground,findParts,extractPart} from './pixel-core.mjs';

export function assetEditRect(image,rect){
 const area=rect??{x:0,y:0,w:image.w,h:image.h};
 if(!area||!['x','y','w','h'].every(key=>Number.isInteger(area[key]))||area.x<0||area.y<0||area.w<1||area.h<1||area.x+area.w>image.w||area.y+area.h>image.h)throw Error('Select a rectangle inside the image using native pixels.');
 return{x:area.x,y:area.y,w:area.w,h:area.h};
}

export function removeAssetBackground(image,rect){
 const area=assetEditRect(image,rect),pixels=new Uint8Array(image.pixels),corners=new Uint8Array(16),positions=[[area.x,area.y],[area.x+area.w-1,area.y],[area.x,area.y+area.h-1],[area.x+area.w-1,area.y+area.h-1]];
 for(let i=0;i<positions.length;i++){const [x,y]=positions[i],at=(y*image.w+x)*4;corners.set(image.pixels.subarray(at,at+4),i*4);if(corners[i*4+3])corners[i*4+3]=255}
 if(!corners.some((value,index)=>index%4===3&&value))return{pixels,removedPixels:0,rect:area};
 const color=detectBackground(corners,2,2);let matchingCorners=0;for(let at=0;at<corners.length;at+=4)if(corners[at+3]&&(corners[at]-color[0])**2+(corners[at+1]-color[1])**2+(corners[at+2]-color[2])**2<=18*18*3)matchingCorners++;
 if(matchingCorners<3)return{pixels,removedPixels:0,rect:area};
 const queue=new Int32Array(area.w*area.h),seen=new Uint8Array(area.w*area.h);let head=0,tail=0,removedPixels=0;
 const add=p=>{if(seen[p])return;const at=((area.y+Math.floor(p/area.w))*image.w+area.x+p%area.w)*4,dr=image.pixels[at]-color[0],dg=image.pixels[at+1]-color[1],db=image.pixels[at+2]-color[2];if(image.pixels[at+3]&&dr*dr+dg*dg+db*db>18*18*3)return;seen[p]=1;queue[tail++]=p};
 for(let x=0;x<area.w;x++){add(x);add((area.h-1)*area.w+x)}for(let y=0;y<area.h;y++){add(y*area.w);add(y*area.w+area.w-1)}
 while(head<tail){const p=queue[head++],x=p%area.w,y=Math.floor(p/area.w),at=((area.y+y)*image.w+area.x+x)*4;if(image.pixels[at+3]){pixels.fill(0,at,at+4);removedPixels++}if(x)add(p-1);if(x<area.w-1)add(p+1);if(y)add(p-area.w);if(y<area.h-1)add(p+area.w)}
 return{pixels,removedPixels,rect:area};
}

export function segmentAssetImage(image,{rect,point}={}){
 const area=assetEditRect(image,rect),data=new Uint8Array(area.w*area.h*4);
 if(point&&(!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<area.x||point.y<area.y||point.x>=area.x+area.w||point.y>=area.y+area.h))throw Error('Choose a pixel inside the selected image region.');
 for(let y=0;y<area.h;y++){const from=((area.y+y)*image.w+area.x)*4;data.set(image.pixels.subarray(from,from+area.w*4),y*area.w*4)}
 const found=findParts(data,area.w,area.h,17,8),result={data,width:area.w,height:area.h,...found},label=point?found.labels[(point.y-area.y)*area.w+point.x-area.x]:null,parts=point?found.parts.filter(part=>part.id===label):found.parts;
 if(!parts.length)throw Error('Choose a connected part containing at least 17 visible pixels.');
 if(parts.length>2000)throw Error('The selection contains more than 2,000 separate parts.');
 return parts.map(part=>{const extracted=extractPart(result,part);return{pixels:extracted.data,w:extracted.width,h:extracted.height,x:area.x+part.x,y:area.y+part.y,area:part.area}});
}
