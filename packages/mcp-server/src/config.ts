import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { getProjectRoot } from './project.js';

export type ValidationProfileName = 'pixel-perfect' | 'standard' | 'relaxed';

export interface ValidationProfile {
  geometryTolerancePx: number;
  spacingTolerancePx: number;
  fontSizeTolerancePx: number;
  maxCriticalA11yIssues: number;
  requireResponsivePass: boolean;
  pixelSimilarityTarget: number | 'informational';
}

export interface Breakpoint {
  name: string;
  width: number;
  height: number;
}

export interface ProjectConfig {
  allowedHosts: string[];
  validationProfile: ValidationProfileName;
  profile: ValidationProfile;
  breakpoints: Breakpoint[];
}

// Spec §7, verbatim.
export const DEFAULT_PROFILES: Record<ValidationProfileName, ValidationProfile> = {
  'pixel-perfect': {
    geometryTolerancePx: 0,
    spacingTolerancePx: 0,
    fontSizeTolerancePx: 0,
    maxCriticalA11yIssues: 0,
    requireResponsivePass: true,
    pixelSimilarityTarget: 'informational'
  },
  standard: {
    geometryTolerancePx: 3,
    spacingTolerancePx: 2,
    fontSizeTolerancePx: 1,
    maxCriticalA11yIssues: 0,
    requireResponsivePass: true,
    pixelSimilarityTarget: 0.95
  },
  relaxed: {
    geometryTolerancePx: 8,
    spacingTolerancePx: 6,
    fontSizeTolerancePx: 2,
    maxCriticalA11yIssues: 0,
    requireResponsivePass: true,
    pixelSimilarityTarget: 0.9
  }
};

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 }
];

export const BREAKPOINT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const profileOverrideSchema = z
  .object({
    geometryTolerancePx: z.number().nonnegative(),
    spacingTolerancePx: z.number().nonnegative(),
    fontSizeTolerancePx: z.number().nonnegative(),
    maxCriticalA11yIssues: z.number().int().nonnegative(),
    requireResponsivePass: z.boolean(),
    pixelSimilarityTarget: z.union([z.number().min(0).max(1), z.literal('informational')])
  })
  .partial()
  .strict();

const configSchema = z
  .object({
    validationProfile: z.enum(['pixel-perfect', 'standard', 'relaxed']).nullish(),
    allowedHosts: z.array(z.string()).nullish(),
    breakpoints: z
      .record(z.string().regex(BREAKPOINT_NAME_PATTERN), z.string().regex(/^\d+x\d+$/))
      .nullish(),
    profiles: z
      .object({
        'pixel-perfect': profileOverrideSchema.nullish(),
        standard: profileOverrideSchema.nullish(),
        relaxed: profileOverrideSchema.nullish()
      })
      .strict()
      .nullish()
  })
  .strict();

export function parseProjectConfig(yamlText: string, sourceLabel = '.frontend-agent/config.yml'): ProjectConfig {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    throw new Error(`invalid ${sourceLabel}: ${(error as Error).message}`);
  }

  const parsed = configSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid ${sourceLabel}: ${details}`);
  }
  const data = parsed.data;

  const validationProfile: ValidationProfileName = data.validationProfile ?? 'standard';
  const override = data.profiles?.[validationProfile] ?? {};
  const profile: ValidationProfile = { ...DEFAULT_PROFILES[validationProfile], ...override };

  const breakpoints: Breakpoint[] = data.breakpoints
    ? Object.entries(data.breakpoints).map(([name, size]) => {
        const [width, height] = size.split('x').map(Number);
        return { name, width, height };
      })
    : DEFAULT_BREAKPOINTS.map((breakpoint) => ({ ...breakpoint }));

  const allowedHosts = (data.allowedHosts ?? []).map((host) => host.trim().toLowerCase());

  return { allowedHosts, validationProfile, profile, breakpoints };
}

export function loadProjectConfig(configPath?: string): ProjectConfig {
  const resolvedPath = configPath ?? path.join(getProjectRoot(), '.frontend-agent', 'config.yml');
  if (!existsSync(resolvedPath)) return parseProjectConfig('');
  return parseProjectConfig(readFileSync(resolvedPath, 'utf8'), resolvedPath);
}
