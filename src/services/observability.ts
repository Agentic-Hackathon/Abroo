import { LiaraClient } from '../api/client.js';
import {
    MetricsSummary,
    LogEntry,
} from '../api/types.js';
import { validateAppName } from '../utils/errors.js';

/**
 * Get app metrics summary
 */
export async function getAppMetrics(
    client: LiaraClient,
    appName: string,
    period?: string
): Promise<MetricsSummary> {
    validateAppName(appName);

    const params: Record<string, string | number | boolean> = period ? { period } : {};
    return await client.get<MetricsSummary>(
        `/v1/projects/${appName}/metrics/summary`,
        params
    );
}

// ... import های فعلی خودت را نگه دار: LiaraClient, LogEntry, validateAppName

interface RawLogGroup {
    metaData: { releaseId: string };
    values: [string, string][];   // [timestamp نانوثانیه, JSON string شامل _entry و type]
}

const MAX_HEAD_PAGES = 8;
const DEFAULT_WINDOW_SEC = 30 * 60;

/** ISO string | Unix ثانیه | Unix میلی‌ثانیه | نانوثانیه  →  Unix ثانیه */
function toUnixSeconds(value?: string | number): number {
    if (value === undefined || value === '') {
        return Math.floor(Date.now() / 1000) - DEFAULT_WINDOW_SEC;
    }
    if (typeof value === 'number' || /^\d+$/.test(value)) {
        const n = Number(value);
        if (n > 1e17) return Math.floor(n / 1e9);   // نانوثانیه
        if (n > 1e11) return Math.floor(n / 1000);  // میلی‌ثانیه
        return Math.floor(n);                       // ثانیه
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
        throw new Error(`Invalid "since" value: ${value}. Use an ISO timestamp or Unix seconds.`);
    }
    return Math.floor(ms / 1000);
}

interface ParsedLine {
    tsNs: string;
    tsMs: number;
    stream: string;
    message: string;
    releaseId: string;
}

async function fetchLogPage(
    client: LiaraClient,
    appName: string,
    start: number,
    lastLines: boolean
): Promise<ParsedLine[]> {
    // endpoint قدیمی v1 فقط پیام "upgrade your client" برمی‌گرداند؛ endpoint واقعی v2 است
    const res = await client.get<{ data?: RawLogGroup[] }>(
        `/v2/projects/${appName}/logs`,
        { start, direction: 'forward', last_lines: lastLines }
    );

    return (res.data ?? [])
        .flatMap((g) =>
            (g.values ?? []).map(([ts, raw]): ParsedLine => {
                let entry: { _entry?: string; type?: string } = {};
                try { entry = JSON.parse(raw); } catch { entry = { _entry: raw }; }
                return {
                    tsNs: ts,
                    tsMs: Number(BigInt(ts) / 1_000_000n),
                    stream: entry.type ?? 'stdout',
                    message: entry._entry ?? raw,
                    releaseId: g.metaData.releaseId,
                };
            })
        )
        .sort((a, b) => (BigInt(a.tsNs) < BigInt(b.tsNs) ? -1 : 1));
}

/**
 * Get app logs (Liara v2 logs API)
 * @param limit - حداکثر تعداد خطوط (پیش‌فرض ۱۰۰؛ تازه‌ترین‌ها نگه داشته می‌شوند)
 * @param since - ISO timestamp یا Unix timestamp (پیش‌فرض: ۳۰ دقیقه‌ی اخیر)
 * @param until - ISO timestamp؛ API پارامتر پایان ندارد، پس سمت کلاینت فیلتر می‌شود
 */
export async function getAppLogs(
    client: LiaraClient,
    appName: string,
    options?: {
        limit?: number;
        since?: string | number;
        until?: string;
    }
): Promise<LogEntry[]> {
    validateAppName(appName);

    const limit = options?.limit ?? 100;
    const since = toUnixSeconds(options?.since);
    const untilMs = options?.until ? Date.parse(options.until) : undefined;
    if (options?.until && Number.isNaN(untilMs)) {
        throw new Error(`Invalid "until" value: ${options.until}. Use an ISO timestamp.`);
    }

    // ۱) تازه‌ترین خطوط (سرور هر درخواست را به ~۱۰۰ خط محدود می‌کند)
    const tail = await fetchLogPage(client, appName, since, true);
    const tailMinSec = tail.length ? Math.floor(tail[0].tsMs / 1000) : Infinity;

    // ۲) از ابتدای بازه جلو برو تا به tail برسی یا سقف پر شود
    const head: ParsedLine[] = [];
    let start = since;
    for (let i = 0; i < MAX_HEAD_PAGES && start < tailMinSec; i++) {
        if (head.length + tail.length >= limit) break;
        const lines = await fetchLogPage(client, appName, start, false);
        if (!lines.length) break;
        head.push(...lines);
        const lastSec = Math.floor(lines[lines.length - 1].tsMs / 1000);
        start = lastSec > start ? lastSec : start + 1;   // ثانیه‌ی آخر دوباره گرفته می‌شود؛ تکرار با dedupe حذف می‌شود
    }

    // ۳) ادغام، حذف تکراری، مرتب‌سازی، فیلتر until، برش به limit
    const seen = new Set<string>();
    const merged: ParsedLine[] = [];
    for (const l of [...head, ...tail]) {
        const key = `${l.tsNs}|${l.stream}|${l.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (untilMs !== undefined && l.tsMs > untilMs) continue;
        merged.push(l);
    }
    merged.sort((a, b) => (BigInt(a.tsNs) < BigInt(b.tsNs) ? -1 : 1));

    // قالب خروجی مثل v1: { type, datetime, message } + releaseId برای ردیابی نسخه
    return merged.slice(-limit).map(
        (l): LogEntry => ({
            timestamp: new Date(l.tsMs).toISOString(),
            message: l.message,
            releaseId: l.releaseId,
            source: l.stream,                          // 'stdout' | 'stderr'
            level: l.stream === 'stderr' ? 'error' : 'info',
        })
    );
}
/**
 * Stream app logs (real-time)
 * Note: This would typically use WebSocket, but for MCP we return recent logs
 * For true streaming, consider implementing WebSocket support separately
 */
export async function streamAppLogs(
    client: LiaraClient,
    appName: string
): Promise<LogEntry[]> {
    validateAppName(appName);
    
    // For now, return recent logs
    // WebSocket streaming would require separate implementation
    return await getAppLogs(client, appName, { limit: 100 });
}

