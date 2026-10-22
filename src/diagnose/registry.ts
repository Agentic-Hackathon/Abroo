import type { Analyzer } from './types.js';
import { statusAnalyzer } from './analyzers/status.js';
import { resourcesAnalyzer } from './analyzers/resources.js';
import { logsAnalyzer } from './analyzers/logs.js';
import { deploymentAnalyzer } from './analyzers/deployment.js';
import { configAnalyzer } from './analyzers/config.js';

/** Add a new analyzer by creating a file and appending it here (cf. k8sgpt filters). */
export const ANALYZERS: Analyzer[] = [
  statusAnalyzer,
  resourcesAnalyzer,
  logsAnalyzer,
  deploymentAnalyzer,
  configAnalyzer,
];

export const CHECK_NAMES = ANALYZERS.map((a) => a.name);

export function selectAnalyzers(checks?: string[]): { selected: Analyzer[]; unknown: string[] } {
  if (!checks || checks.length === 0) {
    return { selected: ANALYZERS.filter((a) => a.defaultEnabled), unknown: [] };
  }
  const wanted = new Set(checks.map((c) => c.trim().toLowerCase()));
  const selected = ANALYZERS.filter((a) => wanted.has(a.name));
  const unknown = [...wanted].filter((w) => !CHECK_NAMES.includes(w));
  return { selected, unknown };
}
