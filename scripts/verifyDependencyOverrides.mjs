import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function installedPackages(modules, result = []) {
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const location = path.join(modules, entry.name);
    if (entry.name.startsWith('@')) {
      installedPackages(location, result);
      continue;
    }
    const manifest = path.join(location, 'package.json');
    if (!existsSync(manifest)) continue;
    result.push({ location, metadata: json(manifest) });
    if (existsSync(path.join(location, 'node_modules'))) installedPackages(path.join(location, 'node_modules'), result);
  }
  return result;
}

function packageFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const relative = prefix + entry.name;
    return entry.isDirectory() ? packageFiles(path.join(directory, entry.name), relative + '/') : [relative];
  });
}

function assertInstalledIntegrity(location, expected, root) {
  const actual = realpathSync(location);
  const relative = path.relative(root, actual);
  assert.equal(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep), false, 'override escaped the private project');
  assert.deepEqual(packageFiles(actual).sort(), Object.keys(expected.files).sort(), 'unexpected/missing override source file');
  for (const [file, digest] of Object.entries(expected.files)) {
    assert.equal(sha256(path.join(actual, file)), digest, `override integrity mismatch: ${file}`);
  }
}

function verifyDecoderCompatibility(root, packages, lock) {
  const proof=json(path.join(root,'vendor/decoderProvenance.json'));
  const upstream=readFileSync(path.join(root,proof.originalArchive));
  assert.equal('sha512-'+createHash('sha512').update(upstream).digest('base64'),proof.originalIntegrity,'upstream decoder archive mismatch');
  const tar=gunzipSync(upstream);let source;
  for(let position=0;position+512<=tar.length;){
    const name=tar.subarray(position,position+100).toString().replace(/\0.*$/s,'');
    const size=parseInt(tar.subarray(position+124,position+136).toString().replace(/\0.*$/s,'').trim(),8)||0;
    if(name==='package/index.js')source=tar.subarray(position+512,position+512+size).toString('utf8');
    position+=512+Math.ceil(size/512)*512;
  }
  assert.equal(typeof source,'string','official decoder runtime missing');
  assert.equal(createHash('sha256').update(source).digest('hex'),proof.originalIndexSha256);
  assert.equal(readFileSync(path.join(root,proof.sourceDirectory,'index.js'),'utf8'),source.replace('export default function decodeUriComponent','module.exports = function decodeUriComponent'),'decoder logic differs from official fixed release');
  assertInstalledIntegrity(path.join(root,proof.sourceDirectory),proof,root);
  assert.equal('sha512-'+createHash('sha512').update(readFileSync(path.join(root,proof.archive.path))).digest('base64'),proof.archive.integrity,'decoder tarball integrity mismatch');
  const consumers=packages.filter(p=>p.metadata.dependencies?.['decode-uri-component']);
  assert.deepEqual(consumers.map(p=>p.metadata.name),['query-string'],'decoder consumer inventory changed');
  const copies=packages.filter(p=>p.metadata.name==='decode-uri-component');
  assert.ok(copies.length>0,'decoder compatibility package missing');
  for(const pkg of copies){assert.equal(pkg.metadata.version,'0.5.0');assertInstalledIntegrity(pkg.location,proof,root);}
  for(const consumer of consumers){
    assert.equal(consumer.metadata.version,proof.consumer.version);
    assert.equal(sha256(path.join(consumer.location,'index.js')),proof.consumer.indexSha256,'query parser changed without compatibility review');
    const require=createRequire(path.join(consumer.location,'package.json'));
    assertInstalledIntegrity(path.dirname(require.resolve('decode-uri-component/package.json')),proof,root);
  }
  for(const [location,metadata] of Object.entries(lock.packages))if(location.endsWith('/decode-uri-component')){
    assert.equal(metadata.resolved,'file:'+proof.archive.path);assert.equal(metadata.integrity,proof.archive.integrity);
  }
}

/** Mandatory local-package gate supplements the unchanged registry audit. */
export function verifyDependencyOverrides(root = defaultRoot) {
  const provenance = json(path.join(root, 'vendor/securityProvenance.json'));
  const lock = json(path.join(root, 'package-lock.json'));
  for (const expected of [provenance.forge, provenance.matcher]) {
    assertInstalledIntegrity(path.join(root, expected.sourceDirectory), expected, root);
    const archiveHash = 'sha512-' + createHash('sha512').update(readFileSync(path.join(root,expected.archive.path))).digest('base64');
    assert.equal(archiveHash,expected.archive.integrity,'tracked tarball integrity mismatch');
  }
  const packages = installedPackages(path.join(root, 'node_modules'));
  const forgeConsumers = packages.filter(({ metadata }) => metadata.dependencies?.['node-forge']);
  const matcherConsumers = packages.filter(({ metadata }) => metadata.dependencies?.micromatch);
  assert.deepEqual(forgeConsumers.map(p => p.metadata.name).sort(), ['@expo/cli', '@expo/code-signing-certificates'], 'forge consumer inventory changed');
  assert.deepEqual(matcherConsumers.map(p => p.metadata.name).sort(), ['metro-file-map'], 'matcher consumer inventory changed');
  for (const consumer of [...forgeConsumers,...matcherConsumers]) {
    const expected = provenance.consumers[consumer.metadata.name];
    assert.equal(consumer.metadata.version,expected.version,'consumer version changed without compatibility review');
    for (const [file,digest] of Object.entries(expected.files)) {
      assert.equal(sha256(path.join(consumer.location,file)),digest,'consumer source changed without compatibility review');
    }
  }
  assert.equal(packages.some(p => p.metadata.name === 'braces' || p.metadata.name === 'micromatch'), false, 'unsubstituted vulnerable brace dependency installed');
  const installedForge = packages.filter(p => p.metadata.name === 'node-forge');
  assert.ok(installedForge.length > 0, 'forge substitute missing');
  for (const pkg of installedForge) {
    assert.equal(pkg.metadata.version, '1.4.0', 'original forge identity/version must remain truthful');
    assertInstalledIntegrity(pkg.location, provenance.forge, root);
  }
  for (const [location,metadata] of Object.entries(lock.packages)) {
    if (location.endsWith('/node-forge') || location.endsWith('/micromatch')) {
      const expected = location.endsWith('/node-forge') ? provenance.forge : provenance.matcher;
      assert.equal(metadata.resolved,'file:'+expected.archive.path,'unexpected registry/unpatched override entry');
      assert.equal(metadata.integrity,expected.archive.integrity,'lockfile override integrity mismatch');
    }
  }
  for (const consumer of forgeConsumers) {
    const require = createRequire(path.join(consumer.location, 'package.json'));
    const resolved = path.dirname(require.resolve('node-forge/package.json'));
    assertInstalledIntegrity(resolved, provenance.forge, root);
  }
  for (const consumer of matcherConsumers) {
    const require = createRequire(path.join(consumer.location, 'package.json'));
    const resolved = path.dirname(require.resolve('micromatch/package.json'));
    assertInstalledIntegrity(resolved, provenance.matcher, root);
    const matcherRequire = createRequire(path.join(resolved, 'package.json'));
    assert.equal(matcherRequire('picomatch/package.json').version, '4.0.7');
  }
  verifyDecoderCompatibility(root,packages,lock);
  return { forgeConsumers: forgeConsumers.length, matcherConsumers: matcherConsumers.length, forgeCopies: installedForge.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Dependency override integrity PASS', verifyDependencyOverrides());
}
