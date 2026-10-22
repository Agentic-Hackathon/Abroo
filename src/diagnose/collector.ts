import type { LiaraClient } from '../handlers/types.js';
import { getAppMetrics, getAppLogs } from '../services/observability.js';
import type { DiagnoseContext, EnvVar } from './types.js';
import { logLine, parseSince, toArray } from './util.js';

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Collects all data ONCE, in parallel. A failing endpoint only marks that dataset
 * as unavailable; it never aborts the diagnosis.
 *
 * VERIFY: endpoints marked below are best guesses based on the other services
 * (e.g. get_release uses /v2/projects/{app}/releases/{id}). If you already have
 * getApp()/listReleases() in services/, call those instead.
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
  getAppLogs(client, appName, { since: String(sinceSec) }),
  client.get<unknown>(`/v1/projects/${appName}/releases`, { page: 1, count: 10 }),
]);
  const unavailable: Record<string, string> = {};
  const ok = <T>(name: string, r: PromiseSettledResult<T>): T | undefined => {
    if (r.status === 'fulfilled') return r.value;
    unavailable[name] = reason(r.reason);
    return undefined;
  };

  const app = ok('app', appR);
  const metrics = ok('metrics', metricsR);
  const logsRaw = ok('logs', logsR);
  const releasesRaw = ok('releases', releasesR);

  // Plan (needs app first). VERIFY the field names that hold the plan id.
  let plan: Record<string, any> | undefined;
  const planId = app?.planID ?? app?.planId ?? app?.plan?._id ?? (typeof app?.plan === 'string' ? app.plan : undefined);
  if (planId) {
    try {
      plan = await client.get<Record<string, any>>(`/v1/plans/${planId}`);
    } catch (e) {
      unavailable.plan = reason(e);
    }
  }

  // Env vars: VERIFY where they live on the app object.
  const rawEnvs = app?.envs ?? app?.envVars ?? app?.environmentVariables ?? [];
  const envs: EnvVar[] = Array.isArray(rawEnvs)
    ? rawEnvs
        .filter((e: any) => e && typeof e.key === 'string')
        .map((e: any) => ({ key: e.key, value: e.value === undefined ? undefined : String(e.value) }))
    : [];

  return {
    appName,
    since: since ?? '1h',
    sinceDate,
    now,
    app,
    plan,
    metrics,
    logs: toArray(logsRaw).map(logLine),
    releases: toArray(releasesRaw),
    envs,
    unavailable,
  };
}
