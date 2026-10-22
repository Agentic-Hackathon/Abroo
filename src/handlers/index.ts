/**
 * Tool handlers index - exports unified handler function
 * Supports both consolidated and individual tool modes
 */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { formatErrorForMcp, LiaraMcpError } from '../utils/errors.js';
import { LiaraClient, ToolResult } from './types.js';
import { handleConsolidatedTools } from './consolidated-handlers.js';
import { handleAppTools } from './app-handlers.js';
import { handleEnvTools } from './env-handlers.js';
import { handleSettingsTools } from './settings-handlers.js';
import { handleDeploymentTools } from './deployment-handlers.js';
import { handleDatabaseTools } from './database-handlers.js';
import { handleStorageTools } from './storage-handlers.js';
import { handlePlanTools } from './plan-handlers.js';
import { handleDnsTools } from './dns-handlers.js';
import { handleDomainTools } from './domain-handlers.js';
import { handleMailTools } from './mail-handlers.js';
import { handleVmTools } from './vm-handlers.js';
import { handleDiskTools } from './disk-handlers.js';
import { handleNetworkTools } from './network-handlers.js';
import { handleUserTools } from './user-handlers.js';
import { handleObservabilityTools } from './observability-handlers.js';
import { handleDiagnoseTools } from './diagnose-handlers.js';
import { handleRemediationTools } from './remediation-handlers.js';
import { handleGuidedDeployTools } from './guided-deploy-handlers.js';

export { LiaraClient, ToolResult, extractPagination } from './types.js';

/**
 * Handle a tool call and return the result
 * Supports both consolidated and individual tool modes
 */
export async function handleToolCall(
    client: LiaraClient,
    name: string,
    args: any
): Promise<ToolResult> {
    try {
        // Diagnose tools are available in BOTH modes, so they are checked first
        // (before the consolidated / individual branching).
        const diagnoseResult = await handleDiagnoseTools(client, name, args);
        if (diagnoseResult !== null) {
            return diagnoseResult;
        }

        const remediation = await handleRemediationTools(client, name, args);
        if (remediation !== null) return remediation;

        const guidedDeploy = await handleGuidedDeployTools(client, name, args);
        if (guidedDeploy !== null) return guidedDeploy;

        // Check if using consolidated tools mode
        const useConsolidated = process.env.LIARA_MCP_CONSOLIDATED === 'true';

        if (useConsolidated) {
            // Try consolidated handler first
            const consolidatedResult = await handleConsolidatedTools(client, name, args);
            if (consolidatedResult !== null) {
                return consolidatedResult;
            }
        } else {
            // Try individual handlers in order
            const handlers = [
                handleAppTools,
                handleEnvTools,
                handleSettingsTools,
                handleDeploymentTools,
                handleDatabaseTools,
                handleStorageTools,
                handlePlanTools,
                handleDnsTools,
                handleDomainTools,
                handleMailTools,
                handleVmTools,
                handleDiskTools,
                handleNetworkTools,
                handleUserTools,
                handleObservabilityTools,
            ];

            for (const handler of handlers) {
                const result = await handler(client, name, args);
                if (result !== null) {
                    return result;
                }
            }
        }

        // No handler found
        throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
        );
    } catch (error) {
        const errorMessage = formatErrorForMcp(error);
        const suggestions = (error instanceof LiaraMcpError && error.suggestions)
            ? error.suggestions
            : undefined;
        const errorCode = (error instanceof LiaraMcpError && error.code)
            ? error.code
            : 'UNKNOWN_ERROR';

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: {
                            code: errorCode,
                            message: errorMessage,
                            ...(suggestions && { suggestions })
                        }
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
}