import type { Analyzer, Finding } from '../types.js';
import { ERROR_LINE } from '../util.js';

const FAILED = /(fail|error|cancel)/i;
const GOOD = /(success|succeeded|deployed|active|running|ready)/i;

const releaseId = (r: Record<string, any>) => String(r.releaseID ?? r._id ?? r.id ?? 'unknown');
const releaseTime = (r: Record<string, any>) => {
  const t = Date.parse(String(r.createdAt ?? ''));
  return Number.isNaN(t) ? 0 : t;
};

export const deploymentAnalyzer: Analyzer = {
  name: 'deployment',
  description: 'Latest release state and correlation of errors with a recent release',
  defaultEnabled: true,
  analyze(ctx) {
    if (ctx.releases.length === 0) return [];
    const sorted = [...ctx.releases].sort((a, b) => releaseTime(b) - releaseTime(a));
    const latest = sorted[0];
    const previousGood = sorted.slice(1).find((r) => GOOD.test(String(r.status ?? '')));
    const findings: Finding[] = [];

    const status = String(latest.status ?? '');
    if (status && FAILED.test(status)) {
      findings.push({
        analyzer: 'deployment',
        severity: 'critical',
        title: `Latest release failed (status: ${status})`,
        evidence: [`release=${releaseId(latest)}`, `createdAt=${latest.createdAt ?? 'n/a'}`]
          .concat(previousGood ? [`lastGoodRelease=${releaseId(previousGood)}`] : []),
        suggestion: previousGood
          ? 'Roll back to the last good release while you fix the build.'
          : 'Check the build logs and redeploy.',
        suggestedTool: previousGood ? 'liara_rollback_release' : undefined,
      });
      return findings;
    }

    const errorCount = ctx.logs.filter((l) => ERROR_LINE.test(l)).length;
    if (releaseTime(latest) >= ctx.sinceDate.getTime() && errorCount >= 3) {
      findings.push({
        analyzer: 'deployment',
        severity: 'warning',
        title: `${errorCount} error lines since a release created inside the window`,
        evidence: [`release=${releaseId(latest)}`, `createdAt=${latest.createdAt}`]
          .concat(previousGood ? [`previousGoodRelease=${releaseId(previousGood)}`] : []),
        suggestion: 'Errors may have started with this release. Compare behaviour before/after; roll back if confirmed.',
        suggestedTool: previousGood ? 'liara_rollback_release' : 'liara_list_releases',
      });
    }
    return findings;
  },
};
