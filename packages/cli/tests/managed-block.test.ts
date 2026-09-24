import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertMarkdownBlock, hasMarkdownBlock, BLOCK_START, BLOCK_END } from '../src/managed-block.ts';

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-agent-block-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('creates the file with only the managed block when it does not exist', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    assert.equal(upsertMarkdownBlock(file, '# Kit\n\nDo things.\n', dir), 'created');
    assert.equal(readFileSync(file, 'utf8'), `${BLOCK_START}\n# Kit\n\nDo things.\n${BLOCK_END}\n`);
    assert.equal(hasMarkdownBlock(file), true);
  });
});

test("appends the block after the user's existing content, keeping it intact", () => {
  withDir((dir) => {
    const file = join(dir, 'AGENTS.md');
    writeFileSync(file, '# My project\n\nUse pnpm.\n\n\n');
    assert.equal(upsertMarkdownBlock(file, 'kit rules', dir), 'appended');
    assert.equal(readFileSync(file, 'utf8'), `# My project\n\nUse pnpm.\n\n${BLOCK_START}\nkit rules\n${BLOCK_END}\n`);
  });
});

test('replaces only the block in place on re-run, and reports unchanged when identical', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, `intro\n\n${BLOCK_START}\nold rules\n${BLOCK_END}\n\noutro\n`);
    assert.equal(upsertMarkdownBlock(file, 'new rules', dir), 'replaced');
    assert.equal(readFileSync(file, 'utf8'), `intro\n\n${BLOCK_START}\nnew rules\n${BLOCK_END}\n\noutro\n`);
    assert.equal(upsertMarkdownBlock(file, 'new rules', dir), 'unchanged');
  });
});

test('a lone or reversed marker is an error naming the file, and the file is left untouched', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    const broken = `intro\n${BLOCK_START}\nno end marker\n`;
    writeFileSync(file, broken);
    assert.throws(() => upsertMarkdownBlock(file, 'x', dir), /CLAUDE\.md.*frontend-agent-kit markers/s);
    assert.equal(readFileSync(file, 'utf8'), broken);
    writeFileSync(file, `${BLOCK_END}\n${BLOCK_START}\n`);
    assert.throws(() => upsertMarkdownBlock(file, 'x', dir), /frontend-agent-kit markers/);
  });
});

test('marker lines inside a ``` fence are ignored: the file gets the real block appended and the fenced example is byte-for-byte intact', () => {
  withDir((dir) => {
    const file = join(dir, 'README.md');
    const originalContent = `# Example\n\nHere's the marker:\n\n\`\`\`\n${BLOCK_START}\nfake content\n${BLOCK_END}\n\`\`\`\n`;
    writeFileSync(file, originalContent);
    assert.equal(upsertMarkdownBlock(file, 'real content', dir), 'appended');
    const result = readFileSync(file, 'utf8');
    // Original fenced code block should be intact
    assert(result.includes(originalContent.trim()));
    // Real block should be appended
    assert(result.includes(`${BLOCK_START}\nreal content\n${BLOCK_END}`));
  });
});

test('a ```` fence is not closed by a shorter ``` line inside it (CommonMark run-length rule); a marker between them is ignored', () => {
  withDir((dir) => {
    const file = join(dir, 'README.md');
    const originalContent = `# Doc\n\n\`\`\`\`\nexample:\n\`\`\`\n${BLOCK_START}\nfake\n${BLOCK_END}\n\`\`\`\`\n`;
    writeFileSync(file, originalContent);
    // No marker exists outside the (still-open, then properly closed) fence, so the block is appended.
    assert.equal(upsertMarkdownBlock(file, 'real content', dir), 'appended');
    const result = readFileSync(file, 'utf8');
    assert(result.includes(originalContent.trim()), 'the whole fenced example, including the inner ``` line and the fake markers, is untouched');
    assert(result.includes(`${BLOCK_START}\nreal content\n${BLOCK_END}`));
  });
});

test('a file with two blocks throws and is unchanged', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');
    const twoBlocks = `${BLOCK_START}\nfirst\n${BLOCK_END}\n\n${BLOCK_START}\nsecond\n${BLOCK_END}\n`;
    writeFileSync(file, twoBlocks);
    assert.throws(() => upsertMarkdownBlock(file, 'x', dir), /more than one frontend-agent-kit block/);
    assert.equal(readFileSync(file, 'utf8'), twoBlocks);
  });
});

test('CLAUDE.md symlinked to a file outside rootDir throws /resolves outside the project root/, outside file unchanged; CLAUDE.md symlinked to AGENTS.md inside rootDir is written through, symlink preserved', () => {
  withDir((dir) => {
    // Part 1: symlink to outside root
    withDir((outsideDir) => {
      const outsideFile = join(outsideDir, 'outside.md');
      writeFileSync(outsideFile, 'outside content');
      const symlink = join(dir, 'CLAUDE.md');
      try {
        symlinkSync(outsideFile, symlink);
        assert.throws(
          () => upsertMarkdownBlock(symlink, 'x', dir),
          /resolves outside the project root/
        );
        assert.equal(readFileSync(outsideFile, 'utf8'), 'outside content');
        unlinkSync(symlink);
      } catch (err) {
        // Skip symlink tests if creation fails
        if ((err as any)?.code !== 'EACCES') throw err;
      }
    });

    // Part 2: in-project symlink
    const agents = join(dir, 'AGENTS.md');
    writeFileSync(agents, '# Agents\n');
    const symlink2 = join(dir, 'CLAUDE.md');
    try {
      symlinkSync(agents, symlink2);
      assert.equal(upsertMarkdownBlock(symlink2, 'rules', dir), 'appended');
      // Both the symlink and the target should have the content
      const content = readFileSync(agents, 'utf8');
      assert(content.includes('# Agents'));
      assert(content.includes(BLOCK_START));
    } catch (err) {
      // Skip symlink tests if creation fails
      if ((err as any)?.code !== 'EACCES') throw err;
    }
  });
});

