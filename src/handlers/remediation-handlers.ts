import { remediationOptions, prepareRemediation, applyRemediation } from '../diagnose/remediation.js';
import { jsonResponse, type LiaraClient, type ToolResult } from './types.js';
export async function handleRemediationTools(client: LiaraClient, name: string, args: any): Promise<ToolResult|null> {
  if (name === 'liara_remediation_options') return jsonResponse(await remediationOptions(client,args?.appName,args?.since));
  if (name === 'liara_prepare_remediation') return jsonResponse(await prepareRemediation(client, {
    appName:args?.appName, findingId:args?.findingId,action:args?.action,params:args?.params,since:args?.since,
  }));
  if (name === 'liara_apply_remediation') return jsonResponse(await applyRemediation(client,args?.planId,args?.confirmation));
  return null;
}
