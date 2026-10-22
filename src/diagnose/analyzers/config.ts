import type { Analyzer, Finding } from '../types.js';

const PLACEHOLDER =
  /^(changeme|change_me|your[_-].*|xxx+|todo|tbd|example|<.*>|\$\{.*\})$/i;

const IMPORTANT =
  /(DATABASE_URL|DB_(HOST|PASSWORD|USER|NAME)|MONGO.*URI|REDIS_URL|SECRET|API_KEY|TOKEN)/i;

/** Environment variable values must never appear in findings. */
export const configAnalyzer: Analyzer = {
  name: 'config',
  description:
    'Environment variables that are empty or still placeholders',
  defaultEnabled: true,
  requires: ['envs'],

  analyze(ctx): Finding[] {
    if (ctx.envs.length === 0) return [];

    const empty: string[] = [];
    const placeholder: string[] = [];

    for (const env of ctx.envs) {
      const value = (env.value ?? '').trim();

      if (value === '') {
        empty.push(env.key);
      } else if (PLACEHOLDER.test(value)) {
        placeholder.push(env.key);
      }
    }

    const findings: Finding[] = [];

    const importantEmpty = empty.filter((key) =>
      IMPORTANT.test(key),
    );

    if (importantEmpty.length > 0) {
      findings.push({
        analyzer: 'config',
        id: 'important-env-empty',
        severity: 'warning',
        basis: 'observed',
        title: 'Important environment variables are empty',
        evidence: importantEmpty.map((key) => `${key}=<empty>`),
        stats: {
          count: importantEmpty.length,
        },
        suggestion:
          'Verify that these variables are required by the application and configure their values securely.',
        suggestedTool: 'liara_set_env_vars',
      });
    }

    if (placeholder.length > 0) {
      findings.push({
        analyzer: 'config',
        id: 'env-placeholder-values',
        severity: 'warning',
        basis: 'observed',
        title: 'Environment variables appear to contain placeholders',
        evidence: placeholder.map(
          (key) => `${key}=<placeholder>`,
        ),
        stats: {
          count: placeholder.length,
        },
        suggestion:
          'Verify whether these values are intentional. Replace placeholders with valid configuration where necessary.',
        suggestedTool: 'liara_set_env_vars',
      });
    }

    return findings;
  },
};