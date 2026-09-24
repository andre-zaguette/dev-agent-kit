import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectPath } from '../src/paths.ts';

function withProjectRoot<T>(root: string, fn: () => T): T {
  const previous = process.env.FRONTEND_AGENT_PROJECT_ROOT;
  process.env.FRONTEND_AGENT_PROJECT_ROOT = root;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_AGENT_PROJECT_ROOT;
    else process.env.FRONTEND_AGENT_PROJECT_ROOT = previous;
  }
}

test('resolveProjectPath resolves a relative path to an absolute path inside the project root', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      assert.equal(
        resolveProjectPath('shots/a.png', { toolName: 't', label: 'outputPath', extension: '.png' }),
        join(root, 'shots', 'a.png')
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath rejects ../ escapes, absolute paths outside the root, and sibling-prefix directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      for (const bad of ['../escape.png', '/etc/evil.png', `${root}-evil/a.png`]) {
        assert.throws(
          () => resolveProjectPath(bad, { toolName: 'compare_screenshots', label: 'baselinePath' }),
          /compare_screenshots: baselinePath ".*" resolves outside the project root/
        );
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath accepts a file whose name merely starts with two dots', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      assert.equal(resolveProjectPath('..hidden.png', { toolName: 't', label: 'p' }), join(root, '..hidden.png'));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath rejects a symlink inside the root that points outside it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  const outside = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-outside-'));
  try {
    try {
      symlinkSync(outside, join(root, 'escape'));
    } catch {
      t.skip('symlink creation not supported on this platform');
      return;
    }
    withProjectRoot(root, () => {
      assert.throws(
        () => resolveProjectPath('escape/evil.png', { toolName: 'compare_screenshots', label: 'baselinePath' }),
        /compare_screenshots: baselinePath ".*" resolves outside the project root/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveProjectPath rejects a dangling symlink inside the root whose target is outside it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  const outside = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-outside-'));
  try {
    try {
      symlinkSync(join(outside, 'new.png'), join(root, 'dangling.png'));
    } catch {
      t.skip('symlink creation not supported on this platform');
      return;
    }
    withProjectRoot(root, () => {
      assert.throws(
        () => resolveProjectPath('dangling.png', { toolName: 'compare_screenshots', label: 'outputPath' }),
        /compare_screenshots: outputPath ".*" resolves outside the project root/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveProjectPath accepts a dangling symlink inside the root whose target is also inside it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    try {
      symlinkSync(join(root, 'out', 'new.png'), join(root, 'dangling-ok.png'));
    } catch {
      t.skip('symlink creation not supported on this platform');
      return;
    }
    withProjectRoot(root, () => {
      assert.equal(
        resolveProjectPath('dangling-ok.png', { toolName: 't', label: 'outputPath' }),
        join(root, 'dangling-ok.png')
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath rejects a chain of symlinks (link -> dangling link -> outside) (round 2)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  const outside = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-outside-'));
  try {
    mkdirSync(join(root, 'sub'));
    try {
      // root/link1.png -> sub/link2.png (a symlink, not yet a real file)
      symlinkSync(join('sub', 'link2.png'), join(root, 'link1.png'));
      // root/sub/link2.png -> ../../outside/new.png (escapes the root; new.png does not exist)
      symlinkSync(join('..', '..', 'outside', 'new.png'), join(root, 'sub', 'link2.png'));
    } catch {
      t.skip('symlink creation not supported on this platform');
      return;
    }
    withProjectRoot(root, () => {
      assert.throws(
        () => resolveProjectPath('link1.png', { toolName: 'compare_screenshots', label: 'outputPath' }),
        /compare_screenshots: outputPath ".*" resolves outside the project root/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveProjectPath rejects a self-referencing symlink with a "could not be resolved" error instead of hanging (round 2)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    try {
      symlinkSync('a', join(root, 'a'));
    } catch {
      t.skip('symlink creation not supported on this platform');
      return;
    }
    withProjectRoot(root, () => {
      assert.throws(
        () => resolveProjectPath('a', { toolName: 'compare_screenshots', label: 'outputPath' }),
        /compare_screenshots: outputPath "a" could not be resolved:/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveProjectPath enforces the extension case-insensitively when one is given', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-agent-paths-'));
  try {
    withProjectRoot(root, () => {
      assert.equal(resolveProjectPath('a.PNG', { toolName: 't', label: 'p', extension: '.png' }), join(root, 'a.PNG'));
      assert.throws(
        () => resolveProjectPath('a.jpg', { toolName: 't', label: 'outputPath', extension: '.png' }),
        /t: outputPath "a.jpg" must have a \.png extension/
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
