import type { Analyzer, Finding } from '../types.js';
import { findMetric, truncate } from '../util.js';

const WARN_PCT = 85;
const CRIT_PCT = 95;

const CPU_KEY = /cpu/i;
const MEM_KEY = /(mem|ram)/i;
const PCT_KEY = /(percent|pct|util)/i;

function check(
  label: string,
  metrics: unknown,
  keyRe: RegExp,
): Finding | undefined {
  const hit = findMetric(
    metrics,
    new RegExp(
      `(?=.*${keyRe.source})(?=.*${PCT_KEY.source})`,
      'i',
    ),
  );

  if (!hit || hit.value < WARN_PCT) return undefined;

  const severity = hit.value >= CRIT_PCT ? 'critical' : 'warning';
  const id = label === 'CPU' ? 'cpu-usage-high' : 'memory-usage-high';

  return {
    analyzer: 'resources',
    id,
    severity,
    basis: 'observed',
    title: `${label} usage is high (${hit.value}%)`,
    evidence: [`${hit.key}=${hit.value}`],
    suggestion: `Investigate what is consuming ${label}. If sustained high usage is confirmed, consider moving to a larger plan.`,
    suggestedTool: 'liara_resize_app',
  };
}

export const resourcesAnalyzer: Analyzer = {
  name: 'resources',
  description: 'CPU / memory pressure from the metrics summary',
  defaultEnabled: true,
  requires: ['metrics'],

  analyze(ctx): Finding[] {
    const metrics = ctx.metrics;

    if (metrics === undefined || metrics === null) {
      return [];
    }

    const findings: Finding[] = [];

    const cpuFinding = check('CPU', metrics, CPU_KEY);
    const memoryFinding = check('Memory', metrics, MEM_KEY);

    if (cpuFinding) findings.push(cpuFinding);
    if (memoryFinding) findings.push(memoryFinding);

    if (findings.length === 0) {
      findings.push({
        analyzer: 'resources',
        id: 'metrics-snapshot',
        severity: 'info',
        basis: 'observed',
        title:
          'Metrics snapshot (no percentage threshold exceeded or percentages unavailable)',
        evidence: [
          truncate(
            JSON.stringify(metrics) ?? String(metrics),
            600,
          ),
        ],
      });
    }

    return findings;
  },
};