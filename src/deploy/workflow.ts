/** Local-source guided PaaS deployment using documented REST endpoints.
 * No shell interpolation, no credentials in output and no implicit replacement.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { LiaraClient } from '../handlers/types.js';
import { validateAppName } from '../utils/errors.js';
import * as apps from '../services/apps.js';
import {resolveProvisioning, type ProvisioningSelection} from '../services/project-provisioning.js';
import { deployRelease, uploadSource } from '../services/deployment.js';
import type { Platform } from '../api/types.js';

const MAX_FILES = 15000;
const MAX_BYTES = 150 * 1024 * 1024;
const TTL_MS = 10 * 60_000;
const MAX_PENDING = 60;
const IGNORED_DIRS = new Set([
  '.git', '.svn', 'node_modules', '__pycache__', '.next', '.nuxt', '.venv', 'venv',
  '.tox', '.pytest_cache', '.mypy_cache', '.idea', '.vscode', 'coverage', '.turbo',
]);
const SECRET_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|credentials(?:\..*)?|\.aws|\.ssh|\.kube)$/i;
const SECRET_EXT = /\.(?:pem|key|p12|pfx|jks|keystore)$/i;
const PLATFORMS = new Set(['node','nextjs','laravel','php','django','flask','dotnet','static','react','angular','vue','docker','python','go']);

interface FileRecord { path: string; size: number; digest: string; }
interface LocalInfo {
  directory: string; files: FileRecord[]; totalBytes: number;
  ignored: number; config: Record<string, unknown>;
  platform?: string; app?: string; port?: number; warnings: string[];
}
interface Prepared {
  id: string; created: number; inProgress: boolean;
  app: string; directory: string; platform: Platform; port: number;
  planID?: string; bundlePlanID?: string; network?: string; readOnlyRootFilesystem?: boolean;
  selection?: ProvisioningSelection;
  expectedAppState: string | null; signatures: string;
  files: FileRecord[]; create: boolean;
}
const pending = new Map<string, Prepared>();

function isExcluded(name: string, directory: boolean): boolean {
  return (directory && IGNORED_DIRS.has(name)) || SECRET_NAME.test(name) || SECRET_EXT.test(name);
}
async function collectFiles(directory: string): Promise<LocalInfo> {
  if (!isAbsolute(directory)) throw new Error('directory must be an absolute path on the MCP server host (not the chat client).');
  const root = resolve(directory);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Project path is not a directory.');
  const files: FileRecord[] = [];
  let ignored = 0;
  let bytes = 0;
  const scan = async (rel: string): Promise<void> => {
    for (const item of await fs.readdir(join(root, rel), { withFileTypes: true })) {
      const r = join(rel, item.name);
      if (item.isSymbolicLink() || isExcluded(item.name, item.isDirectory())) { ignored++; continue; }
      if (item.isDirectory()) { await scan(r); continue; }
      if (!item.isFile()) { ignored++; continue; }
      const stat = await fs.stat(join(root, r));
      bytes += stat.size;
      if (bytes > MAX_BYTES || files.length >= MAX_FILES)
        throw new Error(`Source exceeds safe packaging limits (${MAX_FILES} files / ${MAX_BYTES} bytes).`);
      files.push({ path: r, size: stat.size, digest: createHash('sha256').update(await fs.readFile(join(root, r))).digest('hex') });
    }
  };
  await scan('');
  if (!files.length) throw new Error('No deployable files found.');
  const has = (name: string) => files.some(f => f.path === name);
  let config: Record<string, unknown> = {};
  if (has('liara.json')) {
    try {
      const raw = JSON.parse(await fs.readFile(join(root, 'liara.json'), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('object expected');
      config = raw;
    } catch (error) { throw new Error(`Invalid liara.json: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const platform = typeof config.platform === 'string' ? config.platform :
    has('Dockerfile') ? 'docker' : has('package.json') ? 'node' : has('requirements.txt') || has('pyproject.toml') ? 'python' : undefined;
  const app = typeof config.app === 'string' ? config.app : undefined;
  const port = typeof config.port === 'number' ? config.port : undefined;
  const warnings: string[] = [];
  if (!has('liara.json')) warnings.push('liara.json absent; explicit app, platform and port must be supplied.');
  if (!platform) warnings.push('Could not infer platform from known files.');
  if (!port) warnings.push('Port not specified. Supply the listening port used by the application.');
  if (!has('Dockerfile') && !has('package.json') && !has('requirements.txt') && !has('pyproject.toml'))
    warnings.push('No recognized runtime manifest; verify the application can build on Liara.');
  warnings.push('Archive excludes private config files, credentials, virtual environments and symlinks; environment variables must be set securely with separate tools.');
  return { directory: root, files, totalBytes: bytes, ignored, config, platform, app, port, warnings };
}

async function remoteProject(client: LiaraClient, app: string): Promise<any|null> {
  try { return await client.get<any>(`/v1/projects/${app}`); }
  catch (e) {
    if ((e as any)?.statusCode === 404) return null;
    throw e;
  }
}
function signature(info: LocalInfo): string {
  // Include file mtime checks at apply time by recalling collectFiles and comparing.
  return JSON.stringify(info.files.map(f => [f.path, f.size, f.digest]));
}
function remoteState(remote: any | null): string | null {
  if (!remote) return null;
  const p = remote.project ?? remote;
  return JSON.stringify([p._id, p.project_id, p.status, p.scale, p.isDeployed]);
}

export async function deployPreflight(client: LiaraClient, directory: string, appName?: string) {
  const info = await collectFiles(directory);
  const name = appName ?? info.app;
  if (!name) return { directory: info.directory, app: null, platform: info.platform, port: info.port, fileCount: info.files.length, archiveInputBytes: info.totalBytes, ignoredCount: info.ignored, warnings: info.warnings, target: 'not specified', remote: 'not checked' }; 
  validateAppName(name);
  if (info.app && info.app !== name)
    throw new Error(`App mismatch: liara.json declares '${info.app}' but target is '${name}'. Correct this explicitly before deploying.`);
  const remote = await remoteProject(client, name);
  return {
    directory: info.directory, app: name, platform: info.platform, port: info.port,
    fileCount: info.files.length, totalBytes: info.totalBytes, excludedEntries: info.ignored,
    existingApp: !!remote, appStatus: remote ? (remote.project ?? remote).status : null,
    warnings: info.warnings,
    next: remote ? 'Prepare a deployment that replaces the existing release.' : 'Choose a verified Liara plan ID; preparing a new app will create a billable resource.',
  };
}

export async function prepareDeploy(client: LiaraClient, input: {
  directory: string; appName?: string; platform?: string; port?: number;
  planID?: string; bundlePlanID?: string; network?: string; readOnlyRootFilesystem?: boolean;
}) {
  const info = await collectFiles(input.directory);
  const app = input.appName ?? info.app;
  if (!app) throw new Error('Specify appName or provide liara.json app.');
  validateAppName(app);
  if (info.app && info.app !== app) throw new Error('appName conflicts with liara.json app; refusing wrong-target deployment.');
  const platform = input.platform ?? info.platform;
  if (!platform || !PLATFORMS.has(platform)) throw new Error('Provide a supported platform explicitly (e.g. node, python, docker).');
  if (info.config.platform && platform !== info.config.platform) throw new Error('platform conflicts with liara.json; fix the source configuration first.');
  const port = input.port ?? info.port;
  if (!Number.isSafeInteger(port) || (port as number) <= 0 || (port as number) > 65535)
    throw new Error('Provide a valid listening port 1–65535 matching the application (e.g. 3000).');
  if (info.port && port !== info.port) throw new Error('port conflicts with liara.json; update config before deploying.');
  const remote = await remoteProject(client, app);
  if (!remote && !input.planID) throw new Error('App not found in configured account/team. Specify planID to create it; discover plans first.');
  if (input.planID && !/^[a-zA-Z0-9_-]{2,100}$/.test(input.planID)) throw new Error('Invalid planID');
  // Complete all billable resource validation while the plan is still read-only.
  // Network name -> _id and a selectable feature bundle are frozen into preview.
  const selection = !remote ? await resolveProvisioning(client, {
    planID:input.planID as string,bundlePlanID:input.bundlePlanID,network:input.network,
  },true) : undefined;
  const id = randomUUID();
  const now = Date.now();
  for (const [key, val] of pending) if (now - val.created > TTL_MS) pending.delete(key);
  if (pending.size >= MAX_PENDING) throw new Error('Too many pending deployments; retry later.');
  pending.set(id, { id, created: now, inProgress: false, app, directory: info.directory, platform: platform as Platform,
    port: port as number, planID: input.planID, bundlePlanID:selection?.bundlePlanID, network:selection?.network,
    selection,
    readOnlyRootFilesystem: input.readOnlyRootFilesystem,
    expectedAppState: remoteState(remote), signatures: signature(info), files: info.files, create: !remote });
  return {
    planId: id, expiresAt: new Date(now + TTL_MS).toISOString(), appName: app, directory: info.directory,
    platform, port, action: remote ? 'REPLACE_CURRENT_RELEASE' : 'CREATE_APP_AND_DEPLOY',
    planID: remote ? (remote.project ?? remote).planID : input.planID,
    bundlePlanID: selection?.bundlePlanID,
    bundlePrice: selection?.bundlePrice,
    network: selection?.network,
    networkName: selection?.networkName,
    selectionNotes: selection?.selectionNotes,
    fileCount: info.files.length, archiveInputBytes: info.totalBytes, excludedEntries: info.ignored,
    warnings: info.warnings.concat(remote
      ? ['The new release will replace the currently deployed code on this app.']
      : ['Creates a new application and may incur plan charges.']),
    confirmationPhrase: `DEPLOY ${app} ${id}`,
    message: 'Read-only preview. Ask the user to approve this exact target and deployment before applying.',
  };
}

function runTar(stage: string, archive: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('tar', ['-czf', archive, '-C', stage, '.'], {
      shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (b: Buffer) => { error = (error + b.toString()).slice(-2000); });
    child.on('error', err => reject(new Error(`tar unavailable: ${err.message}. Install a trusted tar utility or use liara_upload_source.`)));
    child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`tar exited ${code}: ${error}`)));
  });
}

export async function applyDeploy(client: LiaraClient, planId: string, confirmation: string) {
  const plan = pending.get(planId);
  if (!plan) throw new Error('Deployment preview expired or already consumed. Prepare again.');
  if (plan.inProgress) throw new Error('Deployment already in progress.');
  if (Date.now() - plan.created > TTL_MS) { pending.delete(planId); throw new Error('Deployment preview expired. Prepare again.'); }
  if (confirmation !== `DEPLOY ${plan.app} ${plan.id}`) throw new Error('Confirmation does not match this deployment preview.');
  plan.inProgress = true;
  let tempRoot: string | undefined;
  let step = 'preflight';
  try {
    const info = await collectFiles(plan.directory);
    if (signature(info) !== plan.signatures) throw new Error('Local source inventory changed since preview; prepare again.');
    const remote = await remoteProject(client, plan.app);
    if (remoteState(remote) !== plan.expectedAppState) throw new Error('Remote app state changed since preview; prepare again.');
    if (!remote) {
      if (!plan.selection) throw new Error('Missing validated app creation selection in preview.');
      const refreshed = await resolveProvisioning(client, {planID:plan.selection.planID,
        bundlePlanID:plan.selection.bundlePlanID,network:plan.selection.network},false);
      if (refreshed.network!==plan.selection.network || refreshed.bundlePlanID!==plan.selection.bundlePlanID ||
          refreshed.bundlePrice!==plan.selection.bundlePrice) throw new Error('App creation options changed since preview; prepare again.');
    }
    tempRoot = await fs.mkdtemp(join(tmpdir(), 'liara-mcp-deploy-'));
    const stage = join(tempRoot, 'stage');
    await fs.mkdir(stage);
    for (const item of info.files) {
      const source = join(info.directory, item.path), dest = join(stage, item.path);
      // Fresh lstat before copying; no symbolic links allowed to escape project root.
      const st = await fs.lstat(source);
      if (!st.isFile() || st.isSymbolicLink() || st.size !== item.size) throw new Error('Source changed before archive creation.');
      await fs.mkdir(resolve(dest, '..'), {recursive:true});
      await fs.copyFile(source, dest);
      const copiedHash = createHash('sha256').update(await fs.readFile(dest)).digest('hex');
      if (copiedHash !== item.digest) throw new Error('Local file changed during packaging; aborting.');
    }
    const archive = join(tempRoot, 'source.tar.gz');
    await runTar(stage, archive);
    if (!remote) {
      step = 'create-app';
      await apps.createApp(client, {
        name: plan.app, platform: plan.platform, planID: plan.planID as string,
        bundlePlanID: plan.bundlePlanID,
        network: plan.network,
        ...(plan.readOnlyRootFilesystem !== undefined ? {readOnlyRootFilesystem: plan.readOnlyRootFilesystem} : {}),
      });
    }
    step = 'upload-source';
    const source = await uploadSource(client, plan.app, archive);
    if (!source?.sourceID) throw new Error('Liara source upload returned no sourceID');
    step = 'create-release';
    const release = await deployRelease(client, plan.app, {
      sourceID: source.sourceID, port: plan.port, type: plan.platform,
    });
    if (!release?.releaseID) throw new Error('Liara release creation returned no releaseID');
    pending.delete(planId);
    return {
      success: true, accepted: true, app: plan.app, createdNewApp: plan.create,
      releaseID: release.releaseID, sourceID: source.sourceID,
      message: 'Liara accepted the release request; build/deploy success and health are not yet confirmed.',
      next: 'Call liara_list_releases or liara_diagnose_app and inspect build/app logs. Never report live deployment success until the release reaches a ready/active state.',
    };
  } catch (e) {
    pending.delete(planId);
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Deployment failed during ${step}: ${message}. The action may have partially succeeded (e.g. a newly created app or uploaded source); inspect Liara before retrying.`);
  } finally {
    if (tempRoot) await fs.rm(tempRoot, {recursive:true, force:true}).catch(() => {});
  }
}

/** Explicitly approved local liara.json repair, useful for wrong app name / port.
 * This tool edits only the local liara.json on the machine running MCP.
 */
