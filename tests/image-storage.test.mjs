import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createImageStorage} from '../worker/image-storage.mjs';

const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const src='data:image/png;base64,'+bytes.toString('base64');
const project={project:{assets:[{id:'a',src}],name:'Garden'},history:[{assets:[{id:'a',src}]}],preview:{src},revision:5};
const hash=createHash('sha256').update(src).digest('hex');

test('image copies are stored once and restore exactly across nested history',async()=>{
 const codec=createImageStorage({key:()=>undefined});
 const packed=JSON.parse(await codec.encode(JSON.stringify(project)));
 assert.equal(packed.images.length,1);assert.equal(packed.images[0].paths.length,3);
 assert.equal(packed.images[0].source,src);
 assert.deepEqual(await codec.decode(packed),project);
 assert.deepEqual(await codec.decode(project),project);
 assert.equal(await codec.encode('{"revision":3}'),'{"revision":3}');
});

test('ImgBB receives a private key in POST body, verifies original PNG and reuses uploads',async()=>{
 let uploads=0,downloads=0;
 const fetcher=async(url,options)=>{
  if(url==='https://api.imgbb.com/1/upload'){
   uploads++;assert.equal(options.method,'POST');assert.equal(options.body.get('key'),'secret');assert.equal(options.body.get('image'),bytes.toString('base64'));assert.equal(options.redirect,'error');
   return Response.json({success:true,data:{image:{url:'https://i.ibb.co/original.png'},url:'https://i.ibb.co/resized.png'}});
  }
  downloads++;assert.equal(url,'https://i.ibb.co/original.png');return new Response(bytes);
 };
 const codec=createImageStorage({fetcher,key:()=> 'secret'});
 const packed=JSON.parse(await codec.encode(JSON.stringify(project)));
 assert.equal(uploads,1);assert.equal(downloads,1);
 assert.equal(packed.images[0].source,undefined);assert.equal(packed.images[0].hash,hash);assert.ok(!JSON.stringify(packed).includes('secret'));
 assert.deepEqual(await codec.decode(structuredClone(packed)),project);
 await codec.encode(JSON.stringify(project));assert.equal(uploads,1);
 const cold=createImageStorage({fetcher,key:()=> 'secret'});
 assert.deepEqual(await cold.decode(structuredClone(packed)),project);assert.equal(downloads,2);
 await cold.encode(JSON.stringify(project));assert.equal(uploads,1);
});

test('upload failure preserves all image data and backs off',async()=>{
 let calls=0;
 const codec=createImageStorage({key:()=> 'secret',fetcher:async()=>{calls++;return new Response('denied',{status:403})}});
 for(let i=0;i<2;i++)assert.deepEqual(await codec.decode(JSON.parse(await codec.encode(JSON.stringify(project)))),project);
 assert.equal(calls,1);
});

test('changed image bytes fall back to originals on upload and reject corrupt stored references',async()=>{
 const fetcher=async url=>url==='https://api.imgbb.com/1/upload'?Response.json({success:true,data:{url:'https://i.ibb.co/a.png'}}):new Response('changed');
 const codec=createImageStorage({key:()=> 'key',fetcher});
 const packed=JSON.parse(await codec.encode(JSON.stringify(project)));
 assert.equal(packed.images[0].source,src);
 await assert.rejects(codec.decode({pixelMillStorage:1,data:{src:null},images:[{url:'https://i.ibb.co/a.png',hash,paths:[['src']]}]}),/integrity/);
});

test('stored references cannot request arbitrary hosts or redirects',async()=>{
 let calls=0;const codec=createImageStorage({fetcher:async()=>{calls++;throw Error('unexpected')}});
 for(const url of ['http://i.ibb.co/a','https://evil.test/a','https://i.ibb.co.evil.test/a','https://user:pass@i.ibb.co/a'])await assert.rejects(codec.decode({pixelMillStorage:1,data:{src:null},images:[{url,hash,paths:[['src']]}]}),/reference/);
 assert.equal(calls,0);
});

test('previews and disabled offloading retain their PNG without contacting ImgBB',async()=>{
 const codec=createImageStorage({key:()=> 'secret',fetcher:async()=>{throw Error('must not upload')}});
 const packed=JSON.parse(await codec.encode(JSON.stringify(project),{offload:false}));
 assert.equal(packed.images[0].source,src);assert.deepEqual(await codec.decode(packed),project);
});

test('image path reconstruction handles literal property names without prototype mutation',async()=>{
 const codec=createImageStorage({key:()=>undefined});
 const value=JSON.parse(`{"__proto__":{"src":${JSON.stringify(src)}},"constructor":${JSON.stringify(src)}}`);
 assert.deepEqual(await codec.decode(JSON.parse(await codec.encode(JSON.stringify(value)))),value);
 assert.equal({}.src,undefined);
});
