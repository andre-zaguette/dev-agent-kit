#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VALID_STATUS_VALUES = ['baseline', 'draft-auto', 'reviewed'];

const REQUIRED_REF_SECTIONS = [
  '## Princípio',
  '## Quando aplicar',
  '## Quando não aplicar',
  '## Exemplo',
  '## Fonte'
];

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n+/, '');
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields, body };
}

function validateSkillFile(path) {
  const errors = [];
  const content = readFileSync(path, 'utf8');
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    errors.push(`${path}: missing frontmatter (must start with "---")`);
    return errors;
  }
  if (!parsed.fields.name) errors.push(`${path}: frontmatter missing "name"`);
  if (!parsed.fields.description) errors.push(`${path}: frontmatter missing "description"`);
  if (parsed.body.trim().length < 50) errors.push(`${path}: body too short (< 50 chars)`);
  return errors;
}

function validateReferenceFile(path) {
  const errors = [];
  const content = readFileSync(path, 'utf8');
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    errors.push(`${path}: missing frontmatter (must start with "---")`);
    return errors;
  }
  if (!parsed.fields.name) errors.push(`${path}: frontmatter missing "name"`);
  if (!parsed.fields.description) errors.push(`${path}: frontmatter missing "description"`);
  // Contract references (data shapes, protocols) are specifications, not guidance: they carry
  // no baseline/draft-auto/reviewed status and none of the guidance sections.
  if (parsed.fields.type === 'contract') return errors;
  if (!parsed.fields.status) {
    errors.push(`${path}: frontmatter missing "status"`);
  } else if (!VALID_STATUS_VALUES.includes(parsed.fields.status)) {
    errors.push(`${path}: frontmatter "status" must be one of baseline|draft-auto|reviewed (got "${parsed.fields.status}")`);
  }
  for (const section of REQUIRED_REF_SECTIONS) {
    if (!parsed.body.includes(section)) errors.push(`${path}: missing section "${section}"`);
  }
  return errors;
}

function findSkillDirs(root) {
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}

function main() {
  const skillsRoot = process.argv[2] ?? 'skills';
  let errors = [];
  for (const skillName of findSkillDirs(skillsRoot)) {
    const skillDir = join(skillsRoot, skillName);
    const skillFile = join(skillDir, 'SKILL.md');
    try {
      statSync(skillFile);
    } catch {
      errors.push(`${skillDir}: missing SKILL.md`);
      continue;
    }
    errors = errors.concat(validateSkillFile(skillFile));

    const refsDir = join(skillDir, 'references');
    try {
      const refFiles = readdirSync(refsDir).filter((f) => f.endsWith('.md'));
      for (const refFile of refFiles) {
        errors = errors.concat(validateReferenceFile(join(refsDir, refFile)));
      }
    } catch {
      // no references/ dir is fine — not all skills have one
    }
  }

  if (errors.length > 0) {
    console.error(`validate-skill: ${errors.length} problem(s) found:\n`);
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log('validate-skill: all skills valid.');
  process.exit(0);
}

main();
