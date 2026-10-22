import { applyDeploy, deployPreflight, prepareDeploy, prepareLocalConfig, applyLocalConfig } from '../deploy/workflow.js';
import { jsonResponse, type LiaraClient, type ToolResult } from './types.js';
export async function handleGuidedDeployTools(client: LiaraClient,name:string,args:any):Promise<ToolResult|null> {
  if (name==='liara_deploy_preflight') return jsonResponse(await deployPreflight(client,args?.directory,args?.appName));
  if (name==='liara_prepare_deploy') return jsonResponse(await prepareDeploy(client,args));
  if (name==='liara_prepare_local_config') return jsonResponse(await prepareLocalConfig(client,args));
  if (name==='liara_apply_local_config') return jsonResponse(await applyLocalConfig(client,args?.planId,args?.confirmation));
  if (name==='liara_apply_deploy') return jsonResponse(await applyDeploy(client,args?.planId,args?.confirmation));
  return null;
}
