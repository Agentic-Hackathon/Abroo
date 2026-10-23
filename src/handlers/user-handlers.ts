/**
 * User tool handlers
 */
import * as userService from '../services/user.js';
import * as billing from '../services/billing.js';
import { LiaraClient, ToolResult, jsonResponse } from './types.js';

export async function handleUserTools(
    client: LiaraClient,
    name: string,
    _args: any
): Promise<ToolResult | null> {
    switch (name) {
        case 'liara_get_user': {
            const userInfo = await userService.getUserInfo(client);
            return jsonResponse(userInfo);
        }

        case 'liara_get_balance': return jsonResponse(await billing.getBillingBalance(client));
        case 'liara_get_remaining_free_credit': return jsonResponse(await billing.getRemainingFreeCredit(client));
        default:
            return null;
    }
}
