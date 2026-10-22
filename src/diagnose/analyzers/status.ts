import type { Analyzer, Finding } from '../types.js';

const BAD_STATUS =
  /\b(stop(?:ped)?|error|fail(?:ed|ure)?|crash(?:ed)?|suspend(?:ed)?|disabled|down|terminat(?:ed|ing)?)\b/i;

export const statusAnalyzer: Analyzer = {
  name: 'status',
  description: 'App state: stopped/failed status, read-only mode',
  defaultEnabled: true,
  requires: ['app'],

  analyze(ctx): Finding[] {
    const app = ctx.app;
    if (!app) return [];

    const findings: Finding[] = [];

    const rawStatus = app.status ?? app.state;
    const status =
      typeof rawStatus === 'string' ? rawStatus.trim() : '';

    if (status && BAD_STATUS.test(status)) {
      const isStopped = /\bstop(?:ped)?\b/i.test(status);

      findings.push({
        analyzer: 'status',
        id: 'app-not-running',
        severity: 'critical',
        basis: 'observed',
        title: `App is not running (status: ${status})`,
        evidence: [`status=${status}`],
        suggestion:
          'Verify the current app status, then start or restart the app if appropriate. Re-run the diagnosis and inspect the logs.',
        suggestedTool: isStopped
          ? 'liara_start_app'
          : 'liara_restart_app',
      });
    }

    if (app.readOnly === true || app.isReadOnly === true) {
      findings.push({
        analyzer: 'status',
        id: 'app-read-only',
        severity: 'warning',
        basis: 'observed',
        title: 'App is in read-only mode',
        evidence: ['readOnly=true'],
        suggestion:
          'If the app needs to write to its filesystem, verify the deployment requirements and disable read-only mode if appropriate.',
        suggestedTool: 'liara_set_read_only',
      });
    }

    return findings;
  },
};