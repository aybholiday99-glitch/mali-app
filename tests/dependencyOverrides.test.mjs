import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { constants, createHash, generateKeyPairSync, privateEncrypt, verify, X509Certificate } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDependencyOverrides } from '../scripts/verifyDependencyOverrides.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const certificates = require('@expo/code-signing-certificates');
const certRequire = createRequire(require.resolve('@expo/code-signing-certificates'));
const expoRequire = createRequire(require.resolve('expo/package.json'));
const cliRoot = path.dirname(expoRequire.resolve('@expo/cli/package.json'));
const cliRequire = createRequire(path.join(cliRoot, 'package.json'));
const { signManifestString } = require(path.join(cliRoot, 'build/src/utils/codesigning.js'));
const { includedByGlob } = require(path.join(path.dirname(require.resolve('metro-file-map/package.json')), 'src/watchers/common.js'));
const matcher = createRequire(require.resolve('metro-file-map/package.json'))('micromatch');

test('every installed override and actual consumer passes the mandatory source integrity gate', () => {
  const report = verifyDependencyOverrides();
  assert.equal(report.forgeConsumers,2);
  assert.equal(report.matcherConsumers,1);
  assert.equal(cliRequire.resolve('node-forge'),certRequire.resolve('node-forge'));
});

test('integrity gate rejects a modified installed file and an unexpected forge consumer', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(),'mali-dependency-gate-'));
  try {
    cpSync(path.join(root,'vendor'),path.join(temporary,'vendor'),{recursive:true});
    cpSync(path.join(root,'package-lock.json'),path.join(temporary,'package-lock.json'));
    const pkg = (name, dependencies = {}) => {
      const directory = path.join(temporary,'node_modules',name);
      mkdirSync(directory,{recursive:true});
      writeFileSync(path.join(directory,'package.json'),JSON.stringify({name,version:'1.0.0',dependencies}));
    };
    pkg('@expo/cli',{'node-forge':'1.4.0'});
    pkg('@expo/code-signing-certificates',{'node-forge':'1.4.0'});
    pkg('metro-file-map',{micromatch:'4.0.8'});
    const provenance = JSON.parse(readFileSync(path.join(root,'vendor/securityProvenance.json'),'utf8'));
    for (const [name,source] of [['@expo/cli',cliRoot],['@expo/code-signing-certificates',path.dirname(require.resolve('@expo/code-signing-certificates/package.json'))],
      ['metro-file-map',path.dirname(require.resolve('metro-file-map/package.json'))]]) {
      const destination = path.join(temporary,'node_modules',name);
      cpSync(path.join(source,'package.json'),path.join(destination,'package.json'));
      for (const file of Object.keys(provenance.consumers[name].files)) {
        mkdirSync(path.dirname(path.join(destination,file)),{recursive:true});
        cpSync(path.join(source,file),path.join(destination,file));
      }
    }
    pkg('picomatch');
    writeFileSync(path.join(temporary,'node_modules/picomatch/package.json'),JSON.stringify({name:'picomatch',version:'4.0.7'}));
    cpSync(path.dirname(certRequire.resolve('node-forge/package.json')),path.join(temporary,'node_modules/node-forge'),{recursive:true});
    cpSync(path.dirname(createRequire(require.resolve('metro-file-map/package.json')).resolve('micromatch/package.json')),path.join(temporary,'node_modules/micromatch'),{recursive:true});
    assert.equal(verifyDependencyOverrides(temporary).forgeConsumers,2);
    const rsa = path.join(temporary,'node_modules/node-forge/lib/rsa.js');
    const original = readFileSync(rsa);
    writeFileSync(rsa,Buffer.concat([original,Buffer.from('\n// modified installed bytes\n')]));
    assert.throws(()=>verifyDependencyOverrides(temporary),/integrity mismatch: lib\/rsa.js/);
    writeFileSync(rsa,original);
    const archive = path.join(temporary,'vendor/node-forge-1.4.0.tgz');
    const archived = readFileSync(archive);
    writeFileSync(archive,Buffer.concat([archived,Buffer.from([0])]));
    assert.throws(()=>verifyDependencyOverrides(temporary),/tarball integrity mismatch/);
    writeFileSync(archive,archived);
    pkg('extra-package');
    const extra = path.join(temporary,'node_modules/extra-package/node_modules/node-forge');
    cpSync(path.join(temporary,'node_modules/node-forge'),extra,{recursive:true});
    writeFileSync(path.join(extra,'lib/rsa.js'),Buffer.concat([original,Buffer.from('\n// unqualified copy\n')]));
    assert.throws(()=>verifyDependencyOverrides(temporary),/integrity mismatch: lib\/rsa.js/);
    writeFileSync(path.join(extra,'lib/rsa.js'),original);
    pkg('unreviewed-consumer',{'node-forge':'1.4.0'});
    assert.throws(()=>verifyDependencyOverrides(temporary),/consumer inventory changed/);
  } finally {
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));
    rmSync(temporary,{recursive:true,force:true});
  }
});

