/** Validated app provisioning options derived from the same /v1/me + networks APIs as Liara CLI.
 * No network names are passed to POST /v1/projects; they are resolved to _id.
 */
import type { LiaraClient } from '../api/client.js';

export interface ProvisioningInput {
  planID: string;
  bundlePlanID?: string;
  network?: string;
}
export interface ProvisioningSelection {
  planID: string;
  bundlePlanID: string;
  network: string;
  bundlePrice?: number;
  networkName?: string;
  selectionNotes: string[];
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

export async function fetchProjectOptions(client: LiaraClient) {
  const response = await client.get<any>('/v1/me');
  const plans = asObject(response?.plans);
  if (!plans) throw new Error('The /v1/me response does not contain plans; cannot validate app price and feature plan.');
  const projects = asObject(plans.projects);
  const bundles = asObject(plans.projectBundlePlans);
  if (!projects || !bundles) throw new Error('The /v1/me response lacks plans.projects or plans.projectBundlePlans. Check the selected account/team.');
  return {projects, bundles};
}

export function normalizeNetworks(response: any): Array<{_id: string; name: string}> {
  const entries = Array.isArray(response) ? response :
    Array.isArray(response?.networks) ? response.networks :
    Array.isArray(response?.data?.networks) ? response.data.networks :
    Array.isArray(response?.data) ? response.data : null;
  if (!entries) throw new Error('Unrecognized networks API response; refuse to guess network ID.');
  return entries.filter((n: any) => typeof n?._id === 'string' && typeof n?.name === 'string');
}

export async function resolveProvisioning(client: LiaraClient, options: ProvisioningInput, autoSelectBundle = false): Promise<ProvisioningSelection> {
  const {projects, bundles} = await fetchProjectOptions(client);
  const plan = asObject(projects[options.planID]);
  if (!plan || plan.available === false) throw new Error(`Plan '${options.planID}' is missing or unavailable in this account/team. Inspect liara_list_plans.`);
  const bundleOptions = asObject(bundles[options.planID]);
  if (!bundleOptions) throw new Error(`No feature bundle plans for '${options.planID}' were reported by /v1/me.`);
  const choices = Object.entries(bundleOptions)
    .filter(([,v])=>asObject(v)?.available === true)
    .map(([id,v])=>({id,price:typeof asObject(v)?.displayPrice === 'number' ? asObject(v)!.displayPrice as number : undefined}));
  if (!choices.length) throw new Error(`No available bundlePlanID for '${options.planID}'.`);
  let selected = options.bundlePlanID ? choices.find(c=>c.id===options.bundlePlanID) : undefined;
  const selectionNotes: string[] = [];
  if (options.bundlePlanID && !selected) throw new Error(`bundlePlanID '${options.bundlePlanID}' is not available for plan '${options.planID}'. Available: ${choices.map(c=>c.id).join(', ')}`);
  if (!selected && choices.length===1) { selected=choices[0]; selectionNotes.push('Only available feature bundle selected automatically.'); }
  if (!selected && autoSelectBundle) {
    const priced = choices.filter(c=>c.price !== undefined && Number.isFinite(c.price));
    if (priced.length===choices.length) {
      const sorted=[...priced].sort((a,b)=>(a.price as number)-(b.price as number));
      if (sorted.length===1 || (sorted[0].price as number)<(sorted[1].price as number)) {
        selected=sorted[0];
        selectionNotes.push('Lowest displayPrice feature bundle selected for preview; user approval is required before creation.');
      }
    }
  }
  if (!selected) throw new Error(`Choose bundlePlanID explicitly for '${options.planID}' before creating this paid resource. Available: ${choices.map(c=>`${c.id}${c.price!==undefined?` (displayPrice=${c.price})`:''}`).join(', ')}.`);
  if (options.planID==='free' && selected.id!=='free') throw new Error('Free app plan requires free feature bundle.');
  const rawNetworks = await client.get<any>('/v1/networks');
  const networks = normalizeNetworks(rawNetworks);
  if (!networks.length) throw new Error('No existing Liara network was returned. Create or select a network first.');
  let network = options.network ? networks.find(n=>n._id===options.network || n.name===options.network) : undefined;
  if (options.network && !network) throw new Error(`Network '${options.network}' not found in current account/team. Use liara_list_networks; do not pass an unverified name.`);
  if (!network && networks.length===1) { network=networks[0]; selectionNotes.push('Only accessible network selected automatically.'); }
  if (!network) throw new Error(`Multiple networks exist. Specify network by name or _id: ${networks.map(n=>n.name).join(', ')}.`);
  return {planID:options.planID,bundlePlanID:selected.id,network:network._id,networkName:network.name,bundlePrice:selected.price,selectionNotes};
}
