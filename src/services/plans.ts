import type { LiaraClient } from '../api/client.js';
import type { Plan, PaginationOptions } from '../api/types.js';
import { fetchProjectOptions } from './project-provisioning.js';

/** Liara CLI reads plan catalogs from GET /v1/me rather than undocumented GET /v1/plans. */
export async function listPlans(client: LiaraClient, planType?: 'app'|'database'|'vm', _pagination?: PaginationOptions): Promise<Plan[]> {
  const response=await client.get<any>('/v1/me');
  const raw = planType==='database' ? response?.plans?.databases : planType==='vm' ? response?.plans?.vms : response?.plans?.projects;
  if (!raw || typeof raw!=='object' || Array.isArray(raw))
    throw new Error(`The selected account/team does not expose '${planType??'app'}' plan catalog in /v1/me.`);
  return Object.entries(raw).map(([id,value]:[string,any])=>({...(value && typeof value==='object'?value:{}),id,planID:id,
    ...(planType===undefined||planType==='app'?{featureBundles:response.plans?.projectBundlePlans?.[id]??{}}:{})} as unknown as Plan));
}
export async function getPlan(client: LiaraClient, planId: string): Promise<Plan> {
  const {projects,bundles}=await fetchProjectOptions(client);
  const plan=projects[planId];
  if (!plan) throw new Error(`Unknown app plan '${planId}' in this account/team.`);
  return { ...plan,id:planId,planID:planId,featureBundles:bundles[planId]??{} } as Plan;
}
