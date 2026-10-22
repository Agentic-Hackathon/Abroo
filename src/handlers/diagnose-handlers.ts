/**
 * Diagnose tool handlers
 */
import { diagnoseApp } from '../diagnose/runner.js';
import { LiaraClient, ToolResult, jsonResponse } from './types.js';

export async function handleDiagnoseTools(
  client: LiaraClient,
  name: string,
  args: any
): Promise<ToolResult | null> {
  switch (name) {
    case 'liara_diagnose_app': {
      const report = await diagnoseApp(client, {
        appName: args!.appName as string,
        checks: args?.checks as string[] | undefined,
        since: args?.since as string | undefined,
        redact: args?.redact as boolean | undefined,
      });
      return jsonResponse(report);
    }
    default:
      return null;
  }
}
