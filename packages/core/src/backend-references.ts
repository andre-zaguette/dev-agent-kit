import type { ProjectProfile } from './project-profile.js';

export interface ReferenceHint {
  skill: string;
  reference: string;
  reason: string;
}

const BACKEND_FRAMEWORKS = ['django', 'drf', 'fastapi', 'nestjs', 'express'];

/**
 * Which backend references apply to this repository (spec §16: detect first, never force a
 * technology). Deterministic order, no duplicates, and an empty list when there is no backend signal.
 */
export function selectBackendReferences(profile: ProjectProfile): ReferenceHint[] {
  const has = (framework: string): boolean => profile.frameworks.includes(framework);
  const queues = profile.queues ?? (profile.queue ? [profile.queue] : []);
  if (!BACKEND_FRAMEWORKS.some(has) && queues.length === 0) return [];

  const out: ReferenceHint[] = [];
  const add = (skill: string, reference: string, reason: string): void => {
    if (!out.some((hint) => hint.reference === reference)) out.push({ skill, reference, reason });
  };
  const node = profile.languages.includes('typescript') || profile.languages.includes('javascript');

  if (profile.languages.includes('python')) add('backend-architecture', 'python', 'Python project');
  if (has('django')) add('backend-architecture', 'django', 'Django detected');
  if (has('drf')) add('api-design', 'drf', 'Django REST Framework detected');
  if (has('fastapi')) add('backend-architecture', 'fastapi', 'FastAPI detected');
  if (node && (has('nestjs') || has('express'))) add('backend-architecture', 'node-typescript', 'Node backend detected');
  if (has('nestjs')) add('backend-architecture', 'nestjs', 'NestJS detected');
  if (has('drf') || has('fastapi') || has('nestjs')) add('api-design', 'openapi', 'The framework publishes an OpenAPI description');
  if (profile.database === 'postgresql') add('data-modeling', 'postgresql', 'PostgreSQL detected');
  if (queues.includes('rabbitmq')) add('async-jobs', 'rabbitmq', 'RabbitMQ detected');
  if (queues.includes('celery')) add('async-jobs', 'celery', 'Celery detected');
  if (profile.cache === 'redis') add('async-jobs', 'redis', 'Redis detected');
  if (profile.docker) add('backend-architecture', 'docker', 'Docker/Compose files present');
  add('auth-security', 'security', 'Backend project: check authorization, input handling and secrets');
  return out;
}
