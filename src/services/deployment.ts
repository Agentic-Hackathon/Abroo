import { LiaraClient } from '../api/client.js';
import { DeployReleaseResponse, DeployReleaseRequest, DeploySourceResponse, PaginationOptions, paginationToParams } from '../api/types.js';
import { validateAppName, validateRequired, unwrapApiResponse } from '../utils/errors.js';
import { createReadStream } from 'fs';
import { basename } from 'path';
import FormData from 'form-data';

/**
 * Upload source code for deployment
 * @param filePath - Path to the .tar.gz file to upload
 */
export async function uploadSource(
    client: LiaraClient,
    appName: string,
    filePath: string
): Promise<DeploySourceResponse> {
    validateAppName(appName);
    validateRequired(filePath, 'File path');

    // Create FormData with file stream
    const formData = new FormData();
    const fileName = basename(filePath) || 'source.tar.gz';
    formData.append('file', createReadStream(filePath), {
        filename: fileName,
        contentType: 'application/gzip',
    });

    return await client.postFormData<DeploySourceResponse>(
        `/v2/projects/${appName}/sources`,
        formData
    );
}

/**
 * Deploy release
 * Note: Source upload requires binary file handling which is handled separately
 */
export async function deployRelease(
    client: LiaraClient,
    appName: string,
    request: DeployReleaseRequest
): Promise<DeployReleaseResponse> {
    validateAppName(appName);
    validateRequired(request.sourceID, 'Source ID');

    return await client.post<DeployReleaseResponse>(
        `/v2/projects/${appName}/releases`,
        request
    );
}

/**
 * List releases for an app
 */
export interface LiaraRelease {
    _id?: string;
    releaseID?: string;
    sourceID?: string;
    state?: string;
    status?: string; // Legacy fallback only; documented response uses state.
    createdAt?: string;
    tag?: string;
}

/** GET /v1/projects/{name}/releases returns {releases: [...]}. */
export async function listReleases(
    client: LiaraClient,
    appName: string,
    pagination?: PaginationOptions
): Promise<LiaraRelease[]> {
    validateAppName(appName);
    const params = paginationToParams(pagination);
    const response = await client.get<any>(`/v1/projects/${appName}/releases`, params);
    return unwrapApiResponse<LiaraRelease[]>(response, ['releases', 'data', 'items']);
}

/**
 * The public PaaS API documents collection retrieval. Avoid an invented
 * release-by-ID URL: obtain the collection and match a stable ID or tag.
 */
export async function getRelease(
    client: LiaraClient,
    appName: string,
    releaseID: string
): Promise<LiaraRelease> {
    validateAppName(appName);
    validateRequired(releaseID, 'Release ID');
    const releases = await listReleases(client, appName);
    const record = releases.find(item =>
        item._id === releaseID || item.releaseID === releaseID || item.tag === releaseID);
    if (!record) throw new Error(`Release ${releaseID} was not present in the returned release list. Use liara_list_releases to inspect pagination/status.`);
    return record;
}

/**
 * No rollback API contract has been verified in the official PaaS docs.
 * Fail safely instead of sending an undocumented mutation to production.
 */
export async function rollbackRelease(
    _client: LiaraClient,
    _appName: string,
    _releaseID: string
): Promise<{ message: string }> {
    throw new Error('Automatic release rollback is disabled: no official HTTP rollback endpoint has been verified. Use the Liara console or a supported CLI procedure after user approval.');
}

/**
 * List sources for an app
 */
export async function listSources(
    client: LiaraClient,
    appName: string,
    pagination?: PaginationOptions
): Promise<Array<{
    _id: string;
    sourceID: string;
    status: string;
    createdAt: string;
    size?: number;
}>> {
    validateAppName(appName);
    const params = paginationToParams(pagination);
    const response = await client.get<any>(`/v2/projects/${appName}/sources`, params);
    return unwrapApiResponse<Array<{
        _id: string;
        sourceID: string;
        status: string;
        createdAt: string;
        size?: number;
    }>>(response, ['sources', 'data', 'items']);
}

/**
 * Delete a source
 */
export async function deleteSource(
    client: LiaraClient,
    appName: string,
    sourceID: string
): Promise<void> {
    validateAppName(appName);
    validateRequired(sourceID, 'Source ID');
    await client.delete(`/v2/projects/${appName}/sources/${sourceID}`);
}
