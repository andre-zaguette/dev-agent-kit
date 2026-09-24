import { loadProjectConfig, parseProjectConfig } from './config.js';

const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function parseAllowedHosts(configYaml: string): string[] {
  return parseProjectConfig(configYaml).allowedHosts;
}

export function loadAllowedHosts(configPath?: string): string[] {
  return loadProjectConfig(configPath).allowedHosts;
}

export function isHostAllowed(url: string, extraAllowedHosts: string[] = []): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return [...DEFAULT_ALLOWED_HOSTS, ...extraAllowedHosts].includes(hostname);
}

interface NavigablePage {
  url: () => string;
}

interface NavigableRequest {
  url: () => string;
  redirectedFrom: () => NavigableRequest | null;
}

interface NavigableResponse {
  request: () => NavigableRequest;
}

/**
 * Verify that the page's final URL, and every hop in the redirect chain that
 * led to it, resolve to an allowed host. Throws before the caller writes a
 * screenshot or returns DOM data if any hop is disallowed.
 */
export function assertNavigationAllowed(
  page: NavigablePage,
  response: NavigableResponse | null,
  allowedHosts: string[],
  toolName: string
): void {
  const urlsToCheck = [page.url()];

  let request = response?.request().redirectedFrom() ?? null;
  while (request) {
    urlsToCheck.push(request.url());
    request = request.redirectedFrom();
  }

  for (const url of urlsToCheck) {
    if (!isHostAllowed(url, allowedHosts)) {
      throw new Error(`${toolName}: host not allowed after redirect for "${url}".`);
    }
  }
}
