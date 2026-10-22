
import type { Analyzer, Finding } from '../types.js';
import { ERROR_LINE } from '../util.js';

const FAILED = /\b(fail(?:ed|ure)?|error|cancel(?:led|ed)?|crash(?:ed)?)\b/i;
const GOOD = /\b(success(?:ful)?|succeeded|deployed|active|running|ready)\b/i;

type ReleaseRecord = {
  releaseID?: string;
  _id?: string;
  id?: string;
  createdAt?: string | number | Date;
  state?: string;
  status?: string;
};

function releaseId(release: ReleaseRecord): string {
  return String(
    release.releaseID ?? release._id ?? release.id ?? 'unknown',
  );
}

function releaseTime(release: ReleaseRecord): number {
  const raw = release.createdAt;

  if (raw === undefined || raw === null) return 0;

  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export const deploymentAnalyzer: Analyzer = {
  name: 'deployment',
  description:
    'Latest release state and correlation of errors with a recent release',
  defaultEnabled: true,
  requires: ['releases', 'logs'],

  analyze(ctx): Finding[] {
    if (ctx.releases.length === 0) return [];

    const sorted = [...ctx.releases].sort(
      (a, b) => releaseTime(b) - releaseTime(a),
    );

    const latest = sorted[0];
    if (!latest) return [];

    const previousGood = sorted
      .slice(1)
      .find((release) => GOOD.test(String(release.state ?? release.status ?? '')));

    const findings: Finding[] = [];
    const status = String(latest.state ?? latest.status ?? '');
    const normalStatus = status.replace(/[_-]/g, ' ');
    const latestId = releaseId(latest);
    const createdAt = latest.createdAt
      ? String(latest.createdAt)
      : 'n/a';

    if (status && FAILED.test(normalStatus)) {
      findings.push({
        analyzer: 'deployment',
        id: 'latest-release-failed',
        severity: 'critical',
        basis: 'observed',
        title: `Latest release failed (status: ${status})`,
        evidence: [
          `release=${latestId}`,
          `createdAt=${createdAt}`,
          ...(previousGood
            ? [`lastGoodRelease=${releaseId(previousGood)}`]
            : []),
        ],
        suggestion: previousGood
          ? 'Inspect failed build logs and compare with the last known-good release. Rollback requires a verified supported procedure and separate approval.'
          : 'Inspect the build and deployment logs, fix the cause, and redeploy.',
        suggestedTool: 'liara_list_releases',
      });

      return findings;
    }

    const latestReleaseTime = releaseTime(latest);
    const sinceTime = ctx.sinceDate.getTime();

    const errorLines = ctx.logs.filter((line) =>
      ERROR_LINE.test(line.message),
    );

    if (
      latestReleaseTime > 0 &&
      latestReleaseTime >= sinceTime &&
      errorLines.length >= 3
    ) {
      findings.push({
        analyzer: 'deployment',
        id: 'errors-after-release',
        severity: 'warning',
        basis: 'hypothesis',
        title: `${errorLines.length} error-like log lines found during a window containing a recent release`,
        evidence: [
          `release=${latestId}`,
          `createdAt=${createdAt}`,
          ...(previousGood
            ? [`previousGoodRelease=${releaseId(previousGood)}`]
            : []),
          ...errorLines
            .slice(0, 3)
            .map((line) => line.message.slice(0, 200)),
        ],
        stats: {
          count: errorLines.length,
          firstSeen: errorLines[0]?.timestamp,
          lastSeen: errorLines[errorLines.length - 1]?.timestamp,
        },
        suggestion:
          'The errors may be related to this release, but timing alone does not prove causation. Compare logs and behavior before and after deployment.',
        suggestedTool: 'liara_list_releases',
      });
    }

    return findings;
  },
};