test('picomatch adapter preserves 22,704 original Windows/POSIX results and the real Metro consumer platform semantics', () => {
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/metroMatcherBaseline.json',import.meta.url),'utf8'));
  const hostPlatform = process.platform === 'win32' ? 'windows' : 'posix';
  for (const [platform, windows] of [['windows',true],['posix',false]]) {
    let index = 0;
    assert.equal(baseline.platformAnswers[platform].length,11352);
    for (const { globs, options } of baseline.cases) {
      for (const file of baseline.paths) {
        const expected = baseline.platformAnswers[platform][index++] === '1';
        const explicitOptions = { ...options, windows };
        assert.equal(matcher.some(file,globs,explicitOptions),expected,JSON.stringify({platform,file,globs,options:explicitOptions}));
        if (platform === hostPlatform) {
          assert.equal(matcher.some(file,globs,options),expected,'host default '+JSON.stringify({platform,file,globs,options}));
          if (Object.keys(options).length === 1 && globs.length) {
            assert.equal(includedByGlob('f',globs,options.dot,file),expected,'real Metro watcher '+JSON.stringify({platform,file,globs,options}));
          }
        }
      }
    }
    assert.equal(index,11352);
  }
  assert.equal(matcher.some('src\\foo.ts',['src/**'],{dot:false,windows:true}),true);
  assert.equal(matcher.some('src\\foo.ts',['src/**'],{dot:false,windows:false}),false);
  assert.equal(matcher.some(['foo.ts','bar.ts'],'*.js'),false,'array callback index must not enable picomatch returnObject');
  assert.equal(includedByGlob('d',[],false,'.hidden'),false);
  assert.equal(includedByGlob('d',[],true,'.hidden'),true);
  assert.equal(includedByGlob('f',[],false,'file.ts'),true);
  assert.equal(includedByGlob('f',[],false,'.hidden'),false);
});

test('deep brace patterns below the old character cap do not enter recursive brace walkers', () => {
  const pattern = '{'.repeat(4500)+'a,b'+'}'.repeat(4500);
  assert.equal(pattern.length < 10000,true);
  assert.equal(typeof matcher.some('a',pattern), 'boolean');
  assert.equal(typeof includedByGlob('f',[pattern],false,'a'),'boolean');
});

const rsaPair = generateKeyPairSync('rsa',{modulusLength:2048,publicExponent:3});
const privatePem = rsaPair.privateKey.export({type:'pkcs1',format:'pem'});
const publicPem = rsaPair.publicKey.export({type:'pkcs1',format:'pem'});
const publicKey = certificates.convertPublicKeyPEMToPublicKey(publicPem);
const message = Buffer.from('Mali isolated security regression');
const digest = createHash('sha256').update(message).digest();
const signatureFor = digestInfo => {
  const padding = Buffer.alloc(256-digestInfo.length-3,0xff);
  assert.ok(padding.length >= 8);
  return privateEncrypt({key:rsaPair.privateKey,padding:constants.RSA_NO_PADDING},Buffer.concat([Buffer.from([0,1]),padding,Buffer.from([0]),digestInfo]));
};
const der = (tag, content) => Buffer.concat([Buffer.from([tag,content.length]),content]);
const oid = Buffer.from('0609608648016503040201','hex');
const digestInfo = (algorithm, value = digest) => der(0x30,Buffer.concat([der(0x30,algorithm),der(0x04,value)]));

