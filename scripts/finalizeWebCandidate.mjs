import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Prepare a Pages SPA fallback in the local artifact; this never publishes it. */
export async function finalizeWebCandidate(directory=resolve('dist')){
  const entry=await readFile(resolve(directory,'index.html'),'utf8');
  if(!/<script\b/i.test(entry) || !entry.includes('/mali-app/'))throw new Error('Missing built Router entry/base path; refusing an invalid web fallback.');
  await writeFile(resolve(directory,'404.html'),entry,'utf8');
  await writeFile(resolve(directory,'.nojekyll'),'','utf8');
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await finalizeWebCandidate();
