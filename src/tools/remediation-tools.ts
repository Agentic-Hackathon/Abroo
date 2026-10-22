import type { ToolDefinition } from './types.js';
export function getRemediationTools(): ToolDefinition[] {
  return [
    { name: 'liara_remediation_options', description: 'READ ONLY. Diagnose and propose issue-specific options with warnings. Does not mutate cloud resources.', inputSchema: {
      type: 'object', properties: { appName: {type:'string'}, since: {type:'string'} }, required:['appName'] } },
    { name: 'liara_prepare_remediation', description: 'READ ONLY. Prepare ONE selected, diagnosed repair action; return redacted impact preview and unique confirmation phrase. Do not apply it without explicit user approval.', inputSchema: {
      type: 'object', properties: {
        appName: {type:'string'}, findingId: {type:'string'}, since: {type:'string'},
        action: {type:'string', enum:['start_app','restart_app','update_env','resize_disk']},
        params: {type:'object', description:'update_env: {variables:[{key,value}]}; resize_disk: {diskName,newSize,confirmedMount:true}; start/restart: {}'},
      }, required:['appName','findingId','action'] } },
    { name: 'liara_apply_remediation', description: 'MUTATES LIARA. Apply only after showing preview to the user and receiving explicit approval for that exact action and target. One-time, short-lived plan.', inputSchema: {
      type:'object',properties:{planId:{type:'string'},confirmation:{type:'string', description:'Exact confirmationPhrase from approved preview; do not invent approval'}},required:['planId','confirmation'] } },
  ];
}