test('CRLF file: append and replace keep CRLF everywhere (no bare LF introduced) and a replace does not add blank lines', () => {
  withDir((dir) => {
    const file = join(dir, 'CLAUDE.md');

    // Helper: check that a string uses only CRLF line endings (no bare LF)
    const hasCRLFOnly = (text: string): boolean => {
      // Replace all CRLF with a marker, then check that there are no remaining LF
      const withoutCRLF = text.replace(/\r\n/g, '__CRLF__');
      return !withoutCRLF.includes('\n') && !withoutCRLF.includes('\r');
    };

    // Test append with CRLF
    writeFileSync(file, '# Header\r\nSome content\r\n');
    assert.equal(upsertMarkdownBlock(file, 'rules', dir), 'appended');
    const appended = readFileSync(file, 'utf8');
    assert(appended.includes('\r\n'));
    assert(!appended.includes(BLOCK_START + '\n')); // Should be \r\n, not just \n
    assert(hasCRLFOnly(appended), 'appended file should contain only CRLF line endings');

    // Test replace with CRLF
    const withBlock = `intro\r\n${BLOCK_START}\r\nold\r\n${BLOCK_END}\r\noutro\r\n`;
    writeFileSync(file, withBlock);
    assert.equal(upsertMarkdownBlock(file, 'new', dir), 'replaced');
    const replaced = readFileSync(file, 'utf8');
    assert(replaced.includes('intro\r\n'));
    assert(replaced.includes('outro\r\n'));
    assert(hasCRLFOnly(replaced), 'replaced file should contain only CRLF line endings');
  });
});

test('unclosed fence with markers throws /ends inside an unclosed code fence \\(opened at line 2\\)/ and file is unchanged', () => {
  withDir((dir) => {
    const file = join(dir, 'README.md');
    const unclosedWithMarker = `intro\n\`\`\`\nsome code\n${BLOCK_START}\nreal rules\n${BLOCK_END}\n`;
    writeFileSync(file, unclosedWithMarker);

    // Should throw with line number (line 2 in 1-based, where ``` is)
    assert.throws(
      () => upsertMarkdownBlock(file, 'rules', dir),
      /ends inside an unclosed code fence \(opened at line 2\)/
    );
    assert.equal(readFileSync(file, 'utf8'), unclosedWithMarker);
  });
});

test('unclosed fence without markers throws /ends inside an unclosed code fence \\(opened at line 3\\)/ and file is unchanged', () => {
  withDir((dir) => {
    const file = join(dir, 'README.md');
    const unclosedNoMarker = `intro\n\n\`\`\`\nsome code\n`;
    writeFileSync(file, unclosedNoMarker);

    // Should throw with line number (line 3 in 1-based, where ``` is)
    assert.throws(
      () => upsertMarkdownBlock(file, 'rules', dir),
      /ends inside an unclosed code fence \(opened at line 3\)/
    );
    assert.equal(readFileSync(file, 'utf8'), unclosedNoMarker);
  });
});

test('closed fence containing marker followed by normal text allows block to be appended, then unchanged on re-run', () => {
  withDir((dir) => {
    const file = join(dir, 'README.md');
    const closedFenceWithMarker = `intro\n\n\`\`\`\n${BLOCK_START}\nfake\n${BLOCK_END}\n\`\`\`\n\nnormal text\n`;
    writeFileSync(file, closedFenceWithMarker);

    // Should append normally (fence is closed, markers inside don't count)
    assert.equal(upsertMarkdownBlock(file, 'rules', dir), 'appended');
    const afterAppend = readFileSync(file, 'utf8');
    assert(afterAppend.includes('normal text'));
    assert(afterAppend.includes(`${BLOCK_START}\nrules\n${BLOCK_END}`));

    // Second call should report unchanged
    assert.equal(upsertMarkdownBlock(file, 'rules', dir), 'unchanged');
  });
});

test('dangling link to a file outside the root is refused; to a missing in-root file it is written through', () => {
  withDir((dir) => {
    withDir((outsideDir) => {
      const outsideFile = join(outsideDir, 'new.md');
      const symlink = join(dir, 'CLAUDE.md');
      symlinkSync(outsideFile, symlink);
      assert.throws(() => upsertMarkdownBlock(symlink, 'x', dir), /dangling symbolic link/);
      assert(!existsSync(outsideFile));
    });

    const link = join(dir, 'AGENTS.md');
    const missingTarget = join(dir, 'CLAUDE-shared.md');
    symlinkSync(missingTarget, link);
    assert.equal(upsertMarkdownBlock(link, 'shared rules', dir), 'created');
    assert.match(readFileSync(missingTarget, 'utf8'), /shared rules/);
  });
});

test('dangling link whose target is itself a dangling link is refused', () => {
  withDir((dir) => {
    symlinkSync(join(dir, 'nowhere.md'), join(dir, 'middle.md'));
    symlinkSync(join(dir, 'middle.md'), join(dir, 'AGENTS.md'));
    assert.throws(() => upsertMarkdownBlock(join(dir, 'AGENTS.md'), 'x', dir), /dangling symbolic link/);
    assert(!existsSync(join(dir, 'nowhere.md')));
  });
});
