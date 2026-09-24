import { z } from 'zod';

export const CATEGORIES = ['base', 'stack', 'profile', 'backend', 'fullstack'] as const;
export const HOSTS = ['claude', 'codex'] as const;
export type Category = (typeof CATEGORIES)[number];
export type HostId = (typeof HOSTS)[number];

const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PATTERN_LENGTH = 300;

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const relPath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((s) => s === '..' || s === ''),
    'must be a relative, "/"-separated path without ".." or empty segments'
  );
const flags = z.string().regex(/^[imsu]*$/, 'only the i, m, s and u flags are allowed').optional();
const pattern = z.string().min(1).max(MAX_PATTERN_LENGTH).refine(isValidRegex, 'invalid regular expression');
const description = z.string().max(200).optional();

export const AssertionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('tool_called'),
      tool: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'tool must be "<server>/<tool>"'),
      args: z.record(pattern).optional(),
      description
    })
    .strict(),
  z.object({ type: z.literal('output_matches'), pattern, flags, description }).strict(),
  z.object({ type: z.literal('file_matches'), glob: relPath, pattern, flags, description }).strict(),
  z.object({ type: z.literal('file_exists'), path: relPath, description }).strict()
]);
export type Assertion = z.infer<typeof AssertionSchema>;

export const ScenarioSchema = z
  .object({
    id: z.string().regex(NAME),
    category: z.enum(CATEGORIES),
    title: z.string().min(1).max(120),
    fixture: z.string().regex(NAME),
    figma: z.string().regex(NAME).optional(),
    profile: z.enum(['pixel-perfect', 'standard', 'relaxed']).optional(),
    prompt: z.string().min(1).max(4000),
    timeoutSec: z.number().int().min(60).max(3600).default(900),
    expected: z.array(AssertionSchema).min(1),
    forbidden: z.array(AssertionSchema).default([])
  })
  .strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

const FigmaNodeSchema = z
  .object({
    name: z.string().min(1),
    designContext: z.string().optional(),
    tooLarge: z.boolean().optional(),
    metadata: z.string().optional(),
    screenshot: relPath.optional(),
    assets: z.record(z.string().regex(/^[A-Za-z0-9._-]+$/), relPath).optional()
  })
  .strict();

export const FigmaFixtureSchema = z
  .object({
    fileKey: z.string().min(1),
    metadata: z.string().min(1),
    variables: z.record(z.string()),
    nodes: z.record(z.string().regex(/^\d+:\d+$/), FigmaNodeSchema)
  })
  .strict();
export type FigmaFixture = z.infer<typeof FigmaFixtureSchema>;
