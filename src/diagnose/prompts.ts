/** Guided workflow, analogue of k8sgpt's `troubleshoot-pod` / `troubleshoot-deployment` prompts. */
export const DIAGNOSE_PROMPT = 'diagnose-app';

export interface PromptResult {
  description: string;
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
}

export function listPrompts() {
  return [
    {
      name: DIAGNOSE_PROMPT,
      description: 'Step-by-step troubleshooting workflow for a Liara app',
      arguments: [{ name: 'appName', description: 'Name of the app to diagnose', required: true }],
    },
  ];
}

export function getPrompt(name: string, args: Record<string, string>): PromptResult {
  if (name !== DIAGNOSE_PROMPT) throw new Error(`Unknown prompt: ${name}`);
  const app = args.appName ?? '<appName>';
  const text = [
    `Troubleshoot the Liara app "${app}".`,
    '1. Call liara_diagnose_app and read every finding and its evidence.',
    '2. For each critical/warning finding, explain in plain language what it means and the most likely cause.',
    '3. If evidence is thin, fetch more with liara_get_logs (longer window) or liara_get_metrics.',
    '4. Propose a prioritized fix list. Do NOT run any change (restart, resize, rollback, env updates) without my explicit confirmation.',
    '5. Never repeat secrets that appear in logs.',
  ].join('\n');
  return { description: `Diagnose ${app}`, messages: [{ role: 'user', content: { type: 'text', text } }] };
}
