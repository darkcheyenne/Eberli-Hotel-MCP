import { globalTelemetry } from "./telemetry.js";

export type ProviderName =
  | "china_travel"
  | "tripadvisor_terra"
  | "google_places"
  | "system";

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
}

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: string;
  readonly actionableHint?: string;

  constructor(
    message: string,
    options: {
      provider: ProviderName;
      code: string;
      actionableHint?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.provider = options.provider;
    this.code = options.code;
    this.actionableHint = options.actionableHint;
  }
}

export class ProviderConfigError extends ProviderError {
  constructor(provider: ProviderName, message: string, actionableHint?: string) {
    super(message, { provider, code: "PROVIDER_NOT_CONFIGURED", actionableHint });
  }
}

export class HttpError extends ProviderError {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body: unknown;
  readonly problemDetails?: ProblemDetails;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    options: {
      provider: ProviderName;
      status: number;
      statusText: string;
      url: string;
      body: unknown;
      problemDetails?: ProblemDetails;
      actionableHint?: string;
    },
  ) {
    const isRetryable = options.status === 429 || (options.status >= 500 && options.status <= 599);
    super(message, {
      provider: options.provider,
      code: `HTTP_${options.status}`,
      actionableHint: options.actionableHint,
    });
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
    this.body = options.body;
    this.problemDetails = options.problemDetails;
    this.isRetryable = isRetryable;
  }
}

export class TimeoutError extends ProviderError {
  readonly timeoutMs: number;
  readonly url: string;

  constructor(provider: ProviderName, url: string, timeoutMs: number, cause?: unknown) {
    super(`Request to ${provider} timed out after ${timeoutMs}ms`, {
      provider,
      code: "REQUEST_TIMEOUT",
      actionableHint: "Retry the request or increase HTTP_TIMEOUT_MS / CHINA_TRAVEL_TIMEOUT_MS.",
      cause,
    });
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

export class NetworkError extends ProviderError {
  readonly url: string;

  constructor(provider: ProviderName, url: string, message: string, cause?: unknown) {
    super(`Network error calling ${provider}: ${message}`, {
      provider,
      code: "NETWORK_ERROR",
      actionableHint: "Verify outbound network connectivity and provider base URL.",
      cause,
    });
    this.url = url;
  }
}

export interface HttpRequestOptions {
  provider: ProviderName;
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfterMs(headerValue: string | null, nowMs = Date.now()): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - nowMs);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractProblemDetails(body: unknown): ProblemDetails | undefined {
  if (!isRecord(body)) return undefined;
  if (
    typeof body.title === "string" ||
    typeof body.detail === "string" ||
    typeof body.type === "string"
  ) {
    return {
      type: typeof body.type === "string" ? body.type : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      status: typeof body.status === "number" ? body.status : undefined,
      detail: typeof body.detail === "string" ? body.detail : undefined,
      instance: typeof body.instance === "string" ? body.instance : undefined,
    };
  }
  return undefined;
}

export function extractApiErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string" && body.trim().length > 0) {
    return body.trim();
  }
  if (!isRecord(body)) return undefined;

  if (typeof body.detail === "string" && body.detail.trim().length > 0) {
    return typeof body.title === "string" && body.title.trim().length > 0
      ? `${body.title}: ${body.detail}`
      : body.detail;
  }
  if (typeof body.title === "string" && body.title.trim().length > 0) {
    return body.title;
  }
  if (isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message;
  }
  if (typeof body.message === "string" && body.message.trim().length > 0) {
    return body.message;
  }
  return undefined;
}

function isAbortTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
}

function computeBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs * 0.5;
  return Math.min(maxDelayMs, Math.round(exponential + jitter));
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Executes an HTTP request using Node's built-in fetch with AbortSignal.timeout,
 * structured error mapping, and exponential backoff retries on transient 429 / 5xx / network errors.
 */
