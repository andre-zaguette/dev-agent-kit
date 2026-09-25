import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  assertWorkItemKey,
  loadDevAgentConfig,
  parseOpenApiText,
  readContract,
  resolveInside,
  verifyClientUsage,
  workspaceRoot,
  findWorkspace,
  verifyExchange,
  verifyOpenApi,
  type ApiContract,
  type ClientFile,
  type Exchange,
  type VerifyResult
} from '../../core/src/index.js';
import type { CliIo } from './cli.js';
import { CliError, projectRootOf } from './dev-common.js';

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_CLIENT_FILES = 2000;
const MAX_CLIENT_FILE_BYTES = 500 * 1024;
const MAX_CLIENT_TOTAL_BYTES = 50 * 1024 * 1024;
const CLIENT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.html']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.output', '.svelte-kit', 'out', '.turbo', '.cache']);

function load(root: string, key: string): ApiContract {
  try {
    const contract = readContract(root, loadDevAgentConfig(root), key);
    if (contract === null) throw new CliError(`dev-agent: no contract for ${key}.`, 1);
    return contract;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError((error as Error).message, 1);
  }
}

function keyOf(positionals: string[], what: string): string {
  const key = positionals[0];
  if (!key) throw new CliError(`dev-agent: contract ${what} needs a work item key — see --help.`);
  try {
    assertWorkItemKey(key);
  } catch (error) {
    throw new CliError(`dev-agent: ${(error as Error).message}`, 1);
  }
  return key;
}

function readEvidence(io: CliIo, file: string): string {
  const full = path.resolve(io.cwd, file);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    throw new CliError(`dev-agent: cannot read "${file}".`, 1);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CliError(`dev-agent: "${file}" must be a regular file (not a symbolic link or a directory).`, 1);
  if (stat.size > MAX_EVIDENCE_BYTES) throw new CliError(`dev-agent: "${file}" is larger than ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB.`, 1);
  return readFileSync(full, 'utf8');
}

export function contractShow(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { project: { type: 'string' } } });
  io.stdout(JSON.stringify(load(projectRootOf(values, io), keyOf(positionals, 'show')), null, 2));
  return 0;
}

interface Section {
  label: string;
  result: VerifyResult;
}

function printSection(io: CliIo, section: Section): void {
  const errors = section.result.violations.filter((v) => v.severity === 'error');
  io.stdout(`${errors.length === 0 ? '✔' : '✘'} ${section.label}`);
  for (const v of section.result.violations) io.stdout(`  ${v.severity === 'error' ? '✘' : '!'} ${v.message}`);
}

export function contractVerify(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { project: { type: 'string' }, json: { type: 'boolean', default: false }, exchange: { type: 'string', multiple: true }, openapi: { type: 'string' } }
  });
  const contract = load(projectRootOf(values, io), keyOf(positionals, 'verify'));
  const exchangeFiles = values.exchange ?? [];
  if (exchangeFiles.length === 0 && !values.openapi) throw new CliError('dev-agent: contract verify needs --exchange or --openapi evidence — see --help.');

  const sections: Section[] = [];
  for (const file of exchangeFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readEvidence(io, file));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`dev-agent: "${file}" is not valid JSON.`, 1);
    }
    const exchanges = (Array.isArray(parsed) ? parsed : [parsed]) as Exchange[];
    if (exchanges.length === 0) throw new CliError(`dev-agent: "${file}" holds no exchanges.`, 1);
    if (exchanges.some((e) => typeof e !== 'object' || e === null || typeof e.method !== 'string' || typeof e.path !== 'string' || typeof e.status !== 'number')) {
      throw new CliError(`dev-agent: "${file}" must hold exchanges shaped { method, path, status, requestBody?, responseBody? }.`, 1);
    }
    const results = exchanges.map((e) => verifyExchange(contract, e));
    sections.push({
      label: `exchange ${file} (${exchanges.length} exchange${exchanges.length === 1 ? '' : 's'})`,
      result: { ok: results.every((r) => r.ok), violations: results.flatMap((r) => r.violations) }
    });
  }
  if (values.openapi) {
    let doc: unknown;
    try {
      doc = parseOpenApiText(readEvidence(io, values.openapi));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError(`dev-agent: ${(error as Error).message}.`, 1);
    }
    sections.push({ label: `openapi ${values.openapi}`, result: verifyOpenApi(contract, doc) });
  }

  const ok = sections.every((s) => s.result.ok);
  if (values.json) io.stdout(JSON.stringify({ ok, results: sections.map((s) => ({ input: s.label, ...s.result })) }, null, 2));
  else for (const s of sections) printSection(io, s);
  return ok ? 0 : 2;
}

