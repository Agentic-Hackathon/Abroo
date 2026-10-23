/**
 * User tool definitions
 */
import { ToolDefinition } from './types.js';

export function getUserTools(): ToolDefinition[] {
    return [
        {name:'liara_get_balance',description:'READ ONLY: Read actual monetary account balance from GET /v1/billing (not freeCreditTime or minCreditAmount). Never guess balance units.',inputSchema:{type:'object',properties:{}}},
        {name:'liara_get_remaining_free_credit',description:'READ ONLY: Get remaining free credit separately from GET /v1/me/free-credit; may be omitted in team mode.',inputSchema:{type:'object',properties:{}}},
        {
            name: 'liara_get_user',
            description: 'Get comprehensive user information including plans and teams',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
    ];
}
