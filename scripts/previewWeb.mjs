import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.ttf':'font/ttf','.png':'image/png','.ico':'image/x-icon'};
createServer(async (request,response)=>{
  try {
    const url=new URL(request.url,'http://127.0.0.1');
    const pathname=decodeURIComponent(url.pathname).replace(/^\/mali-app(?=\/|$)/,'');
    let path=resolve(root,'.'+pathname);
    if(path!==root&&!path.startsWith(root+sep)){response.writeHead(403).end();return;}
    if(path===root||(await stat(path)).isDirectory())path=resolve(root,'index.html');
    const body=await readFile(path);
    response.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
    response.end(body);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(8137,'127.0.0.1',()=>console.log('Mali candidate preview: http://127.0.0.1:8137/mali-app/'));
