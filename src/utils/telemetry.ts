export interface RecentToolCallEntry {
  id: number;
  timestamp: string;
  toolName: string;
  provider: string;
  argsSummary: string;
  argsJson: string;
  durationMs: number;
  cacheHitsDelta: number;
  cacheMissesDelta: number;
  servedFromCache: boolean;
  status: "ok" | "error";
  errorMessage?: string;
}

export interface ToolMetricStats {
  toolName: string;
  provider: string;
  calls: number;
  errors: number;
  cacheHitCalls: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastCalledAt?: string;
}

export interface RecentHttpCallEntry {
  id: number;
  timestamp: string;
  provider: string;
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  attempts: number;
  error?: string;
}

export interface ProviderHttpStats {
  provider: string;
  totalCalls: number;
  successCalls: number;
  rateLimit429Count: number;
  notFound404Count: number;
  error5xxCount: number;
  networkErrorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastCalledAt?: string;
  lastStatus?: number | string;
}

export interface TelemetrySnapshot {
  startedAt: string;
  uptimeSeconds: number;
  totalToolCalls: number;
  totalToolErrors: number;
  avgToolDurationMs: number;
  totalUpstreamHttpCalls: number;
  totalRateLimit429: number;
  toolMetrics: ToolMetricStats[];
  providerHttpStats: Record<string, ProviderHttpStats>;
  recentToolCalls: RecentToolCallEntry[];
  recentHttpCalls: RecentHttpCallEntry[];
}

const MAX_RECENT_ENTRIES = 100;

