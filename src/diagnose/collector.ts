import type { LiaraClient } from '../handlers/types.js';
import { getAppMetrics, getAppLogs } from '../services/observability.js';
import type { DatasetName, DiagnoseContext, EnvVar, LogLine } from './types.js';
import { parseSince } from './util.js';

const LOG_LIMIT = 500;
const RELEASES_COUNT = 50;   // اگر API مقدار بزرگ را رد کرد، به 10 برگردان

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Verified against the real API:
 *  - GET /v1/projects/{app}            → { project: {...} }
 *  - GET /v1/projects/{app}/releases   → { total, currentRelease, readyReleasesCount, releases: [...] }
 *  - logs: v2 (inside getAppLogs); teamID is added by LiaraClient
 * Still unverified: getAppMetrics endpoints, /v1/plans/{id}.
 */
export async function collectContext(
  client: LiaraClient,
  appName: string,
  since?: string,
): Promise<DiagnoseContext> {
  const now = new Date();
  const windowMs = parseSince(since);
  const sinceDate = new Date(now.getTime() - windowMs);
  const sinceSec = Math.floor(sinceDate.getTime() / 1000);

  const [appR, metricsR, logsR, releasesR] = await Promise.allSettled([
    client.get<Record<string, any>>(`/v1/projects/${appName}`),
    getAppMetrics(client, appName),
    getAppLogs(client, appName, { since: sinceSec, limit: LOG_LIMIT }),
    client.get<Record<string, any>>(`/v1/projects/${appName}/releases`, { page: 1, count: RELEASES_COUNT }),
  ]);

  const unavailable: Partial<Record<DatasetName, string>> = {};
  const ok = <T>(name: DatasetName, r: PromiseSettledResult<T>): T | undefined => {
    if (r.status === 'fulfilled') return r.value;
    unavailable[name] = reason(r.reason);
    return undefined;
  };

  // ── app: unwrap { project }, و envs را از آبجکت جدا کن
  const appRaw = ok('app', appR);
  const project: Record<string, any> | undefined = appRaw?.project ?? appRaw;
  if (appRaw && !project) unavailable.app = 'unexpected response shape';
  const { envs: rawEnvs, ...appSafe } = (project ?? {}) as Record<string, any>;

  const envs: EnvVar[] = Array.isArray(rawEnvs)
    ? rawEnvs
        .filter((e: any) => e && typeof e.key === 'string')
        .map((e: any) => ({ key: e.key, value: e.value === undefined ? undefined : String(e.value) }))
    : [];

  // ── plan (بعد از app)
  let plan: Record<string, any> | undefined;
  const planId = project?.planID ?? project?.planId ?? project?.plan?._id ?? (typeof project?.plan === 'string' ? project.plan : undefined);
  if (planId) {
    try {
      plan = await client.get<Record<string, any>>(`/v1/plans/${planId}`);
    } catch (e) {
      unavailable.plan = reason(e);
    }
  }

  // ── releases: آبجکت → آرایه + currentRelease + نگاشت id→tag
  const relRaw = ok('releases', releasesR);
  const releases: Array<Record<string, any>> = Array.isArray(relRaw) ? relRaw : (relRaw?.releases ?? []);
  const currentReleaseId: string | undefined = Array.isArray(relRaw) ? undefined : relRaw?.currentRelease;
  const releaseTags: Record<string, string> = Object.fromEntries(
    releases.filter((r) => r?._id && r?.tag).map((r) => [r._id, String(r.tag)]),   // VERIFY: نام فیلد tag را در پاسخ واقعی چک کن
  );

  // ── logs: ساختاریافته نگه دار (نه رشته)
  const logsRaw = ok('logs', logsR);
  let logs: LogLine[] = [];
  if (logsRaw !== undefined) {
    if (Array.isArray(logsRaw)) {
      logs = logsRaw.map((l: any) => ({
        timestamp: l.timestamp ?? l.datetime ?? '',
        message: String(l.message ?? ''),
        source: l.source ?? l.type,
        releaseId: l.releaseId,
      }));
    } else {
      unavailable.logs = 'unexpected response shape';
    }
  }

  return {
    appName,
    since: since ?? '1h',
    sinceDate,
    now,
    app: Object.keys(appSafe).length ? appSafe : undefined,
    plan,
    metrics: ok('metrics', metricsR),
    logs,
    logSampling: {
      lines: logs.length,
      from: logs[0]?.timestamp,
      to: logs.at(-1)?.timestamp,
      limit: LOG_LIMIT,
      truncated: logs.length >= LOG_LIMIT,
    },
    releases,
    currentReleaseId,
    releaseTags,
    envs,
    unavailable,
  };
}