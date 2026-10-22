const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_WINDOW_MS = 7 * UNIT_MS.d;
const DEFAULT_WINDOW_MS = UNIT_MS.h;

/** "30m" | "1h" | "1d" -> milliseconds (default 1h, capped at 7d). */
export function parseSince(since?: string): number {
  if (!since) return DEFAULT_WINDOW_MS;
  const m = /^(\d+)\s*([smhd])$/i.exec(since.trim());
  if (!m) return DEFAULT_WINDOW_MS;
  return Math.min(Number(m[1]) * UNIT_MS[m[2].toLowerCase()], MAX_WINDOW_MS);
}

export function truncate(s: string, max = 220): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Accepts an array or a common wrapper object ({logs|data|releases|items: []}). */
export function toArray(x: unknown): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    for (const k of ['logs', 'data', 'releases', 'items', 'results']) {
      if (Array.isArray(o[k])) return o[k] as any[];
    }
  }
  return [];
}

/** Depth-limited search for the first numeric value whose key matches. */
export function findMetric(
  obj: unknown,
  keyPattern: RegExp,
  depth = 0,
): { key: string; value: number } | undefined {
  if (obj === null || typeof obj !== 'object' || depth > 4) return undefined;
  const entries = Object.entries(obj as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (!keyPattern.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return { key: k, value: v };
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return { key: k, value: Number(v) };
    }
  }
  for (const [, v] of entries) {
    const r = findMetric(v, keyPattern, depth + 1);
    if (r) return r;
  }
  return undefined;
}

/** Turns one log entry (string or object) into a single text line. */
export function logLine(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    for (const k of ['message', 'log', 'text', 'msg', 'line']) {
      if (typeof o[k] === 'string') return o[k] as string;
    }
    return JSON.stringify(entry);
  }
  return String(entry);
}

export const ERROR_LINE = /\b(error|exception|fatal|panic|traceback)\b/i;
