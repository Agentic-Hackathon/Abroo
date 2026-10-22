import type { Analyzer, Finding } from '../types.js';
import { findMetric, truncate } from '../util.js';

const WARN_PCT = 85;
const CRIT_PCT = 95;

/**
 * ADAPT HERE: if the real MetricsSummary uses different key names, change these
 * two patterns. We only raise warnings for keys that are explicitly percentages;
 * otherwise we attach the raw snapshot as info so the LLM can interpret it.
 */
const CPU_KEY = /cpu/i;
const MEM_KEY = /(mem|ram)/i;
const PCT_KEY = /(percent|pct|util)/i;

function check(label: string, metrics: unknown, keyRe: RegExp): Finding | undefined {
  const hit = findMetric(metrics, new RegExp(`(?=.*${keyRe.source})(?=.*${PCT_KEY.source})`, 'i'));
  if (!hit || hit.value < WARN_PCT) return undefined;
  return {
    analyzer: 'resources',
    severity: hit.value >= CRIT_PCT ? 'critical' : 'warning',
    title: `${label} usage is high (${hit.value}%)`,
    evidence: [`${hit.key}=${hit.value}`],
    suggestion: `Consider moving to a larger plan, or investigate what is consuming ${label}.`,
    suggestedTool: 'liara_resize_app',
  };
}

export const resourcesAnalyzer: Analyzer = {
  name: 'resources',
  description: 'CPU / memory pressure from the metrics summary',
  defaultEnabled: true,
  analyze(ctx) {
    if (ctx.metrics === undefined || ctx.metrics === null) return [];
    const findings = [check('CPU', ctx.metrics, CPU_KEY), check('Memory', ctx.metrics, MEM_KEY)].filter(
      (f): f is Finding => !!f,
    );
    if (findings.length === 0) {
      findings.push({
        analyzer: 'resources',
        severity: 'info',
        title: 'Metrics snapshot (no percentage threshold exceeded or percentages unavailable)',
        evidence: [truncate(JSON.stringify(ctx.metrics), 600)],
      });
    }
    return findings;
  },
};
