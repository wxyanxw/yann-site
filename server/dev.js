import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

try { process.loadEnvFile('.env.local'); } catch(error) { if(error.code!=='ENOENT')throw error; }
const { handleLetter } = await import('./letter-service.js');
const root=resolve('.'),port=Number(process.env.PORT||5173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm','.zip':'application/zip','.urdf':'application/xml','.md':'text/markdown; charset=utf-8'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/letter')return await handleLetter(req,res);
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    const parts=decodeURIComponent(url.pathname).split('/').filter(Boolean);
    const allowed=!parts.length||(parts.length===1&&['index.html','letter.html'].includes(parts[0]))||['assets','photo'].includes(parts[0]);
    if(!allowed||parts.some(x=>x.startsWith('.'))){res.writeHead(404);return res.end();}
    const path=resolve(root,...parts,(parts.length?'':'index.html'));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(404);return res.end();}
    const file=await stat(path);if(!file.isFile()){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Content-Length':file.size,'X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();createReadStream(path).pipe(res);
  } catch {res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`网站与信件服务：http://127.0.0.1:${server.address().port}（本地数据保存在 .letter-data）`));