function collectClientFiles(root: string, dir: string, out: ClientFile[], total: { bytes: number }): void {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (out.length >= MAX_CLIENT_FILES) return;
    if (entry.isSymbolicLink()) continue;
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectClientFiles(root, rel, out, total);
    } else if (entry.isFile() && CLIENT_EXT.has(path.extname(entry.name))) {
      const full = path.join(root, rel);
      const size = lstatSync(full).size;
      if (size > MAX_CLIENT_FILE_BYTES) continue;
      total.bytes += size;
      if (total.bytes > MAX_CLIENT_TOTAL_BYTES) throw new CliError('dev-agent: the client files are larger than 50 MB in total.', 1);
      out.push({ path: rel, text: readFileSync(full, 'utf8') });
    }
  }
}

export function contractUsage(args: string[], io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { project: { type: 'string' }, json: { type: 'boolean', default: false }, client: { type: 'string', multiple: true }, strict: { type: 'boolean', default: false } }
  });
  const root = projectRootOf(values, io);
  const contract = load(root, keyOf(positionals, 'usage'));
  const clients = values.client ?? [];
  if (clients.length === 0 && contract.consumers && contract.consumers.length > 0) return contractUsageByConsumer(root, contract, values, io);
  if (clients.length === 0) throw new CliError('dev-agent: contract usage needs at least one --client <dir> — see --help.');

  const files: ClientFile[] = [];
  const found: ClientFile[] = [];
  const seen = new Set<string>();
  const total = { bytes: 0 };
  for (const client of clients) {
    let abs: string;
    try {
      const resolved = path.resolve(root, client);
      abs = resolved === root ? root : resolveInside(root, client);
      if (!lstatSync(abs).isDirectory()) throw new Error('not a directory');
    } catch (error) {
      const reason = (error as Error).message;
      throw new CliError(`dev-agent: --client "${client}": ${/escapes|symbolic|relative/.test(reason) ? reason : 'not a directory inside the project'}.`, 1);
    }
    collectClientFiles(root, path.relative(root, abs).split(path.sep).join('/'), found, total);
    for (const f of found) if (!seen.has(f.path)) (seen.add(f.path), files.push(f));
    found.length = 0;
  }
  const usage = verifyClientUsage(contract, files);
  if (values.json) io.stdout(JSON.stringify({ ...usage, scannedFiles: files.length }, null, 2));
  else {
    printUsage(io, usage);
    io.stdout('(text evidence from client source, not a proof of runtime behavior)');
  }
  const ok = usage.used && (!values.strict || usage.missingErrorCodes.length === 0);
  return ok ? 0 : 2;
}

type Usage = ReturnType<typeof verifyClientUsage>;

function printUsage(io: CliIo, usage: Usage, indent = ''): void {
  io.stdout(`${indent}used: ${usage.used ? 'yes' : 'no'}`);
  io.stdout(`${indent}method confirmed: ${usage.methodConfirmed ? 'yes' : 'no'}`);
  io.stdout(`${indent}files: ${usage.files.length > 0 ? usage.files.join(', ') : '-'}`);
  io.stdout(`${indent}path only: ${usage.pathOnlyFiles.length > 0 ? usage.pathOnlyFiles.join(', ') : '-'}`);
  io.stdout(`${indent}unhandled error codes: ${usage.missingErrorCodes.length > 0 ? usage.missingErrorCodes.join(', ') : '-'}`);
}

/** No --client: scan each consumer workspace named by the contract, reporting paths relative to that workspace's parent (the project root). */
function contractUsageByConsumer(root: string, contract: ApiContract, values: { json?: boolean; strict?: boolean }, io: CliIo): number {
  let cfg;
  try {
    cfg = loadDevAgentConfig(root);
  } catch (error) {
    throw new CliError((error as Error).message, 1);
  }
  if (cfg.workspaces.length === 0) throw new CliError('dev-agent: the contract lists consumers but the config defines no workspaces; add a "workspaces:" map or pass --client <dir>.', 1);
  const results: Array<{ name: string; usage: Usage; scannedFiles: number }> = [];
  for (const name of contract.consumers ?? []) {
    let dir: string;
    try {
      dir = workspaceRoot(root, findWorkspace(cfg, name));
    } catch (error) {
      throw new CliError(`dev-agent: contract consumer: ${(error as Error).message}.`, 1);
    }
    const files: ClientFile[] = [];
    collectClientFiles(dir, '', files, { bytes: 0 });
    const prefix = findWorkspace(cfg, name).path;
    const scoped = files.map((f) => ({ ...f, path: `${prefix}/${f.path}` }));
    results.push({ name, usage: verifyClientUsage(contract, scoped), scannedFiles: scoped.length });
  }
  if (values.json) {
    io.stdout(JSON.stringify({ consumers: Object.fromEntries(results.map((r) => [r.name, { ...r.usage, scannedFiles: r.scannedFiles }])) }, null, 2));
  } else {
    for (const r of results) {
      io.stdout(`consumer ${r.name}`);
      printUsage(io, r.usage, '  ');
    }
    io.stdout('(text evidence from client source, not a proof of runtime behavior)');
  }
  return results.every((r) => r.usage.used && (!values.strict || r.usage.missingErrorCodes.length === 0)) ? 0 : 2;
}