export async function fetchJson<T = unknown>(options: HttpRequestOptions): Promise<T> {
  const {
    provider,
    url,
    method = "GET",
    headers = {},
    body,
    timeoutMs = 15000,
    maxRetries = 3,
    baseDelayMs = 400,
    maxDelayMs = 10000,
    signal,
    fetchImpl = globalThis.fetch,
    sleepImpl = defaultSleep,
  } = options;

  const requestHeaders: Record<string, string> = { ...headers };
  let serializedBody: string | undefined;
  if (body !== undefined) {
    serializedBody = typeof body === "string" ? body : JSON.stringify(body);
    if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === "content-type")) {
      requestHeaders["Content-Type"] = "application/json";
    }
  }

  let lastError: unknown;
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: combinedSignal,
      });

      const parsedBody = await parseResponseBody(response);

      if (response.ok) {
        globalTelemetry.recordHttpCall({
          provider,
          method,
          url,
          status: response.status,
          durationMs: Date.now() - startedAt,
          attempts: attempt + 1,
        });
        return parsedBody as T;
      }

      const problemDetails = extractProblemDetails(parsedBody);
      const apiDetail = extractApiErrorMessage(parsedBody);
      const message = apiDetail
        ? `${provider} returned HTTP ${response.status}: ${apiDetail}`
        : `${provider} returned HTTP ${response.status} ${response.statusText}`;

      const httpError = new HttpError(message, {
        provider,
        status: response.status,
        statusText: response.statusText,
        url,
        body: parsedBody,
        problemDetails,
      });

      if (httpError.isRetryable && attempt < maxRetries) {
        lastError = httpError;
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const delayMs =
          retryAfterMs !== undefined
            ? Math.min(maxDelayMs, retryAfterMs)
            : computeBackoffDelay(attempt, baseDelayMs, maxDelayMs);
        await sleepImpl(delayMs);
        continue;
      }

      globalTelemetry.recordHttpCall({
        provider,
        method,
        url,
        status: response.status,
        durationMs: Date.now() - startedAt,
        attempts: attempt + 1,
        error: message,
      });
      throw httpError;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      // If caller aborted explicitly (not timeout), do not retry
      if (signal?.aborted) {
        globalTelemetry.recordHttpCall({
          provider,
          method,
          url,
          durationMs: Date.now() - startedAt,
          attempts: attempt + 1,
          error: "Request aborted by caller",
        });
        throw new NetworkError(provider, url, "Request aborted by caller", error);
      }

      const structuredError = isAbortTimeoutError(error)
        ? new TimeoutError(provider, url, timeoutMs, error)
        : new NetworkError(
            provider,
            url,
            error instanceof Error ? error.message : String(error),
            error,
          );

      if (attempt < maxRetries) {
        lastError = structuredError;
        await sleepImpl(computeBackoffDelay(attempt, baseDelayMs, maxDelayMs));
        continue;
      }

      globalTelemetry.recordHttpCall({
        provider,
        method,
        url,
        durationMs: Date.now() - startedAt,
        attempts: attempt + 1,
        error: structuredError.message,
      });
      throw structuredError;
    }
  }

  throw lastError;
}

export interface FormattedToolError {
  error: true;
  provider: ProviderName;
  code: string;
  status?: number;
  message: string;
  actionableHint?: string;
  problemDetails?: ProblemDetails;
}

export function formatProviderError(error: unknown, fallbackProvider: ProviderName = "system"): FormattedToolError {
  if (error instanceof HttpError) {
    return {
      error: true,
      provider: error.provider,
      code: error.code,
      status: error.status,
      message: error.message,
      actionableHint: error.actionableHint,
      problemDetails: error.problemDetails,
    };
  }
  if (error instanceof ProviderError) {
    return {
      error: true,
      provider: error.provider,
      code: error.code,
      message: error.message,
      actionableHint: error.actionableHint,
    };
  }
  return {
    error: true,
    provider: fallbackProvider,
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

export interface McpToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function jsonToolResult(payload: unknown): McpToolTextResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export function textToolResult(text: string): McpToolTextResult {
  return {
    content: [{ type: "text", text }],
  };
}

/**
 * Wraps an MCP tool callback with uniform structured error handling.
 */
export function withToolErrorHandling<TArgs>(
  provider: ProviderName,
  handler: (args: TArgs) => Promise<McpToolTextResult>,
): (args: TArgs) => Promise<McpToolTextResult> {
  return async (args: TArgs): Promise<McpToolTextResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(formatProviderError(error, provider), null, 2),
          },
        ],
      };
    }
  };
}
