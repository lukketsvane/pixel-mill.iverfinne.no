export const transferChunkBytes=1024*1024;
export const transferLimitBytes=32*1024*1024;
export const transferContentType='application/vnd.pixel-mill.transfer+json';
export const validTransferPart=part=>typeof part==='string'&&part.length>0&&part.length%4===0&&part.length<=Math.ceil(transferChunkBytes/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(part);
export const isTransfer=value=>value?.pixelMillTransfer===1&&/^[a-f0-9]{64}$/.test(value.token)&&/^[a-f0-9]{64}$/.test(value.hash)&&Number.isInteger(value.parts)&&value.parts>=1&&value.parts<=32;
export async function transferHash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')}
export async function packTransfer(text,token){
 const bytes=new TextEncoder().encode(text);if(bytes.length>transferLimitBytes)throw Error('Project exceeds the 32 MB cloud limit.');
 const parts=[];
 for(let offset=0;offset<bytes.length;offset+=transferChunkBytes){const chunk=bytes.subarray(offset,offset+transferChunkBytes);let binary='';for(let at=0;at<chunk.length;at+=32768)binary+=String.fromCharCode(...chunk.subarray(at,at+32768));parts.push(btoa(binary))}
 return{descriptor:{pixelMillTransfer:1,token,parts:parts.length,hash:await transferHash(bytes)},parts};
}
export async function unpackTransfer(descriptor,parts){
 if(!isTransfer(descriptor)||parts.length!==descriptor.parts)throw Error('Invalid cloud transfer.');
 const chunks=parts.map(part=>{if(!validTransferPart(part))throw Error('Invalid cloud transfer part.');const decoded=Uint8Array.from(atob(part),c=>c.charCodeAt(0));if(decoded.length>transferChunkBytes)throw Error('Invalid cloud transfer part.');return decoded});
 const length=chunks.reduce((total,part)=>total+part.length,0);if(length>transferLimitBytes)throw Error('Cloud transfer is too large.');
 const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
 if(await transferHash(bytes)!==descriptor.hash)throw Error('Cloud transfer failed its integrity check.');
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function transferMap(values,action){
 const result=[];let next=0;
 await Promise.all(Array.from({length:Math.min(3,values.length)},async()=>{while(next<values.length){const index=next++;result[index]=await action(values[index],index)}}));return result;
}
