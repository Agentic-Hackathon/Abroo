/**
 * Pattern-based redaction. k8sgpt masks object names but explicitly does NOT
 * mask log/event text; in Liara, logs are where secrets leak, so we mask by pattern.
 */
const RULES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[REDACTED_JWT]'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  // scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, '$1[REDACTED]$3'],
  // key=value / "key": "value" for sensitive-looking keys
  [
    /((?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth(?:orization)?|credential)s?["']?\s*[:=]\s*["']?)([^\s"',&;]+)/gi,
    '$1[REDACTED]',
  ],
];

export function redactText(s: string): string {
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

export function redactDeep<T>(v: T): T {
  if (typeof v === 'string') return redactText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = redactDeep(val);
    return out as T;
  }
  return v;
}
