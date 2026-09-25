import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {agentFetch} from '../worker/api.mjs';

class Bucket{
 constructor(){this.data=new Map();this.version=0}
 async get(key,options={}){const o=this.data.get(key);if(!o)return null;if(o.etag===options.ifNoneMatch)return{etag:o.etag,notModified:true};return{etag:o.etag,json:async()=>JSON.parse(o.text)}}
 async put(key,text,{onlyIf}={}){const old=this.data.get(key);if(onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++this.version);this.data.set(key,{etag,text});return{etag}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.data.delete(key)}
}

test('browser: named mobile projects stay live across GPT edits, reopen and confirmed deletion',{skip:!process.env.PIXEL_MILL_BROWSER,timeout:60000},async t=>{
 const {chromium}=await import('playwright'),env={BUCKET:new Bucket()},root=fileURLToPath(new URL('../dist/',import.meta.url));let origin;
 const server=http.createServer(async(req,res)=>{
  const abort=new AbortController();res.on('close',()=>abort.abort());
  try{
   const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/mcp/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const result=await agentFetch(new Request(url,{method:req.method,headers:req.headers,signal:abort.signal,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);
    res.writeHead(result.status,Object.fromEntries(result.headers));if(result.headers.get('content-type')?.startsWith('text/event-stream'))res.flushHeaders();if(result.body)for await(const chunk of result.body){if(res.destroyed)break;res.write(chunk)}if(!res.destroyed)res.end();return;
   }
   const file=path.join(root,url.pathname==='/'?'index.html':url.pathname);if(!file.startsWith(root)){res.writeHead(403).end();return}
   const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html':'application/octet-stream'});res.end(bytes);
  }catch(error){if(!res.destroyed){if(!res.headersSent)res.writeHead(500);res.end(String(error))}}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#app').inert);
 await page.click('#menu-button');let downloads=0;page.on('download',()=>downloads++);await page.click('#save');await page.waitForTimeout(100);assert.equal(downloads,0);assert.equal(await page.locator('#project-name').getAttribute('required'),'');assert.equal(env.BUCKET.data.size,0);
 await page.fill('#project-name','Frostpasset');await page.click('#save');await page.waitForFunction(()=>location.hash.startsWith('#project='));const projectToken=new URL(page.url()).hash.slice(9);
 await page.click('#menu-button');await page.click('#agent-button');await page.click('#agent-connect');await page.waitForFunction(()=>document.querySelector('#agent-url').value.includes('/mcp/'));const mcp=await page.locator('#agent-url').inputValue();await page.click('#close-agent');
 const tool=async(name,args={})=>{const response=await fetch(mcp,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return(await response.json()).result};
 const read=await tool('get_level');const edit=await tool('edit_level',{revision:read.structuredContent.revision,operations:[{type:'rename',name:'GPT changed'},{type:'block',id:'live-floor',x:0,y:32,width:128,height:16}]});assert.equal(edit.isError,undefined);
 await page.waitForFunction(()=>document.querySelector('#project-name').value==='GPT changed',{},{timeout:6000});
 await page.click('#menu-button');const downloading=page.waitForEvent('download');await page.click('#save');const download=await downloading;const exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(exported.name,'GPT changed');assert.ok(exported.objects.some(o=>o.id==='live-floor'));
 const second=await context.newPage();second.on('pageerror',error=>errors.push(error.message));await second.goto(origin+'/#project='+projectToken);await second.waitForFunction(()=>!document.querySelector('#app').inert&&document.querySelector('#project-name').value==='GPT changed');
 await page.click('#menu-button');await page.click('#projects-button');const remove=page.getByRole('button',{name:'Delete GPT changed',exact:true}).first();assert.ok(await remove.isVisible());const rect=await remove.boundingBox();assert.ok(rect.width>=44&&rect.height>=44);
 page.once('dialog',dialog=>dialog.dismiss());await remove.click();assert.equal((await fetch(origin+'/api/projects/'+projectToken)).status,200);
 await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/project-lifecycle-mobile.png'});
 page.once('dialog',dialog=>dialog.accept());await remove.click();await page.waitForFunction(()=>document.querySelector('#saved-projects').textContent.includes('No saved projects'));
 assert.equal((await fetch(origin+'/api/projects/'+projectToken)).status,410);await second.waitForFunction(()=>/inactive|deleted|unavailable/i.test(document.querySelector('#sync-status').textContent),{},{timeout:6000});
 assert.deepEqual(errors,[]);
});
