import type { LiaraClient } from '../handlers/types.js';
import { validateAppName } from '../utils/errors.js';
import { collectContext } from './collector.js';
import { redactDeep } from './redact.js';
import { selectAnalyzers } from './registry.js';
import {
  SEVERITY_ORDER,
  type AnalyzerRun,
  type DiagnoseContext,
  type DiagnoseOptions,
  type DiagnoseReport,
  type Finding,
} from './types.js';

export async function runAnalyzers(
  ctx: DiagnoseContext,
  checks?: string[],
): Promise<{ findings: Finding[]; runs: AnalyzerRun[]; unknown: string[] }> {
  const { selected, unknown } = selectAnalyzers(checks);
  const results = await Promise.all(
    selected.map(async (a): Promise<{ run: AnalyzerRun; findings: Finding[] }> => {
      const t0 = Date.now();
      try {
        const findings = await a.analyze(ctx);
        return { run: { name: a.name, durationMs: Date.now() - t0, findings: findings.length }, findings };
      } catch (e) {
        // one broken analyzer must not break the whole diagnosis
        const error = e instanceof Error ? e.message : String(e);
        return { run: { name: a.name, durationMs: Date.now() - t0, findings: 0, error }, findings: [] };
      }
    }),
  );
  const findings = results
    .flatMap((r) => r.findings)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { findings, runs: results.map((r) => r.run), unknown };
}

export function buildReport(
  ctx: DiagnoseContext,
  findings: Finding[],
  runs: AnalyzerRun[],
  unknown: string[],
  redact: boolean,
): DiagnoseReport {
  const count = (s: Finding['severity']) => findings.filter((f) => f.severity === s).length;
  const critical = count('critical');
  const warning = count('warning');
  const info = count('info');

  const headline =
    critical + warning === 0
      ? 'No problems detected by the rule-based checks.'
      : `${critical} critical, ${warning} warning issue(s) found.`;

  const notes: string[] = [];
  if (critical + warning === 0) {
    notes.push('A clean result does not prove the app is healthy; checks only cover known patterns.');
  }
  if (unknown.length > 0) notes.push(`Unknown checks ignored: ${unknown.join(', ')}`);
  if (Object.keys(ctx.unavailable).length > 0) {
    notes.push('Some data could not be collected; related checks were skipped or limited.');
  }
  notes.push('Findings are evidence for you to explain; verify before applying any suggested change.');

  const report: DiagnoseReport = {
    app: ctx.appName,
    window: { since: ctx.since, from: ctx.sinceDate.toISOString(), to: ctx.now.toISOString() },
    summary: { critical, warning, info, headline },
    findings,
    analyzers: runs,
    unavailableData: ctx.unavailable,
    notes,
  };
  return redact ? redactDeep(report) : report;
}

export async function diagnoseApp(client: LiaraClient, opts: DiagnoseOptions): Promise<DiagnoseReport> {
  validateAppName(opts.appName);
  const ctx = await collectContext(client, opts.appName, opts.since);
  const { findings, runs, unknown } = await runAnalyzers(ctx, opts.checks);
  return buildReport(ctx, findings, runs, unknown, opts.redact !== false);
}
