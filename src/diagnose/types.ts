import type { LiaraClient } from '../handlers/types.js';

export type { LiaraClient };
export type Severity = 'critical' | 'warning' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** observed = مستقیم در داده دیده شده؛ hypothesis = حدس درباره‌ی علت */
export type Basis = 'observed' | 'hypothesis';

/** هرگز healthy وقتی داده‌ای در دسترس نبوده */
export type Overall = 'critical' | 'degraded' | 'healthy' | 'unknown';

export type DatasetName = 'app' | 'plan' | 'metrics' | 'logs' | 'releases' | 'envs';

export interface FindingStats {
  /** تعداد خطوط مطابق در پنجره‌ی نمونه‌گیری‌شده (نه کل بازه) */
  count?: number;
  firstSeen?: string;   // ISO
  lastSeen?: string;    // ISO
  /** release‌ای که اولین بار مشکل در آن دیده شد، مثل "v3" */
  releaseTag?: string;
}

/** One diagnosed problem (analogue of k8sgpt's Result/Failure). */
export interface Finding {
  analyzer: string;
  /** شناسه‌ی پایدار، مثل 'disk-full' و 'db-auth-failed' (برای تست و dedupe) */
  id: string;
  severity: Severity;
  basis: Basis;
  title: string;
  /** Raw facts: همیشه redact شده؛ مقدار envها هرگز اینجا نمی‌آید */
  evidence: string[];
  stats?: FindingStats;
  suggestion?: string;
  /** فقط پیشنهاد، هرگز اجرای خودکار. برای basis='hypothesis' با عبارت «اول تأیید کن» نمایش داده شود */
  suggestedTool?: string;
  docUrl?: string;
}

export interface EnvVar {
  key: string;
  /** فقط برای بررسی محلی (مثلاً placeholder). هرگز در Finding یا خروجی کپی نشود */
  value?: string;
}

/** یک خط لاگ (با LogEntry پروژه ساختاری سازگار است) */
export interface LogLine {
  timestamp: string;
  message: string;
  source?: string;      // stdout | stderr
  releaseId?: string;
}

export interface LogSampling {
  lines: number;
  from?: string;
  to?: string;
  limit: number;
  /** true یعنی احتمالاً بخشی از بازه دیده نشده */
  truncated: boolean;
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
  logs: LogLine[];
  logSampling?: LogSampling;
  releases: Array<Record<string, any>>;
  currentReleaseId?: string;
  /** releaseId -> tag (v1, v2, ...) */
  releaseTags: Record<string, string>;
  envs: EnvVar[];
  /** dataset name -> reason it could not be collected */
  unavailable: Partial<Record<DatasetName, string>>;
}

export interface Analyzer {
  name: string;
  description: string;
  defaultEnabled: boolean;
  /** اگر هر کدام از این داده‌ها در ctx.unavailable باشد، runner اجرا نمی‌کند و وضعیت 'unavailable' می‌شود */
  requires?: DatasetName[];
  analyze(ctx: DiagnoseContext): Finding[] | Promise<Finding[]>;
}

export interface AnalyzerRun {
  name: string;
  status: 'ok' | 'unavailable' | 'error';
  durationMs: number;
  findings: number;
  error?: string;
}

export interface DiagnoseReport {
  app: string;
  window: { since: string; from: string; to: string };
  summary: {
    overall: Overall;
    critical: number;
    warning: number;
    info: number;
    headline: string;
  };
  findings: Finding[];
  analyzers: AnalyzerRun[];
  sampling?: LogSampling;
  unavailableData: Partial<Record<DatasetName, string>>;
  notes: string[];
}

export interface DiagnoseOptions {
  appName: string;
  checks?: string[];
  since?: string;
  redact?: boolean;
}