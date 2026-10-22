import type { Analyzer, Finding } from '../types.js';

const PLACEHOLDER = /^(changeme|change_me|your[_-].*|xxx+|todo|tbd|example|<.*>|\$\{.*\})$/i;
const IMPORTANT = /(DATABASE_URL|DB_(HOST|PASSWORD|USER|NAME)|MONGO.*URI|REDIS_URL|SECRET|API_KEY|TOKEN)/i;

/** NOTE: env VALUES are never put into findings, only key names. */
export const configAnalyzer: Analyzer = {
  name: 'config',
  description: 'Environment variables that are empty or still placeholders',
  defaultEnabled: true,
  analyze(ctx) {
    if (ctx.envs.length === 0) return [];
    const empty: string[] = [];
    const placeholder: string[] = [];
    for (const e of ctx.envs) {
      const v = (e.value ?? '').trim();
      if (v === '') empty.push(e.key);
      else if (PLACEHOLDER.test(v)) placeholder.push(e.key);
    }
    const findings: Finding[] = [];
    const importantEmpty = empty.filter((k) => IMPORTANT.test(k));
    if (importantEmpty.length > 0) {
      findings.push({
        analyzer: 'config',
        severity: 'warning',
        title: `Important env vars are empty: ${importantEmpty.join(', ')}`,
        evidence: importantEmpty.map((k) => `${k}=<empty>`),
        suggestion: 'Set real values for these variables.',
        suggestedTool: 'liara_set_env_vars',
      });
    }
    if (placeholder.length > 0) {
      findings.push({
        analyzer: 'config',
        severity: 'warning',
        title: `Env vars still look like placeholders: ${placeholder.join(', ')}`,
        evidence: placeholder.map((k) => `${k}=<placeholder>`),
        suggestion: 'Replace placeholder values with real configuration.',
        suggestedTool: 'liara_set_env_vars',
      });
    }
    return findings;
  },
};