function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const secretParam of ["key", "api_key", "apikey", "token"]) {
      if (parsed.searchParams.has(secretParam)) {
        parsed.searchParams.set(secretParam, "***");
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function summarizeArgs(args: unknown): { summary: string; json: string } {
  if (!args || typeof args !== "object") {
    return { summary: "-", json: "{}" };
  }
  const obj = args as Record<string, unknown>;
  const json = JSON.stringify(obj);

  const parts: string[] = [];
  if (typeof obj.hotelName === "string") parts.push(`hotel="${obj.hotelName}"`);
  if (typeof obj.city === "string") parts.push(`city="${obj.city}"`);
  if (obj.locationId !== undefined) parts.push(`locId=${String(obj.locationId)}`);
  if (typeof obj.placeId === "string") parts.push(`placeId=${obj.placeId.slice(0, 14)}…`);
  if (typeof obj.query === "string") parts.push(`q="${obj.query}"`);
  if (typeof obj.textQuery === "string") parts.push(`q="${obj.textQuery}"`);
  if (Array.isArray(obj.hotels)) parts.push(`hotels=[${obj.hotels.length}]`);
  if (typeof obj.language === "string") parts.push(`lang=${obj.language}`);
  if (typeof obj.locale === "string") parts.push(`locale=${obj.locale}`);

  if (parts.length > 0) {
    return { summary: parts.join(", "), json };
  }

  const fallback = Object.entries(obj)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v.slice(0, 24)}"` : JSON.stringify(v)}`)
    .join(", ");
  return { summary: fallback || "-", json };
}

export function inferProviderFromToolName(toolName: string): string {
  if (toolName.startsWith("ta_")) return "tripadvisor_terra";
  if (toolName.startsWith("gplaces_")) return "google_places";
  if (toolName.startsWith("china_")) return "china_travel";
  return "aggregate";
}

export class TelemetryCollector {
  private readonly startedAtMs = Date.now();
  private readonly startedAtIso = new Date(this.startedAtMs).toISOString();
  private seqId = 0;

  private readonly recentToolCalls: RecentToolCallEntry[] = [];
  private readonly recentHttpCalls: RecentHttpCallEntry[] = [];
  private readonly toolMetrics = new Map<string, ToolMetricStats>();
  private readonly providerStats = new Map<string, ProviderHttpStats>();

  constructor() {
    for (const p of ["tripadvisor_terra", "google_places", "china_travel"]) {
      this.providerStats.set(p, {
        provider: p,
        totalCalls: 0,
        successCalls: 0,
        rateLimit429Count: 0,
        notFound404Count: 0,
        error5xxCount: 0,
        networkErrorCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
      });
    }
  }

  recordToolCall(input: {
    toolName: string;
    args: unknown;
    durationMs: number;
    cacheHitsDelta: number;
    cacheMissesDelta: number;
    isError: boolean;
    errorMessage?: string;
  }): void {
    this.seqId += 1;
    const nowIso = new Date().toISOString();
    const provider = inferProviderFromToolName(input.toolName);
    const { summary, json } = summarizeArgs(input.args);
    const servedFromCache = input.cacheHitsDelta > 0 && input.cacheMissesDelta === 0;

    const entry: RecentToolCallEntry = {
      id: this.seqId,
      timestamp: nowIso,
      toolName: input.toolName,
      provider,
      argsSummary: summary,
      argsJson: json,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      cacheHitsDelta: Math.max(0, input.cacheHitsDelta),
      cacheMissesDelta: Math.max(0, input.cacheMissesDelta),
      servedFromCache,
      status: input.isError ? "error" : "ok",
      errorMessage: input.errorMessage,
    };

    this.recentToolCalls.unshift(entry);
    if (this.recentToolCalls.length > MAX_RECENT_ENTRIES) {
      this.recentToolCalls.pop();
    }

    const existing = this.toolMetrics.get(input.toolName) ?? {
      toolName: input.toolName,
      provider,
      calls: 0,
      errors: 0,
      cacheHitCalls: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
    };

    existing.calls += 1;
    if (input.isError) existing.errors += 1;
    if (servedFromCache) existing.cacheHitCalls += 1;
    existing.totalDurationMs += entry.durationMs;
    existing.avgDurationMs = Math.round(existing.totalDurationMs / existing.calls);
    existing.lastCalledAt = nowIso;
    this.toolMetrics.set(input.toolName, existing);
  }

  recordHttpCall(input: {
    provider: string;
    method: string;
    url: string;
    status?: number;
    durationMs: number;
    attempts: number;
    error?: string;
  }): void {
    this.seqId += 1;
    const nowIso = new Date().toISOString();
    const durationMs = Math.max(0, Math.round(input.durationMs));

    const entry: RecentHttpCallEntry = {
      id: this.seqId,
      timestamp: nowIso,
      provider: input.provider,
      method: input.method,
      url: sanitizeUrl(input.url),
      status: input.status,
      durationMs,
      attempts: input.attempts,
      error: input.error,
    };

    this.recentHttpCalls.unshift(entry);
    if (this.recentHttpCalls.length > MAX_RECENT_ENTRIES) {
      this.recentHttpCalls.pop();
    }

    const pStat = this.providerStats.get(input.provider) ?? {
      provider: input.provider,
      totalCalls: 0,
      successCalls: 0,
      rateLimit429Count: 0,
      notFound404Count: 0,
      error5xxCount: 0,
      networkErrorCount: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
    };

    pStat.totalCalls += 1;
    pStat.totalDurationMs += durationMs;
    pStat.avgDurationMs = Math.round(pStat.totalDurationMs / pStat.totalCalls);
    pStat.lastCalledAt = nowIso;
    pStat.lastStatus = input.status ?? input.error ?? "unknown";

    if (input.status !== undefined) {
      if (input.status >= 200 && input.status < 300) {
        pStat.successCalls += 1;
      } else if (input.status === 429) {
        pStat.rateLimit429Count += 1;
      } else if (input.status === 404) {
        pStat.notFound404Count += 1;
      } else if (input.status >= 500) {
        pStat.error5xxCount += 1;
      }
    } else {
      pStat.networkErrorCount += 1;
    }

    this.providerStats.set(input.provider, pStat);
  }

  snapshot(): TelemetrySnapshot {
    const toolMetricsList = Array.from(this.toolMetrics.values()).sort(
      (a, b) => b.calls - a.calls,
    );
    const totalToolCalls = toolMetricsList.reduce((acc, m) => acc + m.calls, 0);
    const totalToolErrors = toolMetricsList.reduce((acc, m) => acc + m.errors, 0);
    const totalToolDuration = toolMetricsList.reduce((acc, m) => acc + m.totalDurationMs, 0);

    const providerHttpStats: Record<string, ProviderHttpStats> = {};
    let totalUpstreamHttpCalls = 0;
    let totalRateLimit429 = 0;

    for (const [k, v] of this.providerStats.entries()) {
      providerHttpStats[k] = { ...v };
      totalUpstreamHttpCalls += v.totalCalls;
      totalRateLimit429 += v.rateLimit429Count;
    }

    return {
      startedAt: this.startedAtIso,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - this.startedAtMs) / 1000)),
      totalToolCalls,
      totalToolErrors,
      avgToolDurationMs: totalToolCalls > 0 ? Math.round(totalToolDuration / totalToolCalls) : 0,
      totalUpstreamHttpCalls,
      totalRateLimit429,
      toolMetrics: toolMetricsList,
      providerHttpStats,
      recentToolCalls: [...this.recentToolCalls],
      recentHttpCalls: [...this.recentHttpCalls],
    };
  }
}

export const globalTelemetry = new TelemetryCollector();
