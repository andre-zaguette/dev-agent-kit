import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

test('every skill and reference in the kit passes scripts/validate-skill.mjs', () => {
  const result = spawnSync(process.execPath, [join(kit, 'scripts', 'validate-skill.mjs'), join(kit, 'skills')], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
