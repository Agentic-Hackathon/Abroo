import type { Analyzer, Finding } from '../types.js';

const WARN_PCT = 85;
const CRIT_PCT = 95;

/** Liara's summary CPU is a measurement series, memory is in bytes;
 * neither is a utilization percentage without an explicit capacity. */
function explicitPercent(metrics: Record<string, unknown>, key: string): number | undefined {
  const value = metrics[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return value;
}

export const resourcesAnalyzer: Analyzer = {
  name: 'resources',
  description: 'Conservative resource checks; only compare values whose units are confirmed',
  defaultEnabled: true,
  requires: ['metrics'],
  analyze(ctx): Finding[] {
    if (!ctx.metrics || typeof ctx.metrics !== 'object') return [];
    const metrics = ctx.metrics as Record<string, any>;
    const findings: Finding[] = [];

    for (const [key, name, id] of [
      ['cpuUsagePercent', 'CPU', 'cpu-usage-high'],
      ['memoryUsagePercent', 'Memory', 'memory-usage-high'],
    ] as const) {
      const pct = explicitPercent(metrics, key);
      if (pct === undefined || pct < WARN_PCT) continue;
      findings.push({
        analyzer: 'resources', id, severity: pct >= CRIT_PCT ? 'critical' : 'warning',
        basis: 'observed', title: `${name} utilization ${pct}%`,
        evidence: [`${key}=${pct}%`],
        suggestion: `Check sustained ${name} pressure before changing a resource plan.`,
        suggestedTool: 'liara_get_app_metrics',
      });
    }

    // PaaS summary disksUsage entries have size and usage using the same units.
    if (Array.isArray(metrics.disksUsage)) {
      for (const disk of metrics.disksUsage) {
        const size = Number(disk?.size);
        const used = Number(disk?.usage);
        if (!Number.isFinite(size) || !Number.isFinite(used) || size <= 0 || used < 0) continue;
        const pct = Math.round((used / size) * 1000) / 10;
        if (pct < WARN_PCT) continue;
        const name = typeof disk?.name === 'string' ? disk.name : 'unknown';
        findings.push({
          analyzer: 'resources', id: `disk-utilization-high:${name}`,
          severity: pct >= CRIT_PCT ? 'critical' : 'warning', basis: 'observed',
          title: `Persistent disk ${name} utilization ${pct}%`,
          evidence: [`disk=${name}`, `used=${used}`, `capacity=${size}`, `utilization=${pct}%`],
          suggestion: 'Confirm the disk is attached at the failing path, then decide whether cleanup or expansion is appropriate.',
          suggestedTool: 'liara_list_disks',
        });
      }
    }
    if (!findings.length) {
      findings.push({
        analyzer: 'resources', id: 'metrics-uninterpreted', severity: 'info', basis: 'observed',
        title: 'Resource metrics received; no validated threshold violation',
        evidence: [
          `cpuSeriesCount=${Array.isArray(metrics.cpuUsage) ? metrics.cpuUsage.length : 0}`,
          `memorySeriesCount=${Array.isArray(metrics.memoryUsage) ? metrics.memoryUsage.length : 0}`,
          `diskUsageCount=${Array.isArray(metrics.disksUsage) ? metrics.disksUsage.length : 0}`,
        ],
        suggestion: 'CPU time series and memory bytes alone do not establish percentage utilization or available disk space.',
      });
    }
    return findings;
  },
};
