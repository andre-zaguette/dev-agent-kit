import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ZodError } from 'zod';
import { FigmaFixtureSchema, ScenarioSchema, type FigmaFixture, type Scenario } from './schema.js';

export interface EvalsLayout {
  evalsDir: string;
  scenariosDir: string;
  fixturesDir: string;
  figmaDir: string;
}

export function evalsLayout(evalsDir: string): EvalsLayout {
  return {
    evalsDir,
    scenariosDir: path.join(evalsDir, 'scenarios'),
    fixturesDir: path.join(evalsDir, 'fixtures'),
    figmaDir: path.join(evalsDir, 'figma')
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.basename(file)}: invalid JSON: ${(error as Error).message}`);
  }
}

function formatZod(file: string, error: ZodError): string {
  return error.issues.map((issue) => `${path.basename(file)}: ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n- ');
}

export function loadFigmaFixture(file: string): FigmaFixture {
  const parsed = FigmaFixtureSchema.safeParse(readJson(file));
  if (!parsed.success) throw new Error(formatZod(file, parsed.error));
  const dir = path.dirname(file);
  for (const [id, node] of Object.entries(parsed.data.nodes)) {
    const refs = [node.screenshot, ...Object.values(node.assets ?? {})].filter((ref): ref is string => !!ref);
    for (const ref of refs) {
      if (!existsSync(path.join(dir, ref))) {
        throw new Error(`${path.basename(file)}: node ${id}: ${ref} does not exist`);
      }
    }
  }
  return parsed.data;
}

export function loadScenarios(layout: EvalsLayout): Scenario[] {
  const errors: string[] = [];
  const scenarios: Scenario[] = [];
  const seen = new Set<string>();
  const figmaOk = new Map<string, boolean>();
  const files = readdirSync(layout.scenariosDir).filter((name) => name.endsWith('.json')).sort();

  for (const name of files) {
    const file = path.join(layout.scenariosDir, name);
    let raw: unknown;
    try {
      raw = readJson(file);
    } catch (error) {
      errors.push((error as Error).message);
      continue;
    }
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(formatZod(file, parsed.error));
      continue;
    }
    const scenario = parsed.data;
    if (scenario.id !== name.replace(/\.json$/, '')) errors.push(`${name}: id "${scenario.id}" must match the file name`);
    if (seen.has(scenario.id)) errors.push(`${name}: duplicate id "${scenario.id}"`);
    seen.add(scenario.id);
    const fixtureDir = path.join(layout.fixturesDir, scenario.fixture);
    if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
      errors.push(`${name}: fixture "${scenario.fixture}" not found in ${layout.fixturesDir}`);
    }
    if (scenario.figma !== undefined) {
      const figmaFile = path.join(layout.figmaDir, `${scenario.figma}.json`);
      if (!existsSync(figmaFile)) {
        errors.push(`${name}: figma "${scenario.figma}" not found in ${layout.figmaDir}`);
      } else if (!figmaOk.has(scenario.figma)) {
        try {
          loadFigmaFixture(figmaFile);
          figmaOk.set(scenario.figma, true);
        } catch (error) {
          figmaOk.set(scenario.figma, false);
          errors.push((error as Error).message);
        }
      }
    }
    scenarios.push(scenario);
  }
  if (errors.length > 0) throw new Error(`invalid eval scenarios:\n- ${errors.join('\n- ')}`);
  return scenarios;
}
