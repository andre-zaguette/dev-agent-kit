import { AxeBuilder } from '@axe-core/playwright';
import { withAllowedPages, type Viewport } from './browser.js';
import { loadProjectConfig, type ValidationProfileName } from './config.js';

const TOOL = 'run_accessibility_audit';
const MAX_TARGETS_PER_VIOLATION = 5;

export interface A11yViolation {
  id: string;
  impact: string | null;
  description: string;
  helpUrl: string;
  nodeCount: number;
  targets: string[];
}

export interface AccessibilityAuditResult {
  url: string;
  validationProfile: ValidationProfileName;
  countsByImpact: { critical: number; serious: number; moderate: number; minor: number };
  criticalCount: number;
  maxCriticalA11yIssues: number;
  passed: boolean;
  violations: A11yViolation[];
}

export async function runAccessibilityAudit(input: { url: string; viewport?: Viewport }): Promise<AccessibilityAuditResult> {
  const config = loadProjectConfig();

  const axeViolations = await withAllowedPages(TOOL, input.url, async (open) => {
    const page = await open(input.viewport);
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations;
  });

  const countsByImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const violations: A11yViolation[] = axeViolations.map((violation) => {
    const impact = violation.impact ?? null;
    if (impact && impact in countsByImpact) {
      countsByImpact[impact as keyof typeof countsByImpact] += violation.nodes.length;
    }
    return {
      id: violation.id,
      impact,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodeCount: violation.nodes.length,
      targets: violation.nodes.slice(0, MAX_TARGETS_PER_VIOLATION).map((node) => node.target.join(' '))
    };
  });

  const criticalCount = countsByImpact.critical;
  const maxCriticalA11yIssues = config.profile.maxCriticalA11yIssues;
  return {
    url: input.url,
    validationProfile: config.validationProfile,
    countsByImpact,
    criticalCount,
    maxCriticalA11yIssues,
    passed: criticalCount <= maxCriticalA11yIssues,
    violations
  };
}
