import type { LiaraClient } from '../api/client.js';
/** Balance and free credit are distinct quantities. Do not invent their unit. */
export async function getBillingBalance(client: LiaraClient) {
  const response = await client.get<any>('/v1/billing');
  const user = response?.user;
  if (!user || typeof user.balance !== 'number' || !Number.isFinite(user.balance))
    throw new Error('GET /v1/billing did not return a numeric user.balance; cannot report monetary balance.');
  return {
    balance: user.balance,
    unit: 'not specified by billing OpenAPI schema; verify Liara console before labeling as toman/rial',
    accountType: typeof user.accountType === 'string' ? user.accountType : undefined,
    minCreditAmount: typeof user.minCreditAmount === 'number' ? user.minCreditAmount : undefined,
    isManualMinCredit: typeof user.isManualMinCredit === 'boolean' ? user.isManualMinCredit : undefined,
    source: 'GET /v1/billing user.balance',
  };
}
export async function getRemainingFreeCredit(client: LiaraClient) {
  const response = await client.get<any>('/v1/me/free-credit');
  if (typeof response?.remainingFreeCredit !== 'number' || !Number.isFinite(response.remainingFreeCredit))
    return {available:false,reason:'Field omitted, possibly team mode or no free-credit data.'};
  return {available:true, remainingFreeCredit:response.remainingFreeCredit,unit:'not specified by OpenAPI schema',source:'GET /v1/me/free-credit'};
}
