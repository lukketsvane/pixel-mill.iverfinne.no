// Small PNG codec shared by the browser's WebMCP tools and the Worker.
// Pixel operations are intentionally exact: no resampling or antialiasing.
const signature=[137,80,78,71,13,10,26,10];
const u32=(b,i)=>((b[i]*0x1000000)+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3])>>>0;
const write32=(b,i,n)=>{b[i]=n>>>24;b[i+1]=n>>>16;b[i+2]=n>>>8;b[i+3]=n};
const table=Uint32Array.from({length:256},(_,value)=>{for(let n=0;n<8;n++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0});
function crc(bytes){let value=0xffffffff;for(const b of bytes)value=table[(value^b)&255]^(value>>>8);return(value^0xffffffff)>>>0}
function chunk(type,data){const out=new Uint8Array(data.length+12);write32(out,0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);write32(out,out.length-4,crc(out.subarray(4,out.length-4)));return out}
async function transform(bytes,kind){const stream=new Blob([bytes]).stream().pipeThrough(kind==='inflate'?new DecompressionStream('deflate'):new CompressionStream('deflate'));return new Uint8Array(await new Response(stream).arrayBuffer())}
export function pngBytes(src){
 if(typeof src!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)||src.length>12_000_000)throw Error('Supply a PNG data URL under 9 MB.');
 return Uint8Array.from(atob(src.slice(src.indexOf(',')+1)),c=>c.charCodeAt(0));
}
export function pngHeader(bytes){
 if(bytes.length<45||signature.some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw Error('Invalid PNG.');
 const w=u32(bytes,16),h=u32(bytes,20),depth=bytes[24],type=bytes[25];
 if(w<1||h<1||w>4096||h>4096||w*h>4_000_000)throw Error('PNG must fit within 4096 px and four million pixels.');
 if(depth!==8||![0,2,3,4,6].includes(type)||bytes[26]||bytes[27]||bytes[28])throw Error('Use an 8-bit, non-interlaced PNG.');
 return{w,h,depth,type};
}
export async function decodePNG(bytes){
 const {w,h,type}=pngHeader(bytes),channels={0:1,2:3,3:1,4:2,6:4}[type],stride=w*channels;
 let offset=8,palette=null,alpha=null;const compressed=[];
 while(offset+12<=bytes.length){const length=u32(bytes,offset),start=offset+8,end=start+length;if(end+4>bytes.length)throw Error('Truncated PNG.');const tag=String.fromCharCode(...bytes.subarray(offset+4,offset+8));if(tag==='PLTE')palette=bytes.subarray(start,end);if(tag==='tRNS')alpha=bytes.subarray(start,end);if(tag==='IDAT')compressed.push(bytes.subarray(start,end));offset=end+4;if(tag==='IEND')break}
 if(!compressed.length||type===3&&!palette)throw Error('PNG has no usable image data.');
 const packed=new Uint8Array(compressed.reduce((n,b)=>n+b.length,0));let at=0;for(const part of compressed){packed.set(part,at);at+=part.length}
 const inflated=await transform(packed,'inflate');if(inflated.length!==(stride+1)*h)throw Error('Invalid PNG image dimensions.');
 const pixels=new Uint8Array(w*h*4),previous=new Uint8Array(stride),row=new Uint8Array(stride);
 let src=0,dest=0;
 for(let y=0;y<h;y++){const filter=inflated[src++];if(filter>4)throw Error('Unsupported PNG filter.');for(let x=0;x<stride;x++){const left=x>=channels?row[x-channels]:0,up=previous[x],upperLeft=x>=channels?previous[x-channels]:0;let predictor=0;if(filter===1)predictor=left;else if(filter===2)predictor=up;else if(filter===3)predictor=(left+up)>>1;else if(filter===4){const p=left+up-upperLeft,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-upperLeft);predictor=a<=b&&a<=c?left:b<=c?up:upperLeft}row[x]=(inflated[src++]+predictor)&255}
  for(let x=0;x<w;x++){const i=x*channels,v=row[i];if(type===6){pixels.set(row.subarray(i,i+4),dest)}else if(type===2){pixels.set(row.subarray(i,i+3),dest);pixels[dest+3]=255}else if(type===0){pixels[dest]=pixels[dest+1]=pixels[dest+2]=v;pixels[dest+3]=255}else if(type===4){pixels[dest]=pixels[dest+1]=pixels[dest+2]=v;pixels[dest+3]=row[i+1]}else{const j=v*3;if(j+2>=palette.length)throw Error('Invalid PNG palette.');pixels.set(palette.subarray(j,j+3),dest);pixels[dest+3]=alpha?.[v]??255}dest+=4}
  previous.set(row);
 }
 return{w,h,pixels};
}
export async function encodePNG({w,h,pixels}){
 if(w<1||h<1||w>4096||h>4096||w*h>4_000_000||pixels.length!==w*h*4)throw Error('Invalid spritesheet dimensions.');
 const scan=new Uint8Array((w*4+1)*h);for(let y=0;y<h;y++)scan.set(pixels.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);
 const ihdr=new Uint8Array(13);write32(ihdr,0,w);write32(ihdr,4,h);ihdr[8]=8;ihdr[9]=6;
 const parts=[Uint8Array.from(signature),chunk('IHDR',ihdr),chunk('IDAT',await transform(scan,'deflate')),chunk('IEND',new Uint8Array())];
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out;
}
export function dataURL(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return'data:image/png;base64,'+btoa(text)}
