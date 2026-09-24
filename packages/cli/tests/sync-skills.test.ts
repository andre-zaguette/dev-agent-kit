import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncSkills, readManifest, symlinkOnPath, MANIFEST_FILE } from '../src/sync-skills.ts';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'frontend-agent-sync-'));
  const source = join(base, 'skills');
  const target = join(base, 'project', '.claude', 'skills');
  mkdirSync(join(source, 'alpha', 'references'), { recursive: true });
  writeFileSync(join(source, 'alpha', 'SKILL.md'), 'alpha v1');
  writeFileSync(join(source, 'alpha', 'references', 'react.md'), 'react v1');
  mkdirSync(join(source, 'beta'));
  writeFileSync(join(source, 'beta', 'SKILL.md'), 'beta v1');
  mkdirSync(join(source, 'not-a-skill'));
  writeFileSync(join(source, 'not-a-skill', 'README.md'), 'no SKILL.md here');
  return { base, source, target, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('a fresh sync copies every skill (dirs with SKILL.md only) and writes the manifest', () => {
  const { source, target, cleanup } = setup();
  try {
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.added.sort(), ['alpha/SKILL.md', 'alpha/references/react.md', 'beta/SKILL.md']);
    assert.equal(readFileSync(join(target, 'alpha', 'references', 'react.md'), 'utf8'), 'react v1');
    assert.equal(existsSync(join(target, 'not-a-skill')), false);
    const manifest = readManifest(target);
    assert.equal(manifest.kitVersion, '0.4.0');
    assert.deepEqual(Object.keys(manifest.skills).sort(), ['alpha', 'beta']);
    assert.ok(existsSync(join(target, MANIFEST_FILE)));
  } finally {
    cleanup();
  }
});

test('a second sync with no changes reports everything unchanged', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.added, []);
    assert.deepEqual(report.updated, []);
    assert.deepEqual(report.skipped, []);
    assert.equal(report.unchanged.length, 3);
  } finally {
    cleanup();
  }
});

test('a changed source file updates an installed file the user did not touch', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    writeFileSync(join(source, 'alpha', 'SKILL.md'), 'alpha v2');
    const report = syncSkills(source, target, { kitVersion: '0.4.1' });
    assert.deepEqual(report.updated, ['alpha/SKILL.md']);
    assert.equal(readFileSync(join(target, 'alpha', 'SKILL.md'), 'utf8'), 'alpha v2');
    assert.equal(readManifest(target).kitVersion, '0.4.1');
  } finally {
    cleanup();
  }
});

test('a locally edited installed file is kept and reported, and --force overwrites it', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    writeFileSync(join(target, 'alpha', 'SKILL.md'), 'my local edit');
    writeFileSync(join(source, 'alpha', 'SKILL.md'), 'alpha v2');
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.skipped, [{ path: 'alpha/SKILL.md', reason: 'modified locally since the last install' }]);
    assert.equal(readFileSync(join(target, 'alpha', 'SKILL.md'), 'utf8'), 'my local edit');
    const again = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.equal(again.skipped.length, 1, 'the edit is still detected on the next run');
    const forced = syncSkills(source, target, { kitVersion: '0.4.0', force: true });
    assert.deepEqual(forced.updated, ['alpha/SKILL.md']);
    assert.equal(readFileSync(join(target, 'alpha', 'SKILL.md'), 'utf8'), 'alpha v2');
  } finally {
    cleanup();
  }
});

test('an unmanaged skill dir with the same name is skipped whole, and unrelated user skills are never touched', () => {
  const { source, target, cleanup } = setup();
  try {
    mkdirSync(join(target, 'beta'), { recursive: true });
    writeFileSync(join(target, 'beta', 'SKILL.md'), "the user's own beta");
    mkdirSync(join(target, 'my-skill'));
    writeFileSync(join(target, 'my-skill', 'SKILL.md'), 'mine');
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.skipped, [{ path: 'beta', reason: 'exists and is not managed by frontend-agent-kit (remove or rename it to install the kit version)' }]);
    assert.equal(readFileSync(join(target, 'beta', 'SKILL.md'), 'utf8'), "the user's own beta");
    assert.equal(readFileSync(join(target, 'my-skill', 'SKILL.md'), 'utf8'), 'mine');
    assert.deepEqual(Object.keys(readManifest(target).skills), ['alpha']);
  } finally {
    cleanup();
  }
});

