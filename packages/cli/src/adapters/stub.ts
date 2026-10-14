import type { HostAdapter } from './host-adapter.js';
import type { VerificationResult } from '../types.js';
import type { SyncReport } from '../sync-skills.js';
import type { BlockAction } from '../managed-block.js';

/** VS Code adapter exists in the interface but has no installation logic yet. */
export class StubAdapter implements HostAdapter {
  readonly supported = false;

  constructor(readonly name: 'vscode') {}

  private unsupported(): Error {
    return new Error(`frontend-agent: ${this.name} is not supported yet (stub adapter in v0.4 — spec §6).`);
  }

  configuredServers(): null {
    return null;
  }

  async detect(): Promise<boolean> {
    return false;
  }

  async preflight(): Promise<void> {
    throw this.unsupported();
  }

  async installSkills(): Promise<SyncReport> {
    throw this.unsupported();
  }

  async installInstructions(): Promise<BlockAction> {
    throw this.unsupported();
  }

  async installMcp(): Promise<string[]> {
    throw this.unsupported();
  }

  async verify(): Promise<VerificationResult> {
    return { host: this.name, ok: false, checks: [{ name: 'supported', ok: false, detail: 'stub adapter; no installation logic yet' }] };
  }

  notes(): string[] {
    return [];
  }
}
