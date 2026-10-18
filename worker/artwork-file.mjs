import {decodePNG,dataURL} from '../dist/png.mjs';

export async function downloadArtworkFile(file,fetcher=fetch){
 if(!file||typeof file!=='object'||Array.isArray(file)||typeof file.file_id!=='string'||!file.file_id.trim()||file.file_id.length>512||typeof file.download_url!=='string'||file.download_url.length>16384)throw Error('Pass the generated PNG as a ChatGPT file.');
 if(file.mime_type!==undefined&&(typeof file.mime_type!=='string'||file.mime_type.toLowerCase()!=='image/png'))throw Error('Return a PNG file from ChatGPT image generation.');
 if(file.file_name!==undefined&&(typeof file.file_name!=='string'||file.file_name.length>1024))throw Error('Invalid generated artwork filename.');
 let url;try{url=new URL(file.download_url)}catch{throw Error('Invalid ChatGPT file download URL.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!/(^|\.)(?:oaiusercontent|chatgptusercontent)\.com$/.test(url.hostname))throw Error('Use the temporary file download URL supplied by ChatGPT.');
 const maxBytes=8_999_982;
 let response;try{response=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw Error('The ChatGPT file could not be downloaded. Pass the generated file again to refresh its temporary link.');}
 if(response.redirected||!response.ok){await response.body?.cancel();throw Error('The ChatGPT file link expired or could not be downloaded. Pass the generated file again.');}
 const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
 if(mime&&!['image/png','application/octet-stream','binary/octet-stream'].includes(mime)){await response.body?.cancel();throw Error('The ChatGPT download did not return a PNG.');}
 const length=Number(response.headers.get('content-length'));
 if(length>maxBytes){await response.body?.cancel();throw Error('Generated artwork must be a PNG under 9 MB.');}
 if(!response.body)throw Error('The ChatGPT download was empty.');
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw Error('Generated artwork must be a PNG under 9 MB.');}parts.push(value)}}catch(error){if(bytes>maxBytes)throw error;throw Error('The ChatGPT file download was interrupted. Pass the generated file again.');}finally{reader.releaseLock()}
 const png=new Uint8Array(bytes);let at=0;for(const part of parts){png.set(part,at);at+=part.byteLength}
 try{await decodePNG(png)}catch{throw Error('Return a valid 8-bit PNG within 4096 px and four million pixels.');}
 return dataURL(png);
}
