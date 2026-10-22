/**
 * Diagnose tool definitions
 */
import { ToolDefinition } from './types.js';
import { CHECK_NAMES } from '../diagnose/registry.js';

export function getDiagnoseTools(): ToolDefinition[] {
  return [
    {
      name: 'liara_diagnose_app',
      description:
        'Diagnose an app: runs rule-based checks (status, resources, logs, deployment, config) and returns ' +
        'structured findings with evidence and suggested next steps. Read-only; secrets are redacted. ' +
        'Use the findings to explain the problem; do not apply suggested changes without user confirmation.', 
      inputSchema: {
        type: 'object',
        properties: {
          appName: { type: 'string', description: 'The name of the app' },
          checks: {
            type: 'array',
            items: { type: 'string', enum: CHECK_NAMES },
            description: 'Checks to run (optional, default: all)',
          },
          since: {
            type: 'string',
            description: 'Look-back window such as 30m, 1h, 6h, 1d (optional, default 1h, max 7d)',
          },
          redact: {
            type: 'boolean',
            description: 'Mask secrets in the output (optional, default true)',
          },
        },
        required: ['appName'],
      },
    },
  ];
}
