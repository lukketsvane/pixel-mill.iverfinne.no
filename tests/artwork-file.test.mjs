import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadArtworkFile} from '../worker/artwork-file.mjs';
import {encodePNG,dataURL} from '../dist/png.mjs';

const file={download_url:'https://files.oaiusercontent.com/generated.png?signature=private',file_id:'file_generated',mime_type:'image/png',file_name:'level.png'};
const png=await encodePNG({w:2,h:1,pixels:Uint8Array.from([12,24,36,255,0,0,0,0])});

test('ChatGPT file downloads keep exact PNG bytes and omit credentials',async()=>{
 let request;
 const result=await downloadArtworkFile(file,async(url,options)=>{request={url,options};return new Response(png,{headers:{'Content-Type':'image/png','Content-Length':String(png.length)}})});
 assert.equal(result,dataURL(png));assert.equal(request.url,file.download_url);assert.equal(request.options.redirect,'error');assert.equal(request.options.headers,undefined);assert.ok(request.options.signal instanceof AbortSignal);
 assert.equal(await downloadArtworkFile({download_url:'https://download.chatgptusercontent.com/file.png',file_id:'file-1'},async()=>new Response(png)),dataURL(png));
});

test('ChatGPT file download rejects non-file and untrusted URL inputs without fetching',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(png)};
 for(const value of [null,{},[],{...file,file_id:''},{...file,mime_type:'image/jpeg'},{...file,file_name:15}])await assert.rejects(downloadArtworkFile(value,fetcher));
 for(const url of ['http://files.oaiusercontent.com/a','https://127.0.0.1/a','https://localhost/a','https://files.oaiusercontent.com.evil.example/a','https://evil-oaiusercontent.com/a','https://files.oaiusercontent.com@127.0.0.1/a','https://user:pass@files.oaiusercontent.com/a','https://files.oaiusercontent.com:8443/a','https://files.oaiusercontent.com/a#fragment','file:///tmp/a','data:image/png;base64,AAAA'])await assert.rejects(downloadArtworkFile({...file,download_url:url},fetcher));
 assert.equal(calls,0);
});

test('ChatGPT file download rejects redirects, expired links and non-PNG responses',async()=>{
 await assert.rejects(downloadArtworkFile(file,async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}})),/expired|downloaded/);
 await assert.rejects(downloadArtworkFile(file,async()=>new Response(null,{status:403})),/expired/);
 await assert.rejects(downloadArtworkFile(file,async()=>{throw Error('secret signed URL')}),error=>!error.message.includes('secret')&&/refresh/.test(error.message));
 await assert.rejects(downloadArtworkFile(file,async()=>new Response(png,{headers:{'Content-Type':'text/html'}})),/did not return a PNG/);
 await assert.rejects(downloadArtworkFile(file,async()=>new Response('not a PNG',{headers:{'Content-Type':'image/png'}})),/valid 8-bit PNG/);
 await assert.rejects(downloadArtworkFile(file,async()=>new Response(png.slice(0,45),{headers:{'Content-Type':'image/png'}})),/valid 8-bit PNG/);
});

test('ChatGPT file download bounds declared and streamed bytes before decoding',async()=>{
 let canceled=false;
 const declared=new ReadableStream({cancel(){canceled=true}});
 await assert.rejects(downloadArtworkFile(file,async()=>new Response(declared,{headers:{'Content-Length':'9000000'}})),/under 9 MB/);assert.equal(canceled,true);
 canceled=false;let reads=0;
 const streamed=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(1_000_000))},cancel(){canceled=true}});
 await assert.rejects(downloadArtworkFile(file,async()=>new Response(streamed)),/under 9 MB/);assert.equal(canceled,true);assert.ok(reads<=10);
});
