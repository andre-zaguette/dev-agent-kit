import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const kitRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface Guide {
  skill: string;
  name: string;
  /** Patterns that must appear: the current practice the guide has to teach. */
  must: RegExp[];
  /** Patterns that must not appear: deprecated or wrong practice presented as current. */
  mustNot: RegExp[];
}

/** One entry per deepened stack guide. Each guide task appends its entry together with the file. */
export const GUIDES: Guide[] = [
  {
    skill: 'backend-architecture',
    name: 'fastapi',
    must: [/lifespan/, /Annotated\[/, /response_model/, /dependency_overrides/, /model_config|from_attributes/, /async def/, /Targets: .*FastAPI/],
    mustNot: [/@app\.on_event/, /\borm_mode\b/, /@validator\(/, /\.dict\(\)/]
  },
  {
    skill: 'backend-architecture',
    name: 'nestjs',
    must: [/Test\.createTestingModule/, /ValidationPipe/, /whitelist/, /overrideProvider|overrideGuard/, /supertest/, /guards?.*interceptors?.*pipes?|middleware.*guards?/is, /Targets: .*NestJS/],
    mustNot: []
  }
];

const SECTIONS = ['Princípio', 'Quando aplicar', 'Quando não aplicar', 'Exemplo', 'Estrutura do projeto', 'Dados e estado', 'Erros e validação', 'Testes', 'Armadilhas', 'Fonte'];
const read = (guide: Guide): string => readFileSync(join(kitRoot, 'skills', guide.skill, 'references', `${guide.name}.md`), 'utf8');

test('GUIDES entries name real files', () => {
  for (const guide of GUIDES) assert.ok(existsSync(join(kitRoot, 'skills', guide.skill, 'references', `${guide.name}.md`)), `${guide.skill}/${guide.name}`);
});

for (const guide of GUIDES) {
  test(`${guide.skill}/${guide.name}: frontmatter is exact and marks the file a guide`, () => {
    assert.match(read(guide), new RegExp(`^---\\nname: ${guide.name}\\ndescription: .{20,300}\\nstatus: guide\\n---\\n`));
  });

  test(`${guide.skill}/${guide.name}: has the sections in order, a Targets line, 80-200 lines and balanced code fences`, () => {
    const text = read(guide);
    let at = -1;
    for (const section of SECTIONS) {
      const index = text.indexOf(`\n## ${section}\n`);
      assert.ok(index > at, `section "${section}" missing or out of order`);
      at = index;
    }
    assert.match(text, /^Targets: .{10,}$/m, 'a "Targets: <framework and major versions>" line');
    const lines = text.split('\n').length;
    assert.ok(lines >= 80 && lines <= 200, `${lines} lines; expected 80-200`);
    const fences = (text.match(/^```/gm) ?? []).length;
    assert.ok(fences >= 2 && fences % 2 === 0, `${fences} code fences`);
  });

  test(`${guide.skill}/${guide.name}: teaches the current practice and none of the known-stale ones`, () => {
    const text = read(guide);
    for (const pattern of guide.must) assert.match(text, pattern, `must mention ${pattern}`);
    for (const pattern of guide.mustNot) assert.doesNotMatch(text, pattern, `must not contain ${pattern}`);
  });

  test(`${guide.skill}/${guide.name}: says what not to assume about the project`, () => {
    assert.match(read(guide), /do not (assume|add|introduce)|if the project (does not|doesn't)|only if the project/i);
  });
}
