import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const xcode = require('xcode');
// Resolve from the consumer itself, so a second root copy cannot hide an old nested UUID.
const xcodeRequire = createRequire(require.resolve('xcode/package.json'));
const uuid = xcodeRequire('uuid');
const uuidManifest = JSON.parse(readFileSync(xcodeRequire.resolve('uuid/package.json'), 'utf8'));
const mainGroupId = '111111111111111111111111';
const projectId = '222222222222222222222222';

// Original synthetic project: no customer project, signing identity, or native build output.
const projectFixture = `// !$*UTF8*$!
{
  archiveVersion = 1;
  classes = {};
  objectVersion = 56;
  objects = {
    /* Begin PBXBuildFile section */
    333333333333333333333333 /* Seed.js in Sources */ = {isa = PBXBuildFile; fileRef = 444444444444444444444444 /* Seed.js */; };
    /* End PBXBuildFile section */
    /* Begin PBXFileReference section */
    444444444444444444444444 /* Seed.js */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.javascript; path = Seed.js; sourceTree = "<group>"; };
    /* End PBXFileReference section */
    /* Begin PBXGroup section */
    ${mainGroupId} /* Mali */ = {isa = PBXGroup; children = (444444444444444444444444 /* Seed.js */,); name = Mali; sourceTree = "<group>"; };
    /* End PBXGroup section */
    /* Begin PBXProject section */
    ${projectId} /* Project object */ = {
      isa = PBXProject;
      attributes = {LastUpgradeCheck = 1500; };
      buildConfigurationList = 555555555555555555555555 /* Build configuration list */;
      compatibilityVersion = "Xcode 14.0";
      developmentRegion = en;
      hasScannedForEncodings = 0;
      knownRegions = (en, Base,);
      mainGroup = ${mainGroupId};
      projectDirPath = "";
      projectRoot = "";
      targets = ();
    };
    /* End PBXProject section */
    /* Begin XCBuildConfiguration section */
    666666666666666666666666 /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {PRODUCT_NAME = Mali; }; name = Debug; };
    777777777777777777777777 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {PRODUCT_NAME = Mali; }; name = Release; };
    /* End XCBuildConfiguration section */
    /* Begin XCConfigurationList section */
    555555555555555555555555 /* Build configuration list */ = {isa = XCConfigurationList; buildConfigurations = (666666666666666666666666 /* Debug */, 777777777777777777777777 /* Release */,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
    /* End XCConfigurationList section */
  };
  rootObject = ${projectId} /* Project object */;
}
`;

function withProject(action) {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'mali-xcode-toolchain-'));
  try {
    const path = join(directory, 'project.pbxproj');
    writeFileSync(path, projectFixture, 'utf8');
    return action(xcode.project(path).parseSync(), path);
  } finally {
    // Verify the resolved target before recursive cleanup, including on Windows.
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith('mali-xcode-toolchain-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('xcode resolves patched UUID 11.1.1 through its actual CommonJS dependency entry', () => {
  assert.equal(uuidManifest.version, '11.1.1');
  assert.match(xcodeRequire.resolve('uuid'), /[/\\]dist[/\\]cjs[/\\]index\.js$/);
  assert.equal(typeof uuid.v4, 'function');
});

test('actual xcode UUID generation retains 24 uppercase hexadecimal characters without collisions', () => {
  withProject(project => {
    const existing = new Set(project.allUuids());
    const generated = new Set();
    for (let index = 0; index < 2000; index++) {
      const id = project.generateUuid();
      assert.match(id, /^[A-F0-9]{24}$/);
      assert.equal(existing.has(id), false);
      assert.equal(generated.has(id), false);
      generated.add(id);
    }
    assert.equal(generated.size, 2000);
  });
});

test('actual xcode parser, group/file edit and writer round-trip remain compatible', () => {
  withProject((project, path) => {
    assert.equal(project.getFirstProject().uuid, projectId);
    const group = project.addPbxGroup(['Audit.js'], 'Audit', 'Audit');
    project.addToPbxGroup(group.uuid, mainGroupId);
    project.updateBuildProperty('PRODUCT_NAME', 'MaliAudit');
    assert.match(group.uuid, /^[A-F0-9]{24}$/);

    const addedFileId = group.pbxGroup.children[0].value;
    const originalFilePath = project.hash.project.objects.PBXFileReference[addedFileId].path;
    const written = project.writeSync();
    writeFileSync(path, written, 'utf8');
    const reparsed = xcode.project(path).parseSync();
    assert.equal(reparsed.getFirstProject().uuid, projectId);
    const groups = reparsed.hash.project.objects.PBXGroup;
    assert.equal(groups[group.uuid].name, 'Audit');
    assert.equal(groups[group.uuid].path, 'Audit');
    assert.ok(groups[mainGroupId].children.some(child => child.value === group.uuid));
    const fileId = groups[group.uuid].children[0].value;
    const reparsedFilePath = reparsed.hash.project.objects.PBXFileReference[fileId].path;
    // Xcode's AST preserves quoted PBX string tokens rather than decoding them.
    assert.equal(reparsedFilePath, originalFilePath);
    assert.equal(JSON.parse(reparsedFilePath), 'Audit.js');
    assert.match(fileId, /^[A-F0-9]{24}$/);
    const configurations = reparsed.pbxXCBuildConfigurationSection();
    for (const [id, configuration] of Object.entries(configurations)) {
      if (!id.endsWith('_comment')) assert.equal(configuration.buildSettings.PRODUCT_NAME, 'MaliAudit');
    }
    assert.equal(new Set(reparsed.allUuids()).size, reparsed.allUuids().length);
  });
});

test('installed patched UUID v5 rejects invalid output bounds without partially modifying buffers', () => {
  for (const [length, offset] of [[8, 0], [16, 1], [32, 17], [32, -1]]) {
    const output = new Uint8Array(length).fill(0xaa);
    const before = output.slice();
    assert.throws(() => uuid.v5('mali-toolchain', uuid.v5.DNS, output, offset), RangeError);
    assert.deepEqual(output, before);
  }
  const validOutput = new Uint8Array(32).fill(0xaa);
  uuid.v5('mali-toolchain', uuid.v5.DNS, validOutput, 16);
  assert.deepEqual(validOutput.slice(0, 16), new Uint8Array(16).fill(0xaa));
  assert.equal(uuid.stringify(validOutput, 16), uuid.v5('mali-toolchain', uuid.v5.DNS));
});
