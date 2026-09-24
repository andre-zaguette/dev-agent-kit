import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Assertion, Scenario } from './schema.js';
import type { RunRecord, ToolCall } from './types.js';

/** Directories written by the kit install / hosts, never part of what the agent produced. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.claude', '.agents', '.codex', '.frontend-agent']);
const MAX_FILE_BYTES = 1_000_000;

export interface AssertionResult {
  assertion: Assertion;
  satisfied: boolean;
  detail: string;
}

export type Verdict = 'pass' | 'fail' | 'error';

export interface GradeResult {
  verdict: Verdict;
  expected: AssertionResult[];
  forbidden: AssertionResult[];
  error?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Minimal glob: "**" (any depth), "*" and "?" (within a segment), "{a,b}" (literal alternatives). */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) throw new Error(`unclosed "{" in glob "${glob}"`);
      re += `(?:${glob.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
      i = end;
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/** Regular files under `root` as "/"-separated relative paths. Symlinks are skipped, never followed. */
export function listWorkspaceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

function argsMatch(call: ToolCall, args: Record<string, string> | undefined): boolean {
  if (!args) return true;
  return Object.entries(args).every(([key, pattern]) => {
    const value = call.args[key];
    const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    return new RegExp(pattern).test(text);
  });
}

function evaluate(assertion: Assertion, record: RunRecord, workspaceDir: string, files: () => string[]): AssertionResult {
  switch (assertion.type) {
    case 'tool_called': {
      const hits = record.toolCalls.filter((call) => call.tool === assertion.tool && argsMatch(call, assertion.args));
      return { assertion, satisfied: hits.length > 0, detail: `${hits.length} matching call(s) of ${assertion.tool}` };
    }
    case 'output_matches': {
      const satisfied = new RegExp(assertion.pattern, assertion.flags).test(record.finalText);
      return { assertion, satisfied, detail: satisfied ? 'final answer matched' : 'final answer did not match' };
    }
    case 'file_matches': {
      const globRe = globToRegExp(assertion.glob);
      const pattern = new RegExp(assertion.pattern, assertion.flags);
      const candidates = files().filter((file) => globRe.test(file));
      const hit = candidates.find((file) => {
        const full = path.join(workspaceDir, file);
        return lstatSync(full).size <= MAX_FILE_BYTES && pattern.test(readFileSync(full, 'utf8'));
      });
      return {
        assertion,
        satisfied: hit !== undefined,
        detail: hit ? `matched in ${hit}` : `${candidates.length} file(s) matched the glob, none matched the pattern`
      };
    }
    case 'file_exists': {
      let satisfied = false;
      try {
        const stat = lstatSync(path.join(workspaceDir, assertion.path));
        satisfied = stat.isFile() || stat.isDirectory();
      } catch {
        satisfied = false;
      }
      return { assertion, satisfied, detail: satisfied ? `${assertion.path} exists` : `${assertion.path} does not exist (or is a symlink)` };
    }
  }
}

export function grade(scenario: Scenario, record: RunRecord, workspaceDir: string): GradeResult {
  let cached: string[] | undefined;
  const files = () => (cached ??= listWorkspaceFiles(workspaceDir));
  const expected = scenario.expected.map((a) => evaluate(a, record, workspaceDir, files));
  const forbidden = scenario.forbidden.map((a) => evaluate(a, record, workspaceDir, files));
  const hostError = record.timedOut
    ? `timed out after ${scenario.timeoutSec}s`
    : record.exitCode !== 0
      ? `host exited with code ${record.exitCode}${record.error ? ` (${record.error})` : ''}`
      : record.error;
  if (hostError) return { verdict: 'error', expected, forbidden, error: hostError };
  const ok = expected.every((r) => r.satisfied) && forbidden.every((r) => !r.satisfied);
  return { verdict: ok ? 'pass' : 'fail', expected, forbidden };
}
