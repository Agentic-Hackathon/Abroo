import { LiaraClient } from '../api/client.js';
import {
    Project,
    CreateProjectRequest,
    ProjectDetails,
    Platform,
    PaginationOptions,
    paginationToParams,
} from '../api/types.js';
import { validateAppName, validateRequired, unwrapApiResponse } from '../utils/errors.js';
import { resolveProvisioning } from './project-provisioning.js';

/**
 * List all apps/projects
 */
export async function listApps(
    client: LiaraClient,
    pagination?: PaginationOptions
): Promise<Project[]> {
    const params = paginationToParams(pagination);
    const response = await client.get<any>('/v1/projects', params);
    return unwrapApiResponse<Project[]>(response, ['projects', 'data', 'items']);
}

/**
 * Get details of a specific app
 */
export async function getApp(
    client: LiaraClient,
    name: string
): Promise<ProjectDetails> {
    validateAppName(name);
    try {
        return await client.get<ProjectDetails>(`/v1/projects/${name}`);
    } catch (error: unknown) {
        const err = error as { statusCode?: number; message?: string };
        if (err.statusCode === 404) {
            const { LiaraMcpError } = await import('../utils/errors.js');
            throw new LiaraMcpError(
                `App "${name}" not found`,
                'APP_NOT_FOUND',
                { name },
                [
                    'Check if the app name is correct',
                    'Use liara_list_apps to see all available apps',
                    'Verify you have access to this app'
                ]
            );
        }
        throw error;
    }
}

/**
 * Create a new app
 */
export async function createApp(
    client: LiaraClient,
    request: CreateProjectRequest
): Promise<Project> {
    validateAppName(request.name);
    validateRequired(request.platform, 'Platform');
    validateRequired(request.planID, 'Plan ID');
    const chosen = await resolveProvisioning(client, request);
    // Only the documented create payload; `region` is not accepted by this endpoint.
    return await client.post<Project>('/v1/projects', {
        name: request.name, platform: request.platform, planID: chosen.planID,
        bundlePlanID: chosen.bundlePlanID, network: chosen.network,
        ...(request.readOnlyRootFilesystem !== undefined ? {readOnlyRootFilesystem:request.readOnlyRootFilesystem} : {}),
    });
}

/**
 * Delete an app
 */
export async function deleteApp(
    client: LiaraClient,
    name: string
): Promise<void> {
    validateAppName(name);
    await client.delete(`/v1/projects/${name}`);
}

/**
 * Start an app (scale up to 1)
 */
export async function startApp(
    client: LiaraClient,
    name: string
): Promise<void> {
    validateAppName(name);
    await client.post(`/v1/projects/${name}/actions/scale`, { scale: 1 });
}

/**
 * Stop an app (scale down to 0)
 */
export async function stopApp(
    client: LiaraClient,
    name: string
): Promise<void> {
    validateAppName(name);
    await client.post(`/v1/projects/${name}/actions/scale`, { scale: 0 });
}

/**
 * Scale an app to a specific number of replicas
 */
export async function scaleApp(
    client: LiaraClient,
    name: string,
    replicas: number
): Promise<void> {
    validateAppName(name);
    if (replicas < 0) {
        throw new Error('Replicas must be 0 or greater');
    }
    await client.post(`/v1/projects/${name}/actions/scale`, { scale: replicas });
}

/** Resolve a project ID in this account/team before calling mutations.
 * If no name was given, infer ONLY when the account contains exactly one app.
 */
export async function resolveRestartTarget(client: LiaraClient, name?: string): Promise<string> {
    const apps = await listApps(client);
    const targets = apps.map((p:any)=>p.project_id ?? p.name).filter((x:any)=>typeof x==='string');
    if (!name) {
        if (targets.length!==1) throw new Error(`Specify an exact app name for restart. Visible apps in selected account/team: ${targets.join(', ') || '(none)'}.`);
        return targets[0];
    }
    validateAppName(name);
    if (!targets.includes(name)) throw new Error(`App '${name}' is not visible in the configured Liara account/team. Available: ${targets.join(', ') || '(none)'}. Check LIARA_TEAM_ID and API token.`);
    return name;
}
/** Restart using the documented endpoint. An accepted request isn't proof the app is healthy. */
export async function restartApp(client: LiaraClient, name?: string): Promise<string> {
    const target = await resolveRestartTarget(client, name);
    try { await client.post(`/v1/projects/${encodeURIComponent(target)}/actions/restart`); }
    catch (error) {
        const e=error as {statusCode?:number;message?:string};
        if (e.statusCode===404 || /Project not found/i.test(e.message || ''))
            throw new Error(`Liara rejected restart for '${target}' (Project not found). Verify the active token/team and re-list apps; no restart was confirmed.`);
        throw error;
    }
    return target;
}

/**
 * Change app plan (resize)
 */
export async function resizeApp(
    client: LiaraClient,
    name: string,
    planID: string
): Promise<void> {
    validateAppName(name);
    validateRequired(planID, 'Plan ID');
    await client.post(`/v1/projects/${name}/resize`, { planID });
}

/**
 * Liara shell runs over WebSocket, not a documented HTTP /exec endpoint.
 * Refuse unsupported calls instead of risking an arbitrary POST.
 */
export async function execCommand(
    _client: LiaraClient,
    appName: string,
    _command: string,
    _workingDir?: string
): Promise<{ output: string; exitCode: number }> {
    validateAppName(appName);
    throw new Error('The Liara PaaS API does not document HTTP /exec. Use the Liara CLI shell on a trusted machine instead.');
}

/**
 * Get available platforms
 */
export function getAvailablePlatforms(): Platform[] {
    return [
        'node',
        'nextjs',
        'laravel',
        'php',
        'django',
        'flask',
        'dotnet',
        'static',
        'react',
        'angular',
        'vue',
        'docker',
        'python',
        'go',
    ];
}
