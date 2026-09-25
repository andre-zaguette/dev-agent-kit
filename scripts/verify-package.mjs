#!/usr/bin/env node
// Offline check of what `npm pack` would ship: required and forbidden files, manifest coherence, and a secret scan of the packed text files.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

register();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { checkImports, checkManifest, checkPackedFiles, checkSkillsPacked } = await import('../packages/cli/src/package-check.ts');
const { findLineSecret } = await import('../packages/core/src/diff-review.ts');

const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const files = JSON.parse(raw)[0].files.map((f) => f.path);
const problems = [...checkManifest(root), ...checkPackedFiles(files), ...checkImports(root, files), ...checkSkillsPacked(root, files)];

for (const file of files) {
  const full = path.join(root, file);
  if (statSync(full).size > 1024 * 1024) continue;
  const buffer = readFileSync(full);
  if (buffer.includes(0)) continue;
  for (const line of buffer.toString('utf8').split('\n')) {
    const label = findLineSecret(line);
    if (label) {
      problems.push(`possible secret (${label}) in ${file}`);
      break;
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`✘ ${p}`);
  process.exit(1);
}
console.log(`ok: ${files.length} files would be packed`);
