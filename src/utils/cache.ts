import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TtlCacheOptions {
  /** Time-to-live in seconds. Set to 0 to disable caching. */
  ttlSeconds: number;
  /**
   * Additional grace period in seconds during which expired entries are retained
   * as stale fallback if an upstream provider fails with HTTP 429 / 5xx / timeout.
   * Defaults to 7x ttlSeconds (or 0 when ttlSeconds is 0).
   */
  staleTtlSeconds?: number;
  /** Maximum number of entries retained in memory (oldest accessed/inserted evicted first). */
  maxEntries?: number;
  /** Optional file path for persistent L2 disk caching across restarts. */
  persistFilePath?: string;
  /** Clock provider for deterministic testing. */
  now?: () => number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  ttlSeconds: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleExpiresAt: number;
}

interface SerializedCacheFile {
  version: 1;
  savedAt: number;
  entries: Array<[string, CacheEntry<unknown>]>;
}

/**
 * Generic in-memory + optional disk-backed TTL cache with:
 * - LRU eviction
 * - In-flight request deduplication (coalescing concurrent identical queries)
 * - Stale-if-error fallback (serves stale cached data when upstream APIs hit 429 rate limits or 5xx errors)
 * - Optional persistent disk storage across process restarts
 */
export class TtlCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly staleTtlMs: number;
  private readonly maxEntries: number;
  private readonly persistFilePath?: string;
  private readonly now: () => number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private persistTimer?: ReturnType<typeof setTimeout>;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = Math.max(0, options.ttlSeconds) * 1000;
    const defaultStaleSeconds = options.ttlSeconds > 0 ? Math.max(options.ttlSeconds * 7, 3600) : 0;
    this.staleTtlMs =
      options.staleTtlSeconds !== undefined
        ? Math.max(0, options.staleTtlSeconds) * 1000
        : defaultStaleSeconds * 1000;
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.persistFilePath = options.persistFilePath;
    this.now = options.now ?? (() => Date.now());

    if (this.persistFilePath && this.enabled) {
      this.loadFromDisk();
    }
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: string): T | undefined {
    if (!this.enabled) {
      this.misses += 1;
      return undefined;
    }

    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    const current = this.now();
    if (current >= entry.expiresAt) {
      if (current >= entry.staleExpiresAt) {
        this.store.delete(key);
      }
      this.misses += 1;
      return undefined;
    }

    // Refresh recency in Map iteration order
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /**
   * Returns a stale (expired but within staleTtlMs grace period) value if available.
   * Used when an upstream API returns 429 Too Many Requests or transient 5xx/timeout errors.
   */
  getStale(key: string): T | undefined {
    if (!this.enabled) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.staleExpiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, overrideTtlSeconds?: number): void {
    const effectiveTtlMs =
      overrideTtlSeconds !== undefined ? Math.max(0, overrideTtlSeconds) * 1000 : this.ttlMs;

    if (effectiveTtlMs <= 0) {
      return;
    }

    if (this.store.has(key)) {
      this.store.delete(key);
    } else {
      this.pruneExpired();
      while (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) break;
        this.store.delete(oldestKey);
        this.evictions += 1;
      }
    }

    const current = this.now();
    const expiresAt = current + effectiveTtlMs;
    const staleExpiresAt = expiresAt + Math.max(this.staleTtlMs, effectiveTtlMs);

    this.store.set(key, {
      value,
      expiresAt,
      staleExpiresAt,
    });

    this.scheduleDiskPersist();
  }

  /**
   * Returns a cached value if fresh, or executes `loader` once across concurrent callers for the same key.
   * If `loader` fails and a stale entry exists within the grace window, returns the stale value to protect against rate limits.
   */
  async getOrSet(key: string, loader: () => Promise<T>, overrideTtlSeconds?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      this.hits += 1;
      return existingPromise;
    }

    const staleCandidate = this.getStale(key);

    const pending = loader()
      .then((result) => {
        this.set(key, result, overrideTtlSeconds);
        return result;
      })
      .catch((error: unknown) => {
        if (staleCandidate !== undefined && TtlCache.isTransientOrRateLimitError(error)) {
          this.hits += 1;
          return staleCandidate;
        }
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  static isTransientOrRateLimitError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const maybeErr = error as { status?: number; isRetryable?: boolean; name?: string; code?: string };
    if (maybeErr.status === 429 || (typeof maybeErr.status === "number" && maybeErr.status >= 500)) {
      return true;
    }
    if (maybeErr.isRetryable === true) return true;
    if (maybeErr.name === "TimeoutError" || maybeErr.name === "NetworkError") return true;
    if (maybeErr.code === "REQUEST_TIMEOUT" || maybeErr.code === "NETWORK_ERROR") return true;
    return false;
  }

  delete(key: string): boolean {
    const removed = this.store.delete(key);
    if (removed) this.scheduleDiskPersist();
    return removed;
  }

  clear(): void {
    this.store.clear();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
  }

  stats(): CacheStats {
    this.pruneFullyExpired();
    return {
      size: this.countFreshEntries(),
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      ttlSeconds: Math.round(this.ttlMs / 1000),
    };
  }

  detailedStats(): CacheStats & {
    hitRatePercent: number;
    maxEntries: number;
    staleRetainedCount: number;
    staleTtlSeconds: number;
    inFlightCount: number;
    entriesByPrefix: Record<string, number>;
    recentEntries: Array<{ key: string; prefix: string; expiresInSeconds: number; isStale: boolean }>;
  } {
    this.pruneFullyExpired();
    const base = this.stats();
    const totalLookups = base.hits + base.misses;
    const hitRatePercent =
      totalLookups > 0 ? Math.round((base.hits / totalLookups) * 1000) / 10 : 0;

    const current = this.now();
    let staleRetainedCount = 0;
    const entriesByPrefix: Record<string, number> = {};
    const recentEntries: Array<{
      key: string;
      prefix: string;
      expiresInSeconds: number;
      isStale: boolean;
    }> = [];

    for (const [key, entry] of this.store.entries()) {
      const isStale = current >= entry.expiresAt;
      if (isStale) {
        staleRetainedCount += 1;
      } else {
        const prefix = key.split(":")[0] ?? "other";
        entriesByPrefix[prefix] = (entriesByPrefix[prefix] ?? 0) + 1;
      }
      recentEntries.push({
        key: key.length > 140 ? `${key.slice(0, 140)}…` : key,
        prefix: key.split(":")[0] ?? "other",
        expiresInSeconds: Math.max(0, Math.round((entry.expiresAt - current) / 1000)),
        isStale,
      });
    }

    return {
      ...base,
      hitRatePercent,
      maxEntries: this.maxEntries,
      staleRetainedCount,
      staleTtlSeconds: Math.round(this.staleTtlMs / 1000),
      inFlightCount: this.inFlight.size,
      entriesByPrefix,
      recentEntries: recentEntries.reverse().slice(0, 30),
    };
  }

  flushToDisk(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (!this.persistFilePath || !this.enabled) return;

    try {
      this.pruneFullyExpired();
      const dir = dirname(this.persistFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const payload: SerializedCacheFile = {
        version: 1,
        savedAt: this.now(),
        entries: Array.from(this.store.entries()),
      };
      const tmpPath = `${this.persistFilePath}.tmp.${process.pid}`;
      writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
      renameSync(tmpPath, this.persistFilePath);
    } catch {
      // Ignore disk write errors on read-only filesystems
    }
  }

  private scheduleDiskPersist(): void {
    if (!this.persistFilePath || !this.enabled) return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.flushToDisk();
    }, 1500);
    this.persistTimer.unref?.();
  }

  private loadFromDisk(): void {
    if (!this.persistFilePath || !existsSync(this.persistFilePath)) return;
    try {
      const raw = readFileSync(this.persistFilePath, "utf8");
      const parsed = JSON.parse(raw) as SerializedCacheFile;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return;

      const current = this.now();
      for (const [key, entry] of parsed.entries) {
        if (
          typeof key === "string" &&
          entry &&
          typeof entry.expiresAt === "number" &&
          current < (entry.staleExpiresAt ?? entry.expiresAt)
        ) {
          this.store.set(key, {
            value: entry.value as T,
            expiresAt: entry.expiresAt,
            staleExpiresAt: entry.staleExpiresAt ?? entry.expiresAt + this.staleTtlMs,
          });
        }
      }
    } catch {
      // Ignore corrupt or unreadable cache files
    }
  }

  private countFreshEntries(): number {
    const current = this.now();
    let count = 0;
    for (const entry of this.store.values()) {
      if (current < entry.expiresAt) {
        count += 1;
      }
    }
    return count;
  }

  private pruneExpired(): void {
    const current = this.now();
    // First remove entries past their stale window
    for (const [key, entry] of this.store.entries()) {
      if (current >= entry.staleExpiresAt) {
        this.store.delete(key);
      }
    }
    // If still at capacity, remove entries past their primary expiresAt
    if (this.store.size >= this.maxEntries) {
      for (const [key, entry] of this.store.entries()) {
        if (current >= entry.expiresAt) {
          this.store.delete(key);
        }
      }
    }
  }

  private pruneFullyExpired(): void {
    const current = this.now();
    for (const [key, entry] of this.store.entries()) {
      if (current >= entry.staleExpiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Produces a stable cache key by sorting object keys deterministically
 * and normalizing string whitespace/casing where appropriate.
 */
export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  const sortedEntries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]): [string, unknown] => {
      if (typeof value === "string") {
        const trimmed = value.trim().replace(/\s+/g, " ");
        // Keep case-sensitive IDs intact (placeId, photoName), normalize search/query strings
        if (key === "placeId" || key === "cleanId" || key === "photoName" || key === "cleanPhotoName") {
          return [key, trimmed];
        }
        return [key, trimmed.toLowerCase()];
      }
      return [key, value];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(sortedEntries)}`;
}
