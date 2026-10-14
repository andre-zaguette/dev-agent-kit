import type { ReferenceHint } from './backend-references.js';
import type { ProjectProfile } from './project-profile.js';

/**
 * Which frontend stack references apply to this repository (detect first, never force a technology).
 * Deterministic order, no duplicates, and an empty list when there is no frontend signal. A Nuxt project
 * declares `vue` too, so it gets the Nuxt guide first and the Vue guide second.
 */
export function selectFrontendReferences(profile: ProjectProfile): ReferenceHint[] {
  const has = (framework: string): boolean => profile.frameworks.includes(framework);
  const out: ReferenceHint[] = [];
  const add = (reference: string, reason: string): void => {
    if (!out.some((hint) => hint.reference === reference)) out.push({ skill: 'frontend-architecture', reference, reason });
  };
  if (has('nuxt')) add('nuxt-stack', 'Nuxt detected');
  if (has('vue')) add('vue-stack', 'Vue detected');
  if (has('next')) add('next-stack', 'Next.js detected');
  return out;
}
