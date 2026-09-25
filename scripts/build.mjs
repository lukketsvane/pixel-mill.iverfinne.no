import fs from 'node:fs';
import path from 'node:path';
// This small Worker uses platform APIs only. Embed the existing static app so
// the same origin serves its files and authenticated-by-link MCP rooms.
const files=['color.mjs','sheet-recognition.mjs','spritesheets.mjs','geometry.mjs','engine.mjs','png.mjs','pixel-core.mjs','artwork.mjs','agent.mjs'];
let source=files.map(file=>fs.readFileSync('dist/'+file,'utf8')).join('\n')+'\n'+fs.readFileSync('worker/chat.mjs','utf8')+'\n'+fs.readFileSync('worker/api.mjs','utf8');
source=source.replace(/^import .*?;\s*$/gm,'').replace(/^export \{[^}]+\}.*?;\s*$/gm,'').replace(/\bexport (?=(?:async )?function|const|class)/g,'');
const assets={};function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==='server'||entry.name==='.openai')continue;const filename=path.join(dir,entry.name);if(entry.isDirectory())collect(filename);else{const ext=path.extname(filename),type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.md':'text/plain; charset=utf-8'}[ext];if(type)assets['/'+path.relative('dist',filename)]={type,data:fs.readFileSync(filename).toString('base64')}}}}collect('dist');
source+='\nconst staticAssets='+JSON.stringify(assets)+';\n';
source+=`export default {async fetch(request,env){const p=new URL(request.url).pathname;if(p.startsWith('/api/')||p.startsWith('/mcp/'))return agentFetch(request,env);const item=staticAssets[p==='/'?'/index.html':p];if(!item)return new Response('Not found',{status:404});if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(item.data),c=>c.charCodeAt(0)),{headers:{'Content-Type':item.type,'Cache-Control':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}})}};\n`;
fs.mkdirSync('dist/server',{recursive:true});fs.writeFileSync('dist/server/index.js',source);console.log('Built Pixel Mill Worker and MCP endpoints.');
