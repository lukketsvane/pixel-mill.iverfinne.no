export function detectBackground(data,w,h){
 const bins=new Map();const sample=(x,y)=>{const i=(y*w+x)*4;if(data[i+3]<128)return;const key=((data[i]>>3)<<10)|((data[i+1]>>3)<<5)|(data[i+2]>>3);let b=bins.get(key);if(!b)bins.set(key,b=[0,0,0,0]);b[0]++;b[1]+=data[i];b[2]+=data[i+1];b[3]+=data[i+2];};
 const step=Math.max(1,Math.floor(Math.max(w,h)/400));for(let x=0;x<w;x+=step){sample(x,0);sample(x,h-1)}for(let y=0;y<h;y+=step){sample(0,y);sample(w-1,y)}
 const b=[...bins.values()].sort((a,b)=>b[0]-a[0])[0];return b?b.slice(1).map(v=>Math.round(v/b[0])):[0,0,0];
}
export function removeBackground(data,w,h,color,tolerance,mode='all',enabled=true){
 const out=new Uint8ClampedArray(data);const n=w*h,match=new Uint8Array(n);const tolerance2=tolerance*tolerance;
 for(let p=0;p<n;p++){let i=p*4;const dr=data[i]-color[0],dg=data[i+1]-color[1],db=data[i+2]-color[2];match[p]=data[i+3]<128||enabled&&(dr*dr+dg*dg+db*db)/3<=tolerance2?1:0;}
 if(mode==='edge'&&enabled){const queue=new Int32Array(n),seen=new Uint8Array(n);let head=0,tail=0;const add=p=>{if(match[p]&&!seen[p]){seen[p]=1;queue[tail++]=p}};for(let x=0;x<w;x++){add(x);add((h-1)*w+x)}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1)}while(head<tail){const p=queue[head++],x=p%w,y=(p/w)|0;if(x)add(p-1);if(x<w-1)add(p+1);if(y)add(p-w);if(y<h-1)add(p+w)}for(let p=0;p<n;p++){out[p*4+3]=seen[p]||data[p*4+3]<128?0:255}}
 else for(let p=0;p<n;p++)out[p*4+3]=match[p]?0:255;
 for(let i=0;i<out.length;i+=4)if(!out[i+3])out[i]=out[i+1]=out[i+2]=0;return out;
}
export function resizePixels(data,w,h,tw,th){const out=new Uint8ClampedArray(tw*th*4);for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const src=(Math.min(h-1,Math.floor((y+.5)*h/th))*w+Math.min(w-1,Math.floor((x+.5)*w/tw)))*4;out.set(data.subarray(src,src+4),(y*tw+x)*4)}return out}
export function quantize(data,maxColors){
 if(!maxColors)return data;const histogram=new Map();for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const key=(data[i]<<16)|(data[i+1]<<8)|data[i+2];histogram.set(key,(histogram.get(key)||0)+1)}if(histogram.size<=maxColors)return data;
 const colors=[...histogram].map(([key,n])=>({rgb:[key>>16,(key>>8)&255,key&255],n}));
 const box=items=>{const lo=[255,255,255],hi=[0,0,0];let count=0;for(const c of items){count+=c.n;for(let d=0;d<3;d++){lo[d]=Math.min(lo[d],c.rgb[d]);hi[d]=Math.max(hi[d],c.rgb[d])}}const ranges=hi.map((v,d)=>v-lo[d]);const axis=ranges.indexOf(Math.max(...ranges));return{items,count,axis,score:ranges[axis]*Math.sqrt(count)}};
 const boxes=[box(colors)];while(boxes.length<maxColors){boxes.sort((a,b)=>b.score-a.score);const b=boxes.shift();if(b.items.length<2){boxes.unshift(b);break}b.items.sort((a,c)=>a.rgb[b.axis]-c.rgb[b.axis]);let total=0,cut=1;for(let i=0;i<b.items.length-1;i++){total+=b.items[i].n;cut=i+1;if(total>=b.count/2)break}boxes.push(box(b.items.slice(0,cut)),box(b.items.slice(cut)))}
 const palette=boxes.map(b=>[0,1,2].map(d=>Math.round(b.items.reduce((s,c)=>s+c.rgb[d]*c.n,0)/b.count))),cache=new Map();
 for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const key=(data[i]<<16)|(data[i+1]<<8)|data[i+2];let c=cache.get(key);if(!c){let best=Infinity;for(const p of palette){let d=(data[i]-p[0])**2+(data[i+1]-p[1])**2+(data[i+2]-p[2])**2;if(d<best){best=d;c=p}}cache.set(key,c)}data[i]=c[0];data[i+1]=c[1];data[i+2]=c[2]}return data;
}
export function findParts(data,w,h,minArea=1,connectivity=8,bridge=0){
 const labels=new Int32Array(w*h),queue=new Int32Array(w*h),parts=[];let id=0;
 for(let p=0;p<w*h;p++){if(labels[p]||!data[p*4+3])continue;id++;let head=0,tail=1;queue[0]=p;labels[p]=id;let minX=w,minY=h,maxX=0,maxY=0;const reach=1+Math.max(0,Math.min(4,bridge));
 while(head<tail){const q=queue[head++],x=q%w,y=(q/w)|0;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(let dy=-reach;dy<=reach;dy++){if(y+dy<0||y+dy>=h)continue;for(let dx=-reach;dx<=reach;dx++){if(!dx&&!dy||connectivity===4&&Math.abs(dx)+Math.abs(dy)>reach||x+dx<0||x+dx>=w)continue;const next=(y+dy)*w+x+dx;if(!labels[next]&&data[next*4+3]){labels[next]=id;queue[tail++]=next}}}}
 if(tail<minArea){for(let k=0;k<tail;k++)data[queue[k]*4+3]=0}else parts.push({id,labels:[id],x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,area:tail});}
 // Order in reading rows, allowing naturally uneven tops within the same row.
 const ordered=[];const remaining=parts.sort((a,b)=>a.y-b.y||a.x-b.x);while(remaining.length){const top=remaining[0];const rowBottom=top.y+Math.max(2,Math.min(top.h*.35,12));let count=1;while(count<remaining.length&&remaining[count].y<=rowBottom)count++;ordered.push(...remaining.splice(0,count).sort((a,b)=>a.x-b.x));}
 return {labels,parts:ordered};
}
export function processPixels({data,width,height,options}){
 const tw=Math.round(options.width),th=Math.round(options.height);if(!Number.isFinite(tw)||!Number.isFinite(th)||tw<1||th<1||tw>4096||th>4096||tw*th>8388608)throw Error('Choose dimensions up to 4096 px and 8 megapixels.');
 const clean=removeBackground(data,width,height,options.color,options.tolerance,options.mode,options.remove);const scaled=resizePixels(clean,width,height,tw,th);quantize(scaled,options.palette);const result=findParts(scaled,tw,th,options.minArea,options.connectivity,options.bridge||0);if(result.parts.length>2000)throw Error('More than 2,000 parts found. Increase “Ignore specks below” or background tolerance.');return {data:scaled,width:tw,height:th,...result};
}
export function extractPart(result,part,padding=0){const w=part.w+2*padding,h=part.h+2*padding,out=new Uint8ClampedArray(w*h*4),ids=new Set(part.labels);for(let y=0;y<part.h;y++)for(let x=0;x<part.w;x++){const p=(y+part.y)*result.width+x+part.x;if(!ids.has(result.labels[p]))continue;const i=((y+padding)*w+x+padding)*4;out.set(result.data.subarray(p*4,p*4+4),i)}return {data:out,width:w,height:h}}
export function mergeParts(parts){if(parts.length<2)throw Error('Select at least two parts.');const x=Math.min(...parts.map(p=>p.x)),y=Math.min(...parts.map(p=>p.y)),right=Math.max(...parts.map(p=>p.x+p.w)),bottom=Math.max(...parts.map(p=>p.y+p.h));return {...parts[0],x,y,w:right-x,h:bottom-y,area:parts.reduce((s,p)=>s+p.area,0),labels:parts.flatMap(p=>p.labels),included:true}}
export function safeName(name,fallback='sprite'){return String(name).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||fallback}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
export function zipStore(entries){const chunks=[],central=[];let offset=0;const enc=new TextEncoder();for(const {name,data} of entries){const filename=enc.encode(name),bytes=typeof data==='string'?enc.encode(data):data,crc=crc32(bytes),header=new Uint8Array(30+filename.length),d=new DataView(header.buffer);d.setUint32(0,0x04034b50,true);d.setUint16(4,20,true);d.setUint16(6,0x800,true);d.setUint16(12,33,true);d.setUint32(14,crc,true);d.setUint32(18,bytes.length,true);d.setUint32(22,bytes.length,true);d.setUint16(26,filename.length,true);header.set(filename,30);chunks.push(header,bytes);const c=new Uint8Array(46+filename.length),v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);v.setUint32(16,crc,true);v.setUint32(20,bytes.length,true);v.setUint32(24,bytes.length,true);v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);c.set(filename,46);central.push(c);offset+=header.length+bytes.length}const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,central.reduce((n,b)=>n+b.length,0),true);v.setUint32(16,offset,true);return new Blob([...chunks,...central,end],{type:'application/zip'})}
