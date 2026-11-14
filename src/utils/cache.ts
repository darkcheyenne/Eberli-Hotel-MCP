export interface TtlCacheOptions {
  /** Time-to-live in seconds. Set to 0 to disable caching. */
  ttlSeconds: number;
  /** Maximum number of entries retained in memory (oldest accessed/inserted evicted first). */
  maxEntries?: number;
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
}

/**
 * Generic in-memory TTL cache with LRU-style eviction and in-flight request deduplication.
 */
export class TtlCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = Math.max(0, options.ttlSeconds) * 1000;
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.now = options.now ?? (() => Date.now());
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

    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }

    // Refresh recency in Map iteration order
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
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

    this.store.set(key, {
      value,
      expiresAt: this.now() + effectiveTtlMs,
    });
  }

  /**
   * Returns a cached value if fresh, or executes `loader` once across concurrent callers for the same key.
   */
  async getOrSet(key: string, loader: () => Promise<T>, overrideTtlSeconds?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const pending = loader()
      .then((result) => {
        this.set(key, result, overrideTtlSeconds);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  stats(): CacheStats {
    this.pruneExpired();
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      ttlSeconds: Math.round(this.ttlMs / 1000),
    };
  }

  private pruneExpired(): void {
    const current = this.now();
    for (const [key, entry] of this.store.entries()) {
      if (current >= entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Produces a stable cache key by sorting object keys deterministically.
 */
export function buildCacheKey(prefix: string, params: Record<string, unknown>): string {
  const sortedEntries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(sortedEntries)}`;
}
