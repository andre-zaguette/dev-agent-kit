import { existsSync, readFileSync, writeFileSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { relative, sep, isAbsolute, dirname, basename, join, resolve } from 'node:path';

export const BLOCK_START = '<!-- frontend-agent-kit:start -->';
export const BLOCK_END = '<!-- frontend-agent-kit:end -->';

export type BlockAction = 'created' | 'appended' | 'replaced' | 'unchanged';

/**
 * Locate a managed block delimited by `start`/`end` lines.
 * Markers must be complete lines (ignoring leading/trailing whitespace and CRLF).
 * Markers inside fenced code blocks (``` or ~~~) are ignored.
 * Returns the span from the start marker through the end marker's trailing newline,
 * or null when neither marker is present outside fences.
 * Throws when unbalanced, reversed, or multiple blocks are found.
 */
export function findManagedBlock(
  text: string,
  start: string,
  end: string | string[],
  fileLabel: string
): { from: number; to: number } | null {
  const endVariants = Array.isArray(end) ? end : [end];
  // Parse lines while preserving line ending information
  const lines: Array<{ text: string; eol: string }> = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') {
      if (text[i + 1] === '\n') {
        lines.push({ text: current, eol: '\r\n' });
        current = '';
        i++;
      } else {
        lines.push({ text: current, eol: '\r' });
        current = '';
      }
    } else if (text[i] === '\n') {
      lines.push({ text: current, eol: '\n' });
      current = '';
    } else {
      current += text[i];
    }
  }
  if (current) {
    lines.push({ text: current, eol: '' });
  }

  let inFence = false;
  let fenceChar: string | null = null;
  let fenceOpenRun = 0;
  let fenceOpenLine = -1;
  let startLineIndex = -1;
  let endLineIndex = -1;
  let startCount = 0;
  let endCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    const trimmed = line.trim();

    if (!inFence) {
      // Opening fence: a run of 3+ backticks or tildes, optionally followed by an info string.
      const open = /^(`{3,}|~{3,})/.exec(trimmed);
      if (open) {
        inFence = true;
        fenceChar = open[1][0];
        fenceOpenRun = open[1].length;
        fenceOpenLine = i;
      }
    } else {
      // Closing fence (CommonMark): same character, run length >= the opening run, and
      // nothing else on the line (a closing fence cannot carry an info string).
      const closeRe = new RegExp(`^${fenceChar === '`' ? '`' : '~'}{${fenceOpenRun},}$`);
      if (closeRe.test(trimmed)) {
        inFence = false;
        fenceChar = null;
        fenceOpenRun = 0;
      }
    }

    // Check for markers only outside fences
    if (!inFence) {
      if (trimmed === start) {
        startCount++;
        if (startLineIndex === -1) startLineIndex = i;
      }
      if (endVariants.includes(trimmed)) {
        endCount++;
        if (endLineIndex === -1) endLineIndex = i;
      }
    }
  }

  // Check for unclosed fence at EOF (regardless of markers)
  // Must check this BEFORE returning null, since markers inside the fence won't be counted
  if (inFence && fenceOpenLine >= 0) {
    throw new Error(
      `frontend-agent: ${fileLabel} ends inside an unclosed code fence (opened at line ${fenceOpenLine + 1}); close the fence and re-run.`
    );
  }

  // No markers found outside fences
  if (startCount === 0 && endCount === 0) {
    return null;
  }

  // Multiple blocks
  if (startCount > 1 || endCount > 1) {
    throw new Error(
      `frontend-agent: ${fileLabel} contains more than one frontend-agent-kit block; keep one and re-run.`
    );
  }

  // Unbalanced or reversed
  if (startCount === 0 || endCount === 0 || endLineIndex < startLineIndex) {
    throw new Error(
      `frontend-agent: ${fileLabel} has unbalanced frontend-agent-kit markers ("${start}" / "${endVariants[0]}"); fix or remove them and re-run.`
    );
  }

  // Calculate byte offsets
  let from = 0;
  for (let i = 0; i < startLineIndex; i++) {
    from += lines[i].text.length + lines[i].eol.length;
  }

  let to = from;
  for (let i = startLineIndex; i <= endLineIndex; i++) {
    to += lines[i].text.length + lines[i].eol.length;
  }

  return { from, to };
}

/**
 * Validate that the file path resolves inside the root directory.
 * Rejects symlinks resolving outside the root and dangling links, except a dangling link to a
 * missing plain file inside the root (writing creates it). In-project symlinks (e.g.,
 * CLAUDE.md → AGENTS.md) are allowed.
 */
export function assertInsideRoot(filePath: string, rootDir: string): void {
  let realPath: string = '';
  let realRoot: string;

  try {
    realRoot = realpathSync(rootDir);
  } catch {
    throw new Error(`frontend-agent: invalid root directory ${rootDir}`);
  }

  // Check if the file/symlink exists and what type it is
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (err) {
    if ((err as any)?.code === 'ENOENT') {
      // File doesn't exist and isn't a symlink — construct the real path from the parent
      const dir = dirname(filePath);
      try {
        const realDir = realpathSync(dir);
        realPath = join(realDir, basename(filePath));
      } catch {
        throw new Error(
          `frontend-agent: ${filePath} resolves outside the project root; refusing to write through it.`
        );
      }
    } else {
      throw new Error(
        `frontend-agent: ${filePath} resolves outside the project root; refusing to write through it.`
      );
    }
  }

  // If it's a symlink, validate the target
  if (stat && stat.isSymbolicLink()) {
    const linkTarget = readlinkSync(filePath);
    const resolvedTarget = resolve(dirname(filePath), linkTarget);
    try {
      realPath = realpathSync(resolvedTarget);
    } catch (err) {
      if ((err as any)?.code !== 'ENOENT') throw err;
      // Dangling link. Writing through it creates the target — acceptable only when the target is
      // a plain missing file (not another link) whose directory already exists inside the root,
      // e.g. AGENTS.md → CLAUDE.md before CLAUDE.md exists.
      let targetIsLink = false;
      try {
        targetIsLink = lstatSync(resolvedTarget).isSymbolicLink();
      } catch {
        // target missing — expected for a dangling link
      }
      let realDir: string | null = null;
      if (!targetIsLink) {
        try {
          realDir = realpathSync(dirname(resolvedTarget));
        } catch {
          realDir = null;
        }
      }
      const relDir = realDir === null ? null : relative(realRoot, realDir);
      if (relDir === null || relDir === '..' || relDir.startsWith('..' + sep) || isAbsolute(relDir)) {
        throw new Error(
          `frontend-agent: ${filePath} is a dangling symbolic link to ${resolvedTarget}; refusing to write through it.`
        );
      }
      realPath = join(realDir as string, basename(resolvedTarget));
    }
  } else if (stat) {
    // Regular existing file, resolve its real path
    try {
      realPath = realpathSync(filePath);
    } catch {
      throw new Error(
        `frontend-agent: ${filePath} resolves outside the project root; refusing to write through it.`
      );
    }
  }

  // Check if realPath is inside realRoot
  const rel = relative(realRoot, realPath);
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    throw new Error(
      `frontend-agent: ${filePath} resolves outside the project root (${realPath}); refusing to write through it.`
    );
  }
}

export function upsertMarkdownBlock(filePath: string, content: string, rootDir: string): BlockAction {
  // Validate symlink safety
  assertInsideRoot(filePath, rootDir);

  // Detect line endings in existing file
  const detectLineEnding = (text: string): string => {
    return text.includes('\r\n') ? '\r\n' : '\n';
  };

  const eol = existsSync(filePath) ? detectLineEnding(readFileSync(filePath, 'utf8')) : '\n';
  const block = `${BLOCK_START}${eol}${content.trim()}${eol}${BLOCK_END}${eol}`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, block);
    return 'created';
  }

  const text = readFileSync(filePath, 'utf8');
  const span = findManagedBlock(text, BLOCK_START, BLOCK_END, filePath);

  if (span) {
    const next = text.slice(0, span.from) + block + text.slice(span.to);
    if (next === text) return 'unchanged';
    writeFileSync(filePath, next);
    return 'replaced';
  }

  const head = text.trimEnd();
  const appendSep = head ? `${eol}${eol}` : '';
  writeFileSync(filePath, head ? `${head}${appendSep}${block}` : block);
  return 'appended';
}

/**
 * Preflight check for a markdown instructions file: validate that it resolves inside the
 * project root, and — if it already exists — that its managed block (if any) parses cleanly.
 * Throws instead of writing anything; used to fail closed before any install step runs.
 */
export function preflightMarkdownFile(filePath: string, rootDir: string): void {
  assertInsideRoot(filePath, rootDir);
  if (existsSync(filePath)) {
    findManagedBlock(readFileSync(filePath, 'utf8'), BLOCK_START, BLOCK_END, filePath);
  }
}

export function hasMarkdownBlock(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return findManagedBlock(readFileSync(filePath, 'utf8'), BLOCK_START, BLOCK_END, filePath) !== null;
  } catch {
    return false;
  }
}

/**
 * Like hasMarkdownBlock, but surfaces a parse error (e.g. an unclosed fence, unbalanced or
 * duplicate markers) instead of swallowing it into `present: false`, so callers can tell "no
 * block yet — run install" apart from "the file is malformed — fix it".
 */
export function inspectMarkdownBlock(filePath: string): { present: boolean; error?: string } {
  if (!existsSync(filePath)) return { present: false };
  try {
    return { present: findManagedBlock(readFileSync(filePath, 'utf8'), BLOCK_START, BLOCK_END, filePath) !== null };
  } catch (error) {
    return { present: false, error: (error as Error).message };
  }
}
