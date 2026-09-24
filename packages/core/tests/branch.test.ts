import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BRANCH_PATTERN, assertBranchName, branchTypeFor, findInstructedPattern, inferPatternFromBranches, renderBranchPattern, resolveBranchName, slugify } from '../src/branch.ts';

test('slugify folds accents, punctuation and length, and never returns an empty slug', () => {
  assert.equal(slugify('Biometric report: “PDF” export!'), 'biometric-report-pdf-export');
  assert.equal(slugify('Ação de cadastro rápido'), 'acao-de-cadastro-rapido');
  assert.equal(slugify('  ---  '), 'task');
  assert.equal(slugify('日本語のタイトル'), 'task');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  const long = slugify('word '.repeat(30));
  assert.ok(long.length <= 40 && !long.endsWith('-'));
});

test('branch type follows the work item type and classification', () => {
  assert.equal(branchTypeFor('Bug', 'backend'), 'fix');
  assert.equal(branchTypeFor('Story', 'frontend'), 'feat');
  assert.equal(branchTypeFor('Documentation', undefined), 'docs');
  assert.equal(branchTypeFor(undefined, 'infrastructure'), 'chore');
  assert.equal(branchTypeFor(undefined, undefined), 'feat');
});

test('patterns render known placeholders and refuse unknown or unsafe results', () => {
  const vars = { type: 'feat', key: 'HEF-123', slug: 'meeting-card' };
  assert.equal(renderBranchPattern(DEFAULT_BRANCH_PATTERN, vars), 'feat/hef-123-meeting-card');
  assert.equal(renderBranchPattern('{type}/{key}-{slug}', vars), 'feat/HEF-123-meeting-card');
  assert.throws(() => renderBranchPattern('{type}/{nope}', vars), /unknown placeholder/);
  assert.throws(() => renderBranchPattern('{type}/{slug}', { ...vars, key: '../x' }), /invalid work item key/);
  for (const bad of ['-x', 'a..b', 'a b', 'a//b', '/a', 'a/', 'a.lock', 'a.', 'a~b']) assert.throws(() => assertBranchName(bad), /branch name/, bad);
  assert.doesNotThrow(() => assertBranchName('feat/hef-1-x'));
});

test('an instructed pattern is found only when it carries placeholders', () => {
  assert.equal(findInstructedPattern('Branch pattern: `feature/{key}-{slug}`'), 'feature/{key}-{slug}');
  assert.equal(findInstructedPattern('Use this branch naming = `{type}/{keyLower}-{slug}` please'), '{type}/{keyLower}-{slug}');
  assert.equal(findInstructedPattern('Branch names: `main` only'), undefined);
  assert.equal(findInstructedPattern('nothing relevant'), undefined);
});

test('remote branches reveal a pattern only when clearly consistent', () => {
  const lower = ['feat/hef-1-a', 'fix/hef-2-b', 'chore/pay-3-c', 'feat/pay-4-d', 'main'];
  assert.equal(inferPatternFromBranches(lower), '{type}/{keyLower}-{slug}');
  const upper = ['feat/HEF-1-a', 'fix/HEF-2-b', 'feat/PAY-3-c'];
  assert.equal(inferPatternFromBranches(upper), '{type}/{key}-{slug}');
  assert.equal(inferPatternFromBranches(['feat/hef-1-a', 'wip', 'johns-thing', 'fix/other']), undefined);
  assert.equal(inferPatternFromBranches(['main', 'develop', 'release/1.0', 'HEAD']), undefined);
});

test('resolution order: config, instructions, remote history, fallback; inconsistent history asks', () => {
  const base = { key: 'HEF-123', title: 'Meeting card', workItemType: 'Story' };
  assert.deepEqual(resolveBranchName({ ...base, configuredPattern: '{key}/{slug}', instructionText: 'Branch pattern: `x/{slug}`', remoteBranches: ['a/b-1-c', 'a/b-2-c', 'a/b-3-c'] }), { status: 'ok', name: 'HEF-123/meeting-card', via: 'config' });
  assert.deepEqual(resolveBranchName({ ...base, instructionText: 'Branch pattern: `wip/{keyLower}-{slug}`' }), { status: 'ok', name: 'wip/hef-123-meeting-card', via: 'instructions' });
  assert.deepEqual(resolveBranchName({ ...base, remoteBranches: ['feat/aa-1-x', 'fix/aa-2-y', 'feat/bb-3-z', 'main'] }), { status: 'ok', name: 'feat/hef-123-meeting-card', via: 'remote' });
  assert.deepEqual(resolveBranchName(base), { status: 'ok', name: 'feat/hef-123-meeting-card', via: 'fallback' });
  assert.deepEqual(resolveBranchName({ ...base, remoteBranches: ['main', 'one'] }), { status: 'ok', name: 'feat/hef-123-meeting-card', via: 'fallback' });
  const ask = resolveBranchName({ ...base, remoteBranches: ['x/1', 'y-2', 'zed', 'wip/foo', 'main'] });
  assert.equal(ask.status, 'ask');
});

test('a hostile title or key cannot produce an unsafe branch name', () => {
  const r = resolveBranchName({ key: 'HEF-1', title: '--upload-pack=evil; $(rm -rf /) ../..' });
  assert.equal(r.status, 'ok');
  if (r.status === 'ok') assert.match(r.name, /^feat\/hef-1-[a-z0-9-]+$/);
  assert.throws(() => resolveBranchName({ key: '../x', title: 'T' }), /invalid work item key/);
});
