import { LiaraClient } from '../api/client.js';
import {
    EnvironmentVariable,
    UpdateEnvsRequest,
} from '../api/types.js';
import { validateAppName, validateEnvKey, validateRequired } from '../utils/errors.js';

/**
 * The API bulk update replaces the entire set. These helpers implement safe
 * PATCH/SET semantics by first fetching all existing values and merging them.
 * We fail closed when the documented project.envs collection is unavailable
 * or contains masked credentials, rather than deleting unrelated secrets.
 */
async function readWritableCurrentEnvVars(
    client: LiaraClient,
    appName: string
): Promise<EnvironmentVariable[]> {
    validateAppName(appName);
    const raw = await client.get<any>(`/v1/projects/${appName}`);
    const project = raw?.project ?? raw;
    if (!project || !Array.isArray(project.envs)) {
        throw new Error('Liara project.envs is missing: refusing bulk env update to avoid deleting existing settings.');
    }
    return project.envs.map((v: any) => {
        if (!v || typeof v.key !== 'string' || typeof v.value !== 'string') {
            throw new Error('An existing environment variable has no accessible key/value: refusing overwrite.');
        }
        if (v.encrypted === true && (!v.value || /\*\*\*|REDACTED|\[hidden\]/i.test(v.value))) {
            throw new Error('Existing secret is masked and cannot be safely preserved in a full update.');
        }
        return { key: v.key, value: v.value };
    });
}

export async function updateEnvVars(
    client: LiaraClient,
    appName: string,
    variables: EnvironmentVariable[]
): Promise<{ message: string }> {
    validateAppName(appName);
    if (!Array.isArray(variables) || variables.length === 0) throw new Error('At least one environment variable required');
    const next = new Map((await readWritableCurrentEnvVars(client, appName)).map(v => [v.key, v.value]));
    for (const entry of variables) {
        if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') throw new Error('Environment entries must have string key and value');
        validateEnvKey(entry.key);
        validateRequired(entry.value, `Value for ${entry.key}`);
        next.set(entry.key, entry.value);
    }
    const request: UpdateEnvsRequest = {
        project: appName,
        variables: [...next].map(([key, value]) => ({key, value})),
    };
    return await client.post<{ message: string }>('/v1/projects/update-envs', request);
}

export async function setEnvVar(
    client: LiaraClient,
    appName: string,
    key: string,
    value: string
): Promise<{ message: string }> {
    return await updateEnvVars(client, appName, [{key, value}]);
}

/** Get existing values for internal safe update logic. Do not disclose raw values to agents. */
export async function getEnvVars(
    client: LiaraClient,
    appName: string
): Promise<EnvironmentVariable[]> {
    return await readWritableCurrentEnvVars(client, appName);
}

/** Read-only safe public summary; all secret values are withheld. */
export async function getEnvVarSummary(client: LiaraClient, appName: string) {
    const envs = await getEnvVars(client, appName);
    return envs.map(({key, value}) => ({key, configured: value.length > 0, value: '[REDACTED]'}));
}

/**
 * Delete/unset environment variables
 */
export async function deleteEnvVars(
    client: LiaraClient,
    appName: string,
    keys: string[]
): Promise<{ message: string }> {
    validateAppName(appName);
    validateRequired(keys, 'Environment variable keys');
    
    if (keys.length === 0) {
        throw new Error('At least one environment variable key is required');
    }

    // Get current env vars
    const currentVars = await readWritableCurrentEnvVars(client, appName);
    
    // Filter out the keys to delete
    const updatedVars = currentVars.filter(v => !keys.includes(v.key));
    
    // Update with remaining vars
    const request: UpdateEnvsRequest = {
        project: appName,
        variables: updatedVars,
    };

    return await client.post<{ message: string }>('/v1/projects/update-envs', request);
}

/**
 * Delete/unset a single environment variable
 */
export async function deleteEnvVar(
    client: LiaraClient,
    appName: string,
    key: string
): Promise<{ message: string }> {
    return await deleteEnvVars(client, appName, [key]);
}
