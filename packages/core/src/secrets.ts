const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, 'JWT'],
  [/\bnpm_[A-Za-z0-9]{30,}/, 'npm token'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/, 'bearer token'],
  [/:\/\/[^\s/:@]+:[^\s/@]{3,}@/, 'URL with embedded credentials'],
  [/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/i, 'credential assignment']
];

/** Label of the first secret-looking pattern in `text`, or null. */
export function findSecret(text: string): string | null {
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) return label;
  return null;
}

/** Replace every secret-looking span with a label that no longer looks like a secret. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, label] of SECRET_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'), `[redacted ${label}]`);
  }
  return out;
}
