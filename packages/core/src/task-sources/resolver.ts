import type { Resolution, SourceRoute } from './types.js';

const MAX_PROBE_CANDIDATES = 3;

/**
 * Pick the task source for `identifier` (spec §7.3): explicit source, identifier pattern, configured
 * default, then a bounded probe when the caller opted in. Never fans an identifier out across every
 * source, and never guesses between two matching sources.
 */
export function resolveSource(identifier: string, routes: SourceRoute[], opts: { explicit?: string; probe?: boolean } = {}): Resolution {
  const id = identifier.trim();
  if (id === '') return { status: 'unresolved', reason: 'empty identifier' };

  if (opts.explicit !== undefined) {
    return routes.some((r) => r.id === opts.explicit)
      ? { status: 'resolved', source: opts.explicit, via: 'explicit' }
      : { status: 'unknown-source', source: opts.explicit, known: routes.map((r) => r.id) };
  }

  const matches = routes.filter((r) => r.identifiers.some((re) => new RegExp(re.source, re.flags.replace(/[gy]/g, '')).test(id)));
  if (matches.length === 1) return { status: 'resolved', source: matches[0].id, via: 'pattern' };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map((r) => r.id) };

  const fallback = routes.find((r) => r.default);
  if (fallback) return { status: 'resolved', source: fallback.id, via: 'default' };

  if (opts.probe) {
    const candidates = routes.filter((r) => r.identifiers.length === 0).map((r) => r.id);
    if (candidates.length > 0 && candidates.length <= MAX_PROBE_CANDIDATES) return { status: 'probe', candidates };
  }

  return {
    status: 'unresolved',
    reason: routes.length === 0 ? 'no task sources are configured' : 'no source matches this identifier and no default is configured'
  };
}
