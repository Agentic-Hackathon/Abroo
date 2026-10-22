import type { LiaraClient } from '../handlers/types.js';

export type { LiaraClient };
export type Severity = 'critical' | 'warning' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** One diagnosed problem (analogue of k8sgpt's Result/Failure). */
export interface Finding {
  analyzer: string;
  severity: Severity;
  title: string;
  /** Raw facts the LLM can reason about: log lines, numbers, release ids. */
  evidence: string[];
  suggestion?: string;
  /** Name of an existing liara-mcp tool that could fix it (never auto-run). */
  suggestedTool?: string;
  docUrl?: string;
}

export interface EnvVar {
  key: string;
  value?: string;
}

/** Everything collected once and shared by all analyzers. */
export interface DiagnoseContext {
  appName: string;
  since: string;
  sinceDate: Date;
  now: Date;
  app?: Record<string, any>;
  plan?: Record<string, any>;
  metrics?: unknown;
  logs: string[];
  releases: Array<Record<string, any>>;
  envs: EnvVar[];
  /** dataset name -> reason it could not be collected */
  unavailable: Record<string, string>;
}

export interface Analyzer {
  name: string;
  description: string;
  defaultEnabled: boolean;
  analyze(ctx: DiagnoseContext): Finding[] | Promise<Finding[]>;
}

export interface AnalyzerRun {
  name: string;
  durationMs: number;
  findings: number;
  error?: string;
}

export interface DiagnoseReport {
  app: string;
  window: { since: string; from: string; to: string };
  summary: { critical: number; warning: number; info: number; headline: string };
  findings: Finding[];
  analyzers: AnalyzerRun[];
  unavailableData: Record<string, string>;
  notes: string[];
}

export interface DiagnoseOptions {
  appName: string;
  checks?: string[];
  since?: string;
  redact?: boolean;
}