test('actual Expo and CLI forge consumers reject nested garbage, invalid NULLs and non-minimal DigestInfo', () => {
  const malicious = [
    digestInfo(Buffer.concat([oid,Buffer.from('050002058888888888','hex')])),
    digestInfo(Buffer.concat([oid,Buffer.from('02088888888888888888','hex')])),
    digestInfo(Buffer.concat([oid,Buffer.from('0502abcd','hex')])),
    Buffer.concat([Buffer.from('30813230810d060960864801650304020105000420','hex'),digest]),
  ];
  const cliKey = cliRequire('node-forge').pki.publicKeyFromPem(publicPem);
  for (const encoded of malicious) {
    const signature = signatureFor(encoded);
    assert.throws(()=>publicKey.verify(digest.toString('latin1'),signature.toString('latin1')),/DigestInfo/);
    assert.throws(()=>cliKey.verify(digest.toString('latin1'),signature.toString('latin1')),/DigestInfo/);
    assert.equal(verify('sha256',message,rsaPair.publicKey,signature),false,'independent native crypto rejects fixture');
  }
  for (const parameters of [Buffer.from('0500','hex'),Buffer.alloc(0)]) {
    const signature = signatureFor(digestInfo(Buffer.concat([oid,parameters])));
    assert.equal(publicKey.verify(digest.toString('latin1'),signature.toString('latin1')),true);
  }
});

test('actual Expo certificate/CSR lifecycle and CLI manifest signing remain compatible with native crypto', () => {
  const keyPair = certificates.convertKeyPairPEMToKeyPair({privateKeyPEM:privatePem,publicKeyPEM:publicPem});
  const certificate = certificates.generateSelfSignedCodeSigningCertificate({keyPair,
    validityNotBefore:new Date(Date.now()-60000),validityNotAfter:new Date(Date.now()+86400000),commonName:'Mali isolated certificate'});
  const pem = certificates.convertCertificateToCertificatePEM(certificate);
  const parsed = certificates.convertCertificatePEMToCertificate(pem);
  certificates.validateSelfSignedCertificate(parsed,keyPair);
  const native = new X509Certificate(pem);
  assert.equal(native.verify(rsaPair.publicKey),true);
  const signature = certificates.signBufferRSASHA256AndVerify(keyPair.privateKey,parsed,message);
  assert.equal(verify('sha256',message,rsaPair.publicKey,Buffer.from(signature,'base64')),true);
  const manifest = JSON.stringify({id:'isolated-manifest',runtimeVersion:'test'});
  const cliSignature = signManifestString(manifest,{privateKey:privatePem,certificateForPrivateKey:pem});
  assert.equal(verify('sha256',Buffer.from(manifest),rsaPair.publicKey,Buffer.from(cliSignature,'base64')),true);
  const cliCertificate = cliRequire('node-forge').pki.certificateFromPem(pem);
  assert.equal(cliCertificate.subject.getField('CN').value,'Mali isolated certificate','iOS signing consumer certificate field API');
  const csr = certificates.generateCSR(keyPair,'Mali isolated CSR');
  const parsedCsr = certificates.convertCSRPEMToCSR(certificates.convertCSRToCSRPEM(csr));
  assert.equal(parsedCsr.verify(),true);
  const development = certificates.generateDevelopmentCertificateFromCSR(keyPair.privateKey,parsed,parsedCsr,'00000000-0000-4000-8000-000000000000','@mali/isolated');
  assert.equal(parsed.verify(development),true);
  assert.equal(development.getExtension({id:certificates.expoProjectInformationOID}).value,'00000000-0000-4000-8000-000000000000,@mali/isolated');
  const certificateDigest = Buffer.from(parsed.md.digest().getBytes(),'latin1');
  const malformedSignature = signatureFor(digestInfo(Buffer.concat([oid,Buffer.from('0500020101','hex')]),certificateDigest));
  parsed.signature = malformedSignature.toString('latin1');
  assert.throws(()=>parsed.verify(parsed),/DigestInfo/,'actual Expo certificate verification rejects crafted signature');
  const maliciousPem = certificates.convertCertificateToCertificatePEM(parsed);
  const cliParsed = cliRequire('node-forge').pki.certificateFromPem(maliciousPem);
  assert.throws(()=>cliParsed.verify(cliParsed),/DigestInfo/,'actual CLI PEM parsing preserves rejection during certificate verification');
});