test('files and skills removed from the source are removed from the target when unmodified', () => {
  const { source, target, cleanup } = setup();
  try {
    syncSkills(source, target, { kitVersion: '0.4.0' });
    rmSync(join(source, 'alpha', 'references'), { recursive: true });
    rmSync(join(source, 'beta'), { recursive: true });
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.removed.sort(), ['alpha/references/react.md', 'beta/SKILL.md']);
    assert.equal(existsSync(join(target, 'alpha', 'references')), false);
    assert.equal(existsSync(join(target, 'beta')), false);
    assert.deepEqual(Object.keys(readManifest(target).skills), ['alpha']);
  } finally {
    cleanup();
  }
});

test('an unreadable manifest is an error naming the file', () => {
  const { source, target, cleanup } = setup();
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, MANIFEST_FILE), '{ not json');
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0' }), /\.frontend-agent-kit-manifest\.json/);
  } finally {
    cleanup();
  }
});

test('a symlinked managed skill dir pointing outside the target is not written into or deleted from, with or without force, and is reported as skipped', () => {
  const { source, target, cleanup } = setup();
  try {
    // First sync to create managed 'alpha'
    syncSkills(source, target, { kitVersion: '0.4.0' });

    // Replace alpha with a symlink pointing outside target
    const alphaPath = join(target, 'alpha');
    rmSync(alphaPath, { recursive: true });
    const externalDir = join(target, '..', 'external-alpha');
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(join(externalDir, 'SKILL.md'), 'external content');
    try {
      symlinkSync(externalDir, alphaPath);
    } catch (e) {
      // Skip if symlink creation fails
      return;
    }

    // Verify it's a symlink
    if (!lstatSync(alphaPath).isSymbolicLink()) return;

    // Try to sync again - should skip symlinked dir
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.ok(report.skipped.some(s => s.path === 'alpha' && s.reason === 'is a symbolic link; not followed'));
    assert.equal(readFileSync(join(externalDir, 'SKILL.md'), 'utf8'), 'external content', 'external content unchanged');

    // Try with --force - should still skip
    const forced = syncSkills(source, target, { kitVersion: '0.4.0', force: true });
    assert.ok(forced.skipped.some(s => s.path === 'alpha' && s.reason === 'is a symbolic link; not followed'));
    assert.equal(readFileSync(join(externalDir, 'SKILL.md'), 'utf8'), 'external content', 'external content still unchanged');
  } finally {
    cleanup();
  }
});

test('a symlinked file inside a managed skill is not overwritten or deleted', () => {
  const { source, target, cleanup } = setup();
  try {
    // First sync
    syncSkills(source, target, { kitVersion: '0.4.0' });

    // Replace a file with a symlink
    const reactPath = join(target, 'alpha', 'references', 'react.md');
    rmSync(reactPath);
    const externalFile = join(target, '..', 'external-react.md');
    writeFileSync(externalFile, 'external react');
    try {
      symlinkSync(externalFile, reactPath);
    } catch (e) {
      // Skip if symlink creation fails
      return;
    }

    if (!lstatSync(reactPath).isSymbolicLink()) return;

    // Sync with source file changed
    writeFileSync(join(source, 'alpha', 'references', 'react.md'), 'react v2');
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.ok(report.skipped.some(s => s.path === 'alpha/references/react.md' && s.reason === 'is a symbolic link; not followed'));
    assert.equal(readFileSync(externalFile, 'utf8'), 'external react', 'external file unchanged');
  } finally {
    cleanup();
  }
});

