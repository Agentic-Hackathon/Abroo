import type { Analyzer, Finding } from '../types.js';

const BAD_STATUS = /(stop|error|fail|crash|suspend|disabled|down|terminat)/i;

export const statusAnalyzer: Analyzer = {
  name: 'status',
  description: 'App state: stopped/failed status, read-only mode',
  defaultEnabled: true,
  analyze(ctx) {
    const app = ctx.app;
    if (!app) return [];
    const findings: Finding[] = [];

    const status = String(app.status ?? app.state ?? '').trim();
    if (status && BAD_STATUS.test(status)) {
      findings.push({
        analyzer: 'status',
        severity: 'critical',
        title: `App is not running (status: ${status})`,
        evidence: [`status=${status}`],
        suggestion: 'Start or restart the app, then re-run the diagnosis and check the logs.',
        suggestedTool: /stop/i.test(status) ? 'liara_start_app' : 'liara_restart_app',
      });
    }

    if (app.readOnly === true || app.isReadOnly === true) {
      findings.push({
        analyzer: 'status',
        severity: 'warning',
        title: 'App is in read-only mode',
        evidence: ['readOnly=true'],
        suggestion: 'Writes to the filesystem will fail. Disable read-only mode if the app needs to write.',
        suggestedTool: 'liara_set_read_only',
      });
    }
    return findings;
  },
};
