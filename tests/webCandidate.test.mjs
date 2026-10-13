import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {finalizeWebCandidate} from '../scripts/finalizeWebCandidate.mjs';
test('Pages fallback retains original URL/query/hash by using the exact SPA entry without redirects',async()=>{
  const folder=await mkdtemp(resolve(tmpdir(),'mali-web-candidate-'));
  try{
    const entry='<html><script src="/mali-app/_expo/static/js/web/entry.js"></script></html>';
    await writeFile(resolve(folder,'index.html'),entry);
    await finalizeWebCandidate(folder);assert.equal(await readFile(resolve(folder,'404.html'),'utf8'),entry);
    assert.equal(await readFile(resolve(folder,'.nojekyll'),'utf8'),'');
    await writeFile(resolve(folder,'index.html'),'<html>not built</html>');await assert.rejects(finalizeWebCandidate(folder));
  }finally{assert.ok(folder.startsWith(resolve(tmpdir())+sep));await rm(folder,{recursive:true,force:true});}
});