test('a symlinked subdirectory (alpha/references → outside) is not written into or deleted from, with or without force', () => {
  const { source, target, cleanup } = setup();
  try {
    // First sync
    syncSkills(source, target, { kitVersion: '0.4.0' });

    // Replace references/ subdirectory with a symlink
    const referencesPath = join(target, 'alpha', 'references');
    rmSync(referencesPath, { recursive: true });
    const externalReferencesDir = join(target, '..', 'external-references');
    mkdirSync(externalReferencesDir, { recursive: true });
    writeFileSync(join(externalReferencesDir, 'react.md'), 'external react');
    try {
      symlinkSync(externalReferencesDir, referencesPath);
    } catch (e) {
      // Skip if symlink creation fails
      return;
    }

    if (!lstatSync(referencesPath).isSymbolicLink()) return;

    // Sync with source file changed - should skip the symlinked subdir
    writeFileSync(join(source, 'alpha', 'references', 'react.md'), 'react v2');
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.ok(report.skipped.some(s => s.path === 'alpha/references/react.md' && s.reason === 'is a symbolic link; not followed'), 'update skipped');
    assert.equal(readFileSync(join(externalReferencesDir, 'react.md'), 'utf8'), 'external react', 'external file unchanged after update attempt');

    // Remove the source file
    rmSync(join(source, 'alpha', 'references'), { recursive: true });
    const report2 = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.ok(report2.skipped.some(s => s.path === 'alpha/references/react.md' && s.reason === 'is a symbolic link; not followed'), 'delete skipped');
    assert.equal(readFileSync(join(externalReferencesDir, 'react.md'), 'utf8'), 'external react', 'external file unchanged after delete attempt');

    // Try with --force - should still skip
    const forced = syncSkills(source, target, { kitVersion: '0.4.0', force: true });
    assert.ok(forced.skipped.some(s => s.path === 'alpha/references/react.md' && s.reason === 'is a symbolic link; not followed'), '--force still skips symlink');
    assert.equal(readFileSync(join(externalReferencesDir, 'react.md'), 'utf8'), 'external react', 'external file unchanged with --force');
  } finally {
    cleanup();
  }
});

test('an unmanaged dir whose files are identical to the source (simulated interrupted install) is adopted', () => {
  const { source, target, cleanup } = setup();
  try {
    // Create target alpha with only SKILL.md (simulating interrupted install, missing references/react.md)
    const alphaTarget = join(target, 'alpha');
    mkdirSync(alphaTarget, { recursive: true });
    writeFileSync(join(alphaTarget, 'SKILL.md'), 'alpha v1');
    // Do not create references/react.md and do not create manifest, so it looks unmanaged but partial

    // Sync should adopt it (SKILL.md identical, missing files are allowed)
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.added.sort(), ['alpha/references/react.md', 'beta/SKILL.md']);
    assert.deepEqual(report.unchanged, ['alpha/SKILL.md']);
    assert.deepEqual(report.skipped, []);

    // Manifest now includes alpha with all files
    const manifest = readManifest(target);
    assert.ok(manifest.skills['alpha']);
    assert.ok(manifest.skills['alpha']['references/react.md']);
  } finally {
    cleanup();
  }
});

test('force: true on a non-identical unmanaged dir still skips it and leaves the user\'s files untouched', () => {
  const { source, target, cleanup } = setup();
  try {
    // Create unmanaged beta with different content
    mkdirSync(join(target, 'beta'), { recursive: true });
    writeFileSync(join(target, 'beta', 'SKILL.md'), "user's different content");

    // Sync with --force should NOT override
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.ok(report.skipped.some(s => s.path === 'beta' && s.reason.includes('exists and is not managed')));
    assert.equal(readFileSync(join(target, 'beta', 'SKILL.md'), 'utf8'), "user's different content");

    // Even with --force
    const forced = syncSkills(source, target, { kitVersion: '0.4.0', force: true });
    assert.ok(forced.skipped.some(s => s.path === 'beta' && s.reason.includes('exists and is not managed')));
    assert.equal(readFileSync(join(target, 'beta', 'SKILL.md'), 'utf8'), "user's different content");
  } finally {
    cleanup();
  }
});

