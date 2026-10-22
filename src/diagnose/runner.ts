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
  type Overall,
} from './types.js';

export async function runAnalyzers(
  ctx: DiagnoseContext,
  checks?: string[],
): Promise<{
  findings: Finding[];
  runs: AnalyzerRun[];
  unknown: string[];
}> {
  const { selected, unknown } = selectAnalyzers(checks);

  const results = await Promise.all(
    selected.map(
      async (
        analyzer,
      ): Promise<{ run: AnalyzerRun; findings: Finding[] }> => {
        const startedAt = Date.now();

        // Skip analyzers whose required datasets are unavailable.
        const unavailableRequirements =
          analyzer.requires?.filter(
            (dataset) => ctx.unavailable[dataset] !== undefined,
          ) ?? [];

        if (unavailableRequirements.length > 0) {
          return {
            run: {
              name: analyzer.name,
              status: 'unavailable',
              durationMs: Date.now() - startedAt,
              findings: 0,
            },
            findings: [],
          };
        }

        try {
          const findings = await analyzer.analyze(ctx);

          return {
            run: {
              name: analyzer.name,
              status: 'ok',
              durationMs: Date.now() - startedAt,
              findings: findings.length,
            },
            findings,
          };
        } catch (error) {
          // A failed analyzer must not interrupt the diagnosis.
          const message =
            error instanceof Error ? error.message : String(error);

          return {
            run: {
              name: analyzer.name,
              status: 'error',
              durationMs: Date.now() - startedAt,
              findings: 0,
              error: message,
            },
            findings: [],
          };
        }
      },
    ),
  );

  const findings = results
    .flatMap((result) => result.findings)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

  return {
    findings,
    runs: results.map((result) => result.run),
    unknown,
  };
}

export function buildReport(
  ctx: DiagnoseContext,
  findings: Finding[],
  runs: AnalyzerRun[],
  unknown: string[],
  _redact: boolean,
): DiagnoseReport {
  const count = (severity: Finding['severity']) =>
    findings.filter((finding) => finding.severity === severity).length;

  const critical = count('critical');
  const warning = count('warning');
  const info = count('info');

  const hasUnavailableData =
    Object.keys(ctx.unavailable).length > 0;

  const hasAnalyzerErrors = runs.some(
    (run) => run.status === 'error',
  );

  const hasUnavailableAnalyzers = runs.some(
    (run) => run.status === 'unavailable',
  );

  // Never report healthy when required data was unavailable
  // or when no analyzer completed successfully.
  let overall: Overall;

  if (critical > 0) {
    overall = 'critical';
  } else if (
    warning > 0 ||
    hasAnalyzerErrors ||
    hasUnavailableAnalyzers ||
    hasUnavailableData
  ) {
    overall = 'degraded';
  } else if (runs.some((run) => run.status === 'ok')) {
    overall = 'healthy';
  } else {
    overall = 'unknown';
  }

  const headline =
    critical + warning === 0
      ? overall === 'healthy'
        ? 'No problems detected by the rule-based checks.'
        : overall === 'unknown'
          ? 'Diagnosis could not establish the app status.'
          : 'No critical or warning findings detected, but diagnosis was incomplete.'
      : `${critical} critical, ${warning} warning issue(s) found.`;

  const notes: string[] = [];

  if (critical + warning === 0) {
    notes.push(
      'A clean result does not prove the app is healthy; checks only cover known patterns.',
    );
  }

  if (unknown.length > 0) {
    notes.push(`Unknown checks ignored: ${unknown.join(', ')}`);
  }

  if (hasUnavailableData) {
    notes.push(
      'Some data could not be collected; related checks were skipped or limited.',
    );
  }

  if (hasUnavailableAnalyzers) {
    notes.push(
      'Some analyzers were skipped because their required datasets were unavailable.',
    );
  }

  if (hasAnalyzerErrors) {
    notes.push(
      'One or more analyzers failed. Review analyzer run errors before interpreting the report.',
    );
  }

  notes.push(
    'Log counts refer to sampled lines, not necessarily all events in the full look-back period.',
  );
  notes.push(
    'Metrics without known units or capacity are not treated as CPU/RAM utilization percentages.',
  );
  notes.push(
    'Findings are evidence for you to explain; verify before applying any suggested change.',
  );

  const report: DiagnoseReport = {
    app: ctx.appName,
    window: {
      since: ctx.since,
      from: ctx.sinceDate.toISOString(),
      to: ctx.now.toISOString(),
    },
    summary: {
      overall,
      critical,
      warning,
      info,
      headline,
    },
    findings,
    analyzers: runs,
    ...(ctx.logSampling
      ? { sampling: ctx.logSampling }
      : {}),
    unavailableData: ctx.unavailable,
    notes,
  };

  // Secrets must not leak even if a client requests redact=false.
  // Output is always redacted as part of the tool's security contract.
  return redactDeep(report);
}

export async function diagnoseApp(
  client: LiaraClient,
  opts: DiagnoseOptions,
): Promise<DiagnoseReport> {
  validateAppName(opts.appName);

  const ctx = await collectContext(
    client,
    opts.appName,
    opts.since,
  );

  const { findings, runs, unknown } = await runAnalyzers(
    ctx,
    opts.checks,
  );

  return buildReport(
    ctx,
    findings,
    runs,
    unknown,
    true,
  );
}
