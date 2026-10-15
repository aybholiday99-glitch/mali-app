// Manual fixture regeneration only. The directory must contain the original
// npm packages, extracted after verifying each registry tarball's SHA-512.
// Never run against the installed Mali adapter to produce its own oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const inputDir = process.argv[2] || '.audit/matcher-baseline';
if (typeof inputDir !== 'string' || inputDir.includes('..') || path.isAbsolute(inputDir)) {
  throw new Error('Path traversal protection: directory must be relative to project');
}
const directory = path.resolve(inputDir);
const fixture = fileURLToPath(new URL('../tests/fixtures/metroMatcherBaseline.json', import.meta.url));
const baseline = JSON.parse(readFileSync(fixture, 'utf8'));
const originals = createRequire(path.join(directory, 'baseline.cjs'));
assert.equal(originals('micromatch/package.json').version, '4.0.8');
assert.equal(originals('picomatch/package.json').version, '2.3.2');
const source = originals.resolve('micromatch');
const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
assert.equal(digest, baseline.origin.sourceSha256);
const matcher = originals('micromatch');
const answers = {};
for (const [platform, windows] of [['windows', true], ['posix', false]]) {
  answers[platform] = baseline.cases.flatMap(({ globs, options }) =>
    baseline.paths.map(file => matcher.some(file, globs, { ...options, windows }) ? '1' : '0')).join('');
  assert.equal(answers[platform].length, 11352);
}
if (typeof baseline.answers === 'string') {
  assert.equal(answers.windows, baseline.answers, 'all previously recorded Windows results remain unchanged');
}
baseline.origin.platformOptions = { windows: { windows: true }, posix: { windows: false } };
baseline.origin.archives = JSON.parse(readFileSync(path.join(directory, 'origins.json'), 'utf8'));
delete baseline.answers;
baseline.platformAnswers = answers;
writeFileSync(fixture, JSON.stringify(baseline, null, 2) + '\n');
console.log('Recorded 22,704 original matcher results (11,352 Windows and 11,352 POSIX).');