interface ConfigPlan {
  id: string; created: number; inProgress: boolean; directory: string;
  targetApp: string; next: Record<string, unknown>;
  previousSignature: string; remoteSignature: string | null;
}
const pendingConfig = new Map<string, ConfigPlan>();

export async function prepareLocalConfig(client: LiaraClient, input: {
  directory: string; appName: string; platform?: string; port?: number;
}) {
  const info = await collectFiles(input.directory);
  validateAppName(input.appName);
  const platform = input.platform ?? info.platform;
  if (!platform || !PLATFORMS.has(platform)) throw new Error('Specify a supported platform.');
  const port = input.port ?? info.port;
  if (!Number.isSafeInteger(port) || (port as number) < 1 || (port as number) > 65535)
    throw new Error('Specify the listening port 1–65535.');
  const remote = await remoteProject(client, input.appName);
  const next = {...info.config, app:input.appName, platform, port};
  if (JSON.stringify(info.config) === JSON.stringify(next)) throw new Error('liara.json already matches these values; no repair is required.');
  const id=randomUUID(), now=Date.now();
  for(const [key,p] of pendingConfig) if(now-p.created>TTL_MS) pendingConfig.delete(key);
  if(pendingConfig.size >= MAX_PENDING) throw new Error('Too many pending config edits.');
  pendingConfig.set(id,{id,created:now,inProgress:false,directory:info.directory,
    targetApp:input.appName,next,previousSignature:signature(info),remoteSignature:remoteState(remote)});
  return {
    planId:id,expiresAt:new Date(now+TTL_MS).toISOString(),directory:info.directory,
    file:'liara.json',previous:{app:info.app ?? null,platform:info.platform ?? null,port:info.port ?? null},
    proposed:{app:input.appName,platform,port},remoteAppExists:!!remote,
    action:'OVERWRITE_LOCAL_LIARA_JSON',
    risk:'Modifies the local application configuration on the MCP host; no cloud mutation. Other existing JSON keys will be preserved. Confirm the correct app/team.',
    confirmationPhrase:`CONFIG ${input.appName} ${id}`,
    message:'Show the preview and request explicit user approval before modifying the local file.',
  };
}

