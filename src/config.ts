import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z.string().min(1).optional(),
);

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_ALLOWED_HOSTS: optionalNonEmptyString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).default(500),

  HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),

  CHINA_TRAVEL_ENABLED: booleanFromEnv.default(true),
  CHINA_TRAVEL_PROXY_URL: z
    .string()
    .url()
    .default("https://1439498936-eu423jdjnd.ap-guangzhou.tencentscf.com"),
  CHINA_TRAVEL_PROXY_TOKEN: optionalNonEmptyString,
  PROXY_TOKEN: optionalNonEmptyString,
  CHINA_TRAVEL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),

  TRIPADVISOR_TERRA_API_KEY: optionalNonEmptyString,
  TRIPADVISOR_TERRA_BASE_URL: z
    .string()
    .url()
    .default("https://terra.tripadvisor.com/api"),

  GOOGLE_PLACES_API_KEY: optionalNonEmptyString,
  GOOGLE_PLACES_BASE_URL: z
    .string()
    .url()
    .default("https://places.googleapis.com/v1"),
});

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  transport: "stdio" | "http";
  host: string;
  port: number;
  allowedHosts?: string[];
  logLevel: LogLevel;
  cacheTtlSeconds: number;
  cacheMaxEntries: number;
  httpTimeoutMs: number;
  httpMaxRetries: number;
  chinaTravel: {
    enabled: boolean;
    proxyUrl: string;
    proxyToken: string;
    timeoutMs: number;
  };
  tripadvisorTerra: {
    apiKey?: string;
    baseUrl: string;
  };
  googlePlaces: {
    apiKey?: string;
    baseUrl: string;
  };
}

const DEFAULT_CHINA_TRAVEL_TOKEN = "tp_8k2mX9vQ4z";

/**
 * Validates environment variables with Zod and returns typed application configuration.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const data = parsed.data;
  const allowedHosts = data.MCP_ALLOWED_HOSTS
    ? data.MCP_ALLOWED_HOSTS.split(",")
        .map((h) => h.trim())
        .filter((h) => h.length > 0)
    : undefined;

  return {
    transport: data.MCP_TRANSPORT,
    host: data.HOST,
    port: data.PORT,
    allowedHosts,
    logLevel: data.LOG_LEVEL,
    cacheTtlSeconds: data.CACHE_TTL_SECONDS,
    cacheMaxEntries: data.CACHE_MAX_ENTRIES,
    httpTimeoutMs: data.HTTP_TIMEOUT_MS,
    httpMaxRetries: data.HTTP_MAX_RETRIES,
    chinaTravel: {
      enabled: data.CHINA_TRAVEL_ENABLED,
      proxyUrl: data.CHINA_TRAVEL_PROXY_URL,
      proxyToken:
        data.CHINA_TRAVEL_PROXY_TOKEN ?? data.PROXY_TOKEN ?? DEFAULT_CHINA_TRAVEL_TOKEN,
      timeoutMs: data.CHINA_TRAVEL_TIMEOUT_MS,
    },
    tripadvisorTerra: {
      apiKey: data.TRIPADVISOR_TERRA_API_KEY,
      baseUrl: data.TRIPADVISOR_TERRA_BASE_URL.replace(/\/+$/, ""),
    },
    googlePlaces: {
      apiKey: data.GOOGLE_PLACES_API_KEY,
      baseUrl: data.GOOGLE_PLACES_BASE_URL.replace(/\/+$/, ""),
    },
  };
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Creates a stderr-only logger so stdio MCP JSON-RPC traffic on stdout is never corrupted.
 */
export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = LOG_PRIORITY[level];

  const write = (msgLevel: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (LOG_PRIORITY[msgLevel] < threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level: msgLevel,
      msg: message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}
