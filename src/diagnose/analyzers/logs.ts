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
    pattern:
      /(out of memory|OOMKilled|heap out of memory|Killed process|MemoryError|Cannot allocate memory)/i,
    severity: 'critical',
    title: 'Out-of-memory errors',
    suggestion:
      'Verify memory pressure and resource usage. If the memory limit is confirmed to be insufficient, consider a larger plan or reducing memory consumption.',
    suggestedTool: 'liara_resize_app',
  },
  {
    id: 'missing-module',
    pattern:
      /(Cannot find module|ModuleNotFoundError|No module named|ClassNotFoundException|cannot load such file)/i,
    severity: 'critical',
    title: 'Missing dependency / module at startup',
    suggestion:
      'Check the package manifest, dependency installation, build output, and deployment configuration.',
  },
  {
    id: 'port-in-use',
    pattern: /(EADDRINUSE|address already in use)/i,
    severity: 'warning',
    title: 'Port already in use',
    suggestion:
      'Verify that the app listens on the PORT provided by Liara and does not start duplicate server instances.',
  },
  {
    id: 'db-auth',
    pattern:
      /(ER_ACCESS_DENIED|password authentication failed|Access denied for user|SASL)/i,
    severity: 'critical',
    title: 'Database authentication failure',
    suggestion:
      'Verify database credentials and connection settings. Do not expose credential values in logs or diagnostic output.',
    suggestedTool: 'liara_get_database_connection',
  },
  {
    id: 'conn-refused',
    pattern: /(ECONNREFUSED|connection refused)/i,
    severity: 'warning',
    title: 'Connection refused to a dependency',
    suggestion:
      'Verify that the target service is running and that its hostname, port, and network configuration are correct.',
  },
  {
    id: 'dns',
    pattern:
      /(ENOTFOUND|getaddrinfo|Name or service not known|could not resolve host)/i,
    severity: 'warning',
    title: 'DNS resolution failures',
    suggestion:
      'Verify the hostname and DNS configuration for the affected dependency.',
  },
  {
    id: 'disk-full',
    pattern:
      /(ENOSPC|no space left on device|disk quota exceeded)/i,
    severity: 'critical',
    title: 'Write failed: no space left or quota exceeded',
    suggestion:
      'Determine which filesystem and path failed (including ephemeral root and inode quota); check attached volumes and disk metrics before taking any action.',
    suggestedTool: 'liara_list_disks',
  },
  {
    id: 'timeout',
    pattern:
      /(ETIMEDOUT|timed out|timeout exceeded|upstream request timeout)/i,
    severity: 'warning',
    title: 'Timeouts',
    suggestion:
      'Investigate dependency health, network latency, request duration, and resource usage.',
  },
  {
    id: 'crash',
    pattern:
      /(UnhandledPromiseRejection|uncaught exception|Traceback \(most recent call last\)|panic:|segmentation fault|fatal error)/i,
    severity: 'warning',
    title: 'Unhandled exceptions / crashes',
    suggestion:
      'Inspect the associated stack trace and identify the exception that caused the failure.',
  },
];

const START_LINE =
  /(server (has )?(started|listening)|listening on (port|:|\d)|started server|application startup complete)/i;

const MAX_EVIDENCE = 3;

function normalize(line: string): string {
  return line
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function sample(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const normalized = normalize(line);

    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(truncate(line.trim()));

    if (result.length >= MAX_EVIDENCE) break;
  }

  return result;
}

export const logsAnalyzer: Analyzer = {
  name: 'logs',
  description:
    'Known failure patterns in recent logs (OOM, missing module, DB auth, ENOSPC, crashes, and restart loops)',
  defaultEnabled: true,
  requires: ['logs'],

  analyze(ctx): Finding[] {
    const findings: Finding[] = [];

    if (ctx.logs.length === 0) {
      return [
        {
          analyzer: 'logs',
          id: 'no-log-lines',
          severity: 'info',
          basis: 'observed',
          title: `No log lines in the sampled window (${ctx.since})`,
          evidence: [],
          suggestion:
            'No log lines were returned for the sampled window. Check log collection, app activity, and whether a longer time window is needed.',
        },
      ];
    }

    for (const rule of RULES) {
      const hits = ctx.logs.filter((line) =>
        rule.pattern.test(line.message),
      );

      if (hits.length === 0) continue;

      findings.push({
        analyzer: 'logs',
        id: rule.id,
        severity: rule.severity,
        basis: 'observed',
        title: `${rule.title} (${hits.length}×)`,
        evidence: sample(hits.map((line) => line.message)),
        stats: {
          count: hits.length,
          firstSeen: hits[0].timestamp,
          lastSeen: hits[hits.length - 1].timestamp,
          ...(hits[0].releaseId &&
          ctx.releaseTags[hits[0].releaseId]
            ? { releaseTag: ctx.releaseTags[hits[0].releaseId] }
            : {}),
        },
        suggestion: rule.suggestion,
        ...(rule.suggestedTool
          ? { suggestedTool: rule.suggestedTool }
          : {}),
      });
    }

    const starts = ctx.logs.filter((line) =>
      START_LINE.test(line.message),
    );

    if (starts.length >= 3) {
      findings.push({
        analyzer: 'logs',
        id: 'probable-restart-loop',
        severity: 'warning',
        basis: 'hypothesis',
        title: `Probable restart loop: startup message seen ${starts.length}× in ${ctx.since}`,
        evidence: sample(starts.map((line) => line.message)),
        stats: {
          count: starts.length,
          firstSeen: starts[0].timestamp,
          lastSeen: starts[starts.length - 1].timestamp,
        },
        suggestion:
          'First confirm that the startup messages represent separate restarts. Then inspect the errors immediately before each startup.',
      });
    }

    if (findings.length === 0) {
      const errors = ctx.logs.filter((line) =>
        ERROR_LINE.test(line.message),
      );

      if (errors.length > 0) {
        findings.push({
          analyzer: 'logs',
          id: 'unclassified-errors',
          severity: 'info',
          basis: 'observed',
          title: `${errors.length} error-like log lines, no known pattern matched`,
          evidence: sample(errors.map((line) => line.message)),
          stats: {
            count: errors.length,
            firstSeen: errors[0].timestamp,
            lastSeen: errors[errors.length - 1].timestamp,
          },
          suggestion:
            'Review these lines and collect additional log context if needed.',
          suggestedTool: 'liara_get_logs',
        });
      }
    }

    return findings;
  },
};