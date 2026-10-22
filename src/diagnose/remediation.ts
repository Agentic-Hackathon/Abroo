/**
 * Explicit consent workflow. Diagnose / options / prepare are READ ONLY.
 * Apply is the only mutating operation and requires the exact preview phrase.
 * No guessed credentials, automatic rollback or deletion. Disk resizing only after verification and approval.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { LiaraClient } from '../handlers/types.js';
import { validateAppName, validateEnvKey } from '../utils/errors.js';
import { diagnoseApp } from './runner.js';
import type { Finding } from './types.js';
import * as apps from '../services/apps.js';
import * as envService from '../services/environment.js';

const TTL_MS = 10 * 60_000;
const MAX_PENDING = 100;
type Action = 'start_app' | 'restart_app' | 'update_env' | 'resize_disk';
interface Option { id: Action; title: string; mode: 'automatic-after-approval'; requiredInput: string[]; warning: string; }
interface Intent {
  id: string; appName: string; findingId: string; action: Action;
  params: Record<string, unknown>; created: number; projectState: string;
  diskSize?: number;
  envFingerprint?: string;
  inProgress: boolean;
}
const pending = new Map<string, Intent>();

function projectState(project: any): string {
  const p = project?.project ?? project ?? {};
  // no secrets in snapshot; limit to resource identity and observable state
  return JSON.stringify([p._id, p.project_id, p.status, p.scale, p.isDeployed]);
}
function option(action: Action, title: string, requiredInput: string[], warning: string): Option {
  return { id: action, title, mode: 'automatic-after-approval', requiredInput, warning };
}
export function optionsForFinding(f: Finding): Option[] {
  switch (f.id) {
    case 'app-not-running': return [
      option('start_app', 'Start the stopped application', [], 'May incur usage costs.'),
      option('restart_app', 'Restart the application', [], 'Brief service interruption is possible.'),
    ];
    case 'important-env-empty': case 'env-placeholder-values': case 'db-auth':
    case 'conn-refused': case 'dns': return [
      option('update_env', 'Replace specified app environment settings', ['variables: [{key,value}]'],
        'Root cause is not proven by logs. Requires user-provided correct values; existing unrelated variables are preserved.'),
    ];
    case 'disk-full': case 'disk-utilization-high': return [
      option('resize_disk', 'Increase verified persistent disk capacity', ['diskName', 'newSize', 'confirmedMount=true'],
        'An ENOSPC log alone does NOT identify which filesystem is full. First verify the affected path, disk and current disk capacity. Capacity changes may cost money.'),
    ];
    default: return [];
  }
}

export async function remediationOptions(client: LiaraClient, appName: string, since?: string) {
  const report = await diagnoseApp(client, { appName, since });
  return {
    app: appName, reportSummary: report.summary,
    options: report.findings.map(f => ({ findingId: f.id, severity: f.severity, basis: f.basis,
      title: f.title, evidence: f.evidence, suggestions: f.suggestion,
      actions: optionsForFinding(f) })),
    instructions: 'Choose one action. Inspect relevant resources and supply correct parameters. Then prepare and show the preview to the user. Apply only after explicit approval.',
  };
}

function validatedParams(action: Action, params: Record<string, unknown>): Record<string, unknown> {
  if (action === 'update_env') {
    if (!Array.isArray(params.variables) || !params.variables.length || params.variables.length > 30)
      throw new Error('Provide 1–30 explicit {key,value} environment variable pairs.');
    const variables = params.variables.map((item: any) => {
      if (!item || typeof item.key !== 'string' || typeof item.value !== 'string')
        throw new Error('Every variable must contain a string key and a string value.');
      validateEnvKey(item.key);
      if (!item.value.trim()) throw new Error(`Value for ${item.key} cannot be empty.`);
      return { key: item.key, value: item.value };
    });
    if (new Set(variables.map(v => v.key)).size !== variables.length) throw new Error('Duplicate env keys');
    return { variables };
  }
  if (action === 'resize_disk') {
    if (typeof params.diskName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(params.diskName))
      throw new Error('Provide the exact diskName from liara_list_disks.');
    if (typeof params.newSize !== 'number' || !Number.isSafeInteger(params.newSize) || params.newSize <= 0)
      throw new Error('newSize must be a positive integer in the units expected by the Liara API.');
    if (params.confirmedMount !== true)
      throw new Error('Before preparing disk resize, user must confirm the affected path belongs to this named persistent disk.');
    return { diskName: params.diskName, newSize: params.newSize, confirmedMount: true };
  }
  if (Object.keys(params).length) throw new Error(`Action ${action} takes no parameters.`);
  return {};
}

async function checkedCurrentEnvs(client: LiaraClient, app: string): Promise<{envs:Array<{key:string;value:string}>; fingerprint:string}> {
  const raw = await client.get<any>(`/v1/projects/${app}`);
  const p = raw?.project ?? raw;
  if (!p || !Array.isArray(p.envs))
    throw new Error('App environment is not accessible in the documented project.envs response. Refusing a potentially destructive update.');
  const envs: Array<{key:string;value:string}> = p.envs.map((v: any) => {
    if (!v || typeof v.key !== 'string' || typeof v.value !== 'string')
      throw new Error('An existing variable has an unreadable value; refusing full-list overwrite.');
    if (v.encrypted === true && (!v.value || /\*\*\*|REDACTED|\[hidden\]/i.test(v.value)))
      throw new Error('Existing encrypted environment value is masked. Cannot safely preserve it on a full replacement.');
    return { key: v.key as string, value: v.value as string };
  });
  // No secret values are returned to the MCP agent. Digest stays only in memory.
  const fingerprint = createHash('sha256').update(JSON.stringify(envs)).digest('hex');
  return { envs, fingerprint };
}

async function diskDetails(client: LiaraClient, app: string, name: string) {
  const raw = await client.get<any>(`/v1/projects/${app}/disks`);
  const disks = Array.isArray(raw?.disks) ? raw.disks : [];
  const disk = disks.find((d: any) => d.name === name);
  if (!disk || !Number.isFinite(Number(disk.size))) throw new Error('Disk not present in documented disk list or has unknown capacity.');
  return { size: Number(disk.size), mounts: Array.isArray(raw.mounts) ? raw.mounts : [] };
}

export async function prepareRemediation(client: LiaraClient, input: {
  appName: string; findingId: string; action: Action; params?: Record<string, unknown>; since?: string;
}) {
  validateAppName(input.appName);
  if (!input.findingId || typeof input.findingId !== 'string') throw new Error('A diagnosed finding ID is required.');
  const report = await diagnoseApp(client, { appName: input.appName, since: input.since });
  const finding = report.findings.find(f => f.id === input.findingId);
  if (!finding) throw new Error('The selected finding is not present in the latest diagnosis; run diagnose again.');
  const selected = optionsForFinding(finding).find(o => o.id === input.action);
  if (!selected) throw new Error('Requested action is not an approved option for this finding.');
  const params = validatedParams(input.action, input.params ?? {});
  const project = await client.get<any>(`/v1/projects/${input.appName}`);
  let diskSize: number | undefined;
  let envFingerprint: string | undefined;
  if (input.action === 'update_env') envFingerprint = (await checkedCurrentEnvs(client, input.appName)).fingerprint;
  if (input.action === 'resize_disk') {
    const details = await diskDetails(client, input.appName, params.diskName as string);
    diskSize = details.size;
    if ((params.newSize as number) <= diskSize)
      throw new Error(`newSize must exceed current size (${diskSize}).`);
    // The user must separately verify that the failing path is mounted on this disk.
  }
  const id = randomUUID();
  const now = Date.now();
  for (const [key, val] of pending) if (now - val.created > TTL_MS) pending.delete(key);
  if (pending.size >= MAX_PENDING) throw new Error('Too many pending actions; try again later.');
  pending.set(id, { id, appName: input.appName, findingId: input.findingId, action: input.action,
    params, projectState: projectState(project), diskSize, envFingerprint, created: now, inProgress: false });
  return {
    planId: id, expiresAt: new Date(now + TTL_MS).toISOString(), app: input.appName,
    finding: { id: finding.id, title: finding.title, evidence: finding.evidence },
    action: input.action,
    parameters: input.action === 'update_env'
      ? { keys: (params.variables as Array<{key:string}>).map(v => v.key), values: '[WITHHELD]' }
      : params,
    previousDiskSize: diskSize,
    impact: selected.warning, confirmationPhrase: `APPLY ${input.appName} ${id}`,
    message: 'Read-only preview. Show this preview to the user; do not call apply without their explicit consent for this specific action.',
  };
}

export async function applyRemediation(client: LiaraClient, planId: string, confirmation: string) {
  const plan = pending.get(planId);
  if (!plan) throw new Error('Plan not found or already used. Prepare again.');
  if (plan.inProgress) throw new Error('This plan is already being applied.');
  if (Date.now() - plan.created > TTL_MS) { pending.delete(planId); throw new Error('Plan expired. Prepare again.'); }
  if (confirmation !== `APPLY ${plan.appName} ${plan.id}`) throw new Error('Exact confirmationPhrase is required after explicit user approval.');
  plan.inProgress = true;
  try {
    const project = await client.get<any>(`/v1/projects/${plan.appName}`);
    if (projectState(project) !== plan.projectState) throw new Error('App state changed since preview; prepare again.');
    if (plan.action === 'resize_disk') {
      const disk = await diskDetails(client, plan.appName, plan.params.diskName as string);
      if (disk.size !== plan.diskSize) throw new Error('Disk size changed since preview; prepare again.');
      await client.post(`/v1/projects/${plan.appName}/disks/${plan.params.diskName}/resize`,
        { size: String(plan.params.newSize) });
    } else if (plan.action === 'update_env') {
      // The API replaces the full environment collection; preserve all unrelated keys.
      // Never print any current or new secret values in the output.
      const current = await checkedCurrentEnvs(client, plan.appName);
      if (current.fingerprint !== plan.envFingerprint) throw new Error('Environment changed since preview; prepare again.');
      const variables = new Map(current.envs.map(v => [v.key, v.value]));
      for (const varItem of plan.params.variables as Array<{key:string;value:string}>) variables.set(varItem.key, varItem.value);
      await envService.updateEnvVars(client, plan.appName,
        [...variables].map(([key, value]) => ({ key, value })));
    } else if (plan.action === 'start_app') {
      await apps.startApp(client, plan.appName);
    } else if (plan.action === 'restart_app') {
      await apps.restartApp(client, plan.appName);
    }
    pending.delete(planId);
    return { success: true, app: plan.appName, action: plan.action,
      message: 'Liara API accepted the requested mutation; operational recovery is not yet verified.',
      nextStep: 'Run liara_diagnose_app again and check deployment status/logs. A further restart may be required for environment changes.' };
  } catch (e) {
    // one-shot token: prevents ambiguous retry after a network timeout/partial write
    pending.delete(planId);
    throw e;
  }
}
