import type { Analyzer, Finding, Severity } from '../types.js';
import { ERROR_LINE, truncate } from '../util.js';

interface Rule {
  id: string;
  pattern: RegExp;
  severity: Severity;
  title: string;
  suggestion: string;
  suggestedTool?: string;
}

const RULES: Rule[] = [
  {
    id: 'oom',
    pattern: /(out of memory|OOMKilled|heap out of memory|Killed process|MemoryError|Cannot allocate memory)/i,
    severity: 'critical',
    title: 'Out-of-memory errors',
    suggestion: 'The app exceeds its memory limit. Move to a bigger plan or reduce memory usage.',
    suggestedTool: 'liara_resize_app',
  },
  {
    id: 'missing-module',
    pattern: /(Cannot find module|ModuleNotFoundError|No module named|ClassNotFoundException|cannot load such file)/i,
    severity: 'critical',
    title: 'Missing dependency / module at startup',
    suggestion: 'A dependency is missing from the build. Check package manifest and redeploy.',
  },
  {
    id: 'port-in-use',
    pattern: /(EADDRINUSE|address already in use)/i,
    severity: 'warning',
    title: 'Port already in use',
    suggestion: 'Make sure the app listens on the PORT Liara provides and starts only once.',
  },
  {
    id: 'db-auth',
    pattern: /(ER_ACCESS_DENIED|password authentication failed|authentication failed|Access denied for user|SASL)/i,
    severity: 'critical',
    title: 'Database authentication failure',
    suggestion: 'Credentials in env vars are likely wrong or rotated. Verify the connection info.',
    suggestedTool: 'liara_get_database_connection',
  },
  {
    id: 'conn-refused',
    pattern: /(ECONNREFUSED|connection refused)/i,
    severity: 'warning',
    title: 'Connection refused to a dependency',
    suggestion: 'A database/service the app talks to is down or the host/port is wrong.',
  },
  {
    id: 'dns',
    pattern: /(ENOTFOUND|getaddrinfo|Name or service not known|could not resolve host)/i,
    severity: 'warning',
    title: 'DNS resolution failures',
    suggestion: 'A hostname used by the app does not resolve. Check hosts in env vars.',
  },
  {
    id: 'disk-full',
    pattern: /(ENOSPC|no space left on device|disk quota exceeded)/i,
    severity: 'critical',
    title: 'Disk is full',
    suggestion: 'Free space or enlarge the attached disk.',
    suggestedTool: 'liara_resize_disk',
  },
  {
    id: 'timeout',
    pattern: /(ETIMEDOUT|timed out|timeout exceeded|upstream request timeout)/i,
    severity: 'warning',
    title: 'Timeouts',
    suggestion: 'Requests to a dependency (or from the proxy) are timing out. Check dependency health and resource usage.',
  },
  {
    id: 'crash',
    pattern: /(UnhandledPromiseRejection|uncaught exception|Traceback \(most recent call last\)|panic:|segmentation fault|fatal error)/i,
    severity: 'warning',
    title: 'Unhandled exceptions / crashes',
    suggestion: 'The app throws unhandled errors. Inspect the stack traces in the evidence.',
  },
];

const START_LINE = /(server (has )?(started|listening)|listening on (port|:|\d)|started server|application startup complete)/i;
const MAX_EVIDENCE = 3;

const normalize = (l: string) => l.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

function sample(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const k = normalize(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(truncate(l.trim()));
    if (out.length >= MAX_EVIDENCE) break;
  }
  return out;
}

export const logsAnalyzer: Analyzer = {
  name: 'logs',
  description: 'Known failure patterns in recent logs (OOM, missing module, DB auth, ENOSPC, crash loops, ...)',
  defaultEnabled: true,
  analyze(ctx) {
    if (ctx.unavailable.logs) return [];
    const findings: Finding[] = [];

    if (ctx.logs.length === 0) {
      return [
        {
          analyzer: 'logs',
          severity: 'info',
          title: `No log lines in the last ${ctx.since}`,
          evidence: [],
          suggestion: 'The app may be stopped, idle, or not writing to stdout/stderr. Try a longer window.',
        },
      ];
    }

    for (const rule of RULES) {
      const hits = ctx.logs.filter((l) => rule.pattern.test(l));
      if (hits.length === 0) continue;
      findings.push({
        analyzer: 'logs',
        severity: rule.severity,
        title: `${rule.title} (${hits.length}×)`,
        evidence: sample(hits),
        suggestion: rule.suggestion,
        suggestedTool: rule.suggestedTool,
      });
    }

    const starts = ctx.logs.filter((l) => START_LINE.test(l));
    if (starts.length >= 3) {
      findings.push({
        analyzer: 'logs',
        severity: 'warning',
        title: `Probable restart loop: startup message seen ${starts.length}× in ${ctx.since}`,
        evidence: sample(starts),
        suggestion: 'The app keeps restarting. Look for the error just before each startup line.',
      });
    }

    if (findings.length === 0) {
      const errs = ctx.logs.filter((l) => ERROR_LINE.test(l));
      if (errs.length > 0) {
        findings.push({
          analyzer: 'logs',
          severity: 'info',
          title: `${errs.length} error-like log lines, no known pattern matched`,
          evidence: sample(errs),
          suggestion: 'Inspect these lines manually (or fetch more logs with liara_get_logs).',
          suggestedTool: 'liara_get_logs',
        });
      }
    }
    return findings;
  },
};