test('a manifest with a path-traversal skill name is refused before anything is touched, even with --force', () => {
  const { base, source, target, cleanup } = setup();
  try {
    mkdirSync(target, { recursive: true });
    const victimDir = join(base, 'project', '..', 'victim');
    mkdirSync(victimDir, { recursive: true });
    writeFileSync(join(victimDir, 'data.txt'), 'precious');
    writeFileSync(
      join(target, MANIFEST_FILE),
      JSON.stringify({
        kitVersion: '0.4.0',
        skills: { '../../../victim': { 'data.txt': 'a'.repeat(64) } }
      })
    );
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0' }), /corrupt or was tampered with/);
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0', force: true }), /corrupt or was tampered with/);
    assert.equal(readFileSync(join(victimDir, 'data.txt'), 'utf8'), 'precious');
  } finally {
    cleanup();
  }
});

test('a manifest with a path-traversal file key under a legit skill name is refused, even with --force', () => {
  const { base, source, target, cleanup } = setup();
  try {
    mkdirSync(target, { recursive: true });
    const victimFile = join(base, 'project', '.claude', 'victim.txt');
    writeFileSync(victimFile, 'precious');
    writeFileSync(
      join(target, MANIFEST_FILE),
      JSON.stringify({
        kitVersion: '0.4.0',
        skills: { 'figma-to-code': { '../../victim.txt': 'deadbeef'.repeat(8) } }
      })
    );
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0' }), /corrupt or was tampered with/);
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0', force: true }), /corrupt or was tampered with/);
    assert.equal(readFileSync(victimFile, 'utf8'), 'precious');
  } finally {
    cleanup();
  }
});

test('a manifest with a non-hex or wrong-length hash value is refused', () => {
  const { source, target, cleanup } = setup();
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, MANIFEST_FILE),
      JSON.stringify({ kitVersion: '0.4.0', skills: { alpha: { 'SKILL.md': 'not-a-hash' } } })
    );
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0' }), /corrupt or was tampered with/);
  } finally {
    cleanup();
  }
});

test('a symlinked manifest is refused for both read and write, and the outside file is unchanged', () => {
  const { base, source, target, cleanup } = setup();
  try {
    mkdirSync(target, { recursive: true });
    const outsideFile = join(base, 'outside-manifest.json');
    writeFileSync(outsideFile, JSON.stringify({ kitVersion: '0.4.0', skills: {} }));
    try {
      symlinkSync(outsideFile, join(target, MANIFEST_FILE));
    } catch (e) {
      return; // symlink creation unsupported here — skip
    }
    assert.throws(() => syncSkills(source, target, { kitVersion: '0.4.0' }), /is a symbolic link; refusing to read or write it/);
    assert.equal(readFileSync(outsideFile, 'utf8'), JSON.stringify({ kitVersion: '0.4.0', skills: {} }));
  } finally {
    cleanup();
  }
});

test('symlinkOnPath rejects a sibling directory that merely shares a string prefix with root (e.g. "<root>-evil")', () => {
  const { base, cleanup } = setup();
  try {
    const root = join(base, 'proot');
    mkdirSync(root, { recursive: true });
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    assert.throws(() => symlinkOnPath(root, join(sibling, 'file.txt')), /resolves outside/);
    // A genuinely nested path is fine and returns null when nothing is a symlink.
    assert.equal(symlinkOnPath(root, join(root, 'file.txt')), null);
  } finally {
    cleanup();
  }
});

test('an unmanaged dir with no SKILL.md (only other files) is not adopted', () => {
  const { source, target, cleanup } = setup();
  try {
    // Create unmanaged gamma with only other files, no SKILL.md
    mkdirSync(join(target, 'gamma'), { recursive: true });
    writeFileSync(join(target, 'gamma', 'README.md'), 'some readme');

    // Sync should not try to adopt it (no SKILL.md, and gamma not in source anyway)
    const report = syncSkills(source, target, { kitVersion: '0.4.0' });
    assert.deepEqual(report.added.sort(), ['alpha/SKILL.md', 'alpha/references/react.md', 'beta/SKILL.md']);
    assert.deepEqual(report.skipped, []);

    // gamma should still exist untouched
    assert.equal(readFileSync(join(target, 'gamma', 'README.md'), 'utf8'), 'some readme');
    assert.equal(Object.keys(readManifest(target).skills).length, 2, 'only alpha and beta in manifest');
  } finally {
    cleanup();
  }
});