export async function applyLocalConfig(client: LiaraClient, planId: string, confirmation: string) {
  const plan=pendingConfig.get(planId);
  if(!plan || Date.now()-plan.created>TTL_MS){pendingConfig.delete(planId);throw new Error('Config preview missing or expired. Prepare again.');}
  if(plan.inProgress) throw new Error('Config change already in progress.');
  if(confirmation!==`CONFIG ${plan.targetApp} ${plan.id}`) throw new Error('Exact confirmationPhrase required after user approval.');
  plan.inProgress=true;
  let tmp:string|undefined;
  try {
    const info=await collectFiles(plan.directory);
    if(signature(info)!==plan.previousSignature) throw new Error('Local files changed since preview; prepare again.');
    const remote=await remoteProject(client,plan.targetApp);
    if(remoteState(remote)!==plan.remoteSignature) throw new Error('Remote app/team state changed since preview; prepare again.');
    const file=join(info.directory,'liara.json');
    try { const st=await fs.lstat(file); if(!st.isFile() || st.isSymbolicLink()) throw new Error('Unsafe liara.json file.'); }
    catch(e) { if((e as any)?.code!=='ENOENT') throw e; }
    tmp=join(info.directory,`.liara-config-${randomUUID()}.tmp`);
    await fs.writeFile(tmp,JSON.stringify(plan.next,null,2)+'\n',{flag:'wx',mode:0o600});
    await fs.rename(tmp,file);
    tmp=undefined;
    pendingConfig.delete(planId);
    return {success:true,app:plan.targetApp,changedLocalFile:file,cloudModified:false,
      next:'Run liara_deploy_preflight, then liara_prepare_deploy and ask for a separate deployment approval.'};
  } catch(e){pendingConfig.delete(planId);throw e;}
  finally {if(tmp) await fs.rm(tmp,{force:true}).catch(()=>{});}
}
