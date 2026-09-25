import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DEV_HELP } from '../src/dev-cli.ts';
import { findKitRoot } from '../src/util.ts';

const root = findKitRoot();
const docFiles = [
  'README.md',
  ...readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  ...readdirSync(path.join(root, 'docs', 'release-notes')).map((f) => `docs/release-notes/${f}`)
];
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

/** The command words of a `dev-agent …` invocation: the words before the first flag, placeholder or non-word token. */
function commandWords(line: string): string[] {
  const rest = line.replace(/^\s*(?:\$\s*)?(?:npx\s+)?dev-agent\s+/, '');
  const words: string[] = [];
  for (const token of rest.split(/\s+/)) {
    if (!/^[a-z][a-z-]*$/.test(token)) break;
    words.push(token);
  }
  return words;
}

const helpCommands = DEV_HELP.split('\n')
  .filter((l) => /^\s+dev-agent\s+[a-z]/.test(l))
  .map(commandWords);

function fencedLines(text: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inside = !inside;
    else if (inside) lines.push(line);
  }
  return lines;
}

test('every dev-agent command shown in the docs exists in --help', () => {
  const problems: string[] = [];
  for (const file of docFiles) {
    for (const line of fencedLines(read(file))) {
      if (!/^\s*(?:\$\s*)?(?:npx\s+)?dev-agent\s+[a-z]/.test(line)) continue;
      const words = commandWords(line);
      const known = helpCommands.some((cmd) => cmd.every((w, i) => words[i] === w));
      if (!known) problems.push(`${file}: "${line.trim()}"`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every relative link in the docs resolves to a file', () => {
  const problems: string[] = [];
  for (const file of docFiles) {
    const text = read(file).replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (target === '' || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(path.resolve(root, path.dirname(file), target))) problems.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the README has the sections a new user needs and states the benchmark status honestly', () => {
  const text = read('README.md');
  for (const heading of ['## Install', '## Quick start', '## What is in the box', '## Task sources', '## Compatibility', '## Benchmarks', '## Version history']) {
    assert.ok(text.includes(`\n${heading}\n`), `README needs "${heading}"`);
  }
  const benchmarks = text.slice(text.indexOf('\n## Benchmarks\n'));
  assert.match(benchmarks, /not yet run/i);
  assert.match(benchmarks, /npm run bench/);
  assert.match(text, /docs\/migration-from-frontend-agent\.md/);
  assert.match(text, /docs\/generic-mcp\.md/);
  assert.match(text, /docs\/task-source-adapters\.md/);
});

test('the guides exist and cover their essentials', () => {
  const adapters = read('docs/task-source-adapters.md');
  for (const needle of ['TaskSourceAdapter', 'WorkItem', 'TaskSourceRegistry', 'normalizeWorkItem', 'generic-mcp', 'capabilities']) assert.ok(adapters.includes(needle), `adapter guide needs ${needle}`);
  const mcp = read('docs/generic-mcp.md');
  for (const needle of ['identifiers', 'mapping', 'default', 'sources verify', 'task resolve']) assert.ok(mcp.includes(needle), `generic-mcp guide needs ${needle}`);
  const migration = read('docs/migration-from-frontend-agent.md');
  for (const needle of ['frontend-agent install', 'dev-agent install', '.frontend-agent/config.yml', '.dev-agent/config.yml', 'no removal date']) assert.ok(migration.includes(needle), `migration guide needs ${needle}`);
});
