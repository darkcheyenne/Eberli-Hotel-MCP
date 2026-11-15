import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TtlCache, buildCacheKey } from "../src/utils/cache.js";
import { HttpError } from "../src/utils/http.js";

describe("TtlCache", () => {
  it("stores and expires entries according to TTL", () => {
    let now = 1000;
    const cache = new TtlCache<string>({ ttlSeconds: 10, now: () => now });

    cache.set("k1", "value-1");
    expect(cache.get("k1")).toBe("value-1");

    now += 9999;
    expect(cache.get("k1")).toBe("value-1");

    now += 1;
    expect(cache.get("k1")).toBeUndefined();
  });

  it("disables caching when ttlSeconds is 0", () => {
    const cache = new TtlCache<string>({ ttlSeconds: 0 });
    expect(cache.enabled).toBe(false);

    cache.set("k1", "value");
    expect(cache.get("k1")).toBeUndefined();
  });

  it("evicts least recently used entries when maxEntries is exceeded", () => {
    const cache = new TtlCache<number>({ ttlSeconds: 60, maxEntries: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    // Access "a" so "b" becomes the oldest
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.stats().evictions).toBe(1);
  });

  it("deduplicates concurrent in-flight getOrSet calls", async () => {
    const cache = new TtlCache<string>({ ttlSeconds: 60 });
    const loader = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "loaded";
    });

    const [r1, r2, r3] = await Promise.all([
      cache.getOrSet("same", loader),
      cache.getOrSet("same", loader),
      cache.getOrSet("same", loader),
    ]);

    expect(r1).toBe("loaded");
    expect(r2).toBe("loaded");
    expect(r3).toBe("loaded");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("builds deterministic keys regardless of property insertion order and normalizes query casing", () => {
    const k1 = buildCacheKey("ta", { b: 2, a: "  Futian Shangri-La  ", ignored: undefined });
    const k2 = buildCacheKey("ta", { a: "futian shangri-la", b: 2 });
    expect(k1).toBe(k2);

    // Case-sensitive Google Place IDs must remain case-sensitive
    const p1 = buildCacheKey("gp", { placeId: "ChIJwaYX" });
    const p2 = buildCacheKey("gp", { placeId: "chijwayx" });
    expect(p1).not.toBe(p2);
  });

  it("serves stale cached value when upstream fails with HTTP 429 rate limit", async () => {
    let now = 1000;
    const cache = new TtlCache<string>({
      ttlSeconds: 10,
      staleTtlSeconds: 60,
      now: () => now,
    });

    cache.set("hotel:1141607", "cached-hotel-payload");
    // Advance past primary 10s TTL, but still within 60s stale grace window
    now += 15_000;
    expect(cache.get("hotel:1141607")).toBeUndefined();

    const rateLimitedLoader = vi.fn(async () => {
      throw new HttpError("Rate limit exceeded", {
        provider: "tripadvisor_terra",
        status: 429,
        statusText: "Too Many Requests",
        url: "https://terra.tripadvisor.com/api/locations/1141607",
        body: {},
      });
    });

    const fallback = await cache.getOrSet("hotel:1141607", rateLimitedLoader);
    expect(fallback).toBe("cached-hotel-payload");
    expect(rateLimitedLoader).toHaveBeenCalledTimes(1);
  });

  it("persists and reloads cache entries from disk across restarts", () => {
    const persistFilePath = join(tmpdir(), `eberli-mcp-cache-test-${Date.now()}.json`);
    try {
      const cache1 = new TtlCache<string>({
        ttlSeconds: 300,
        persistFilePath,
      });
      cache1.set("persisted-key", "persisted-value");
      cache1.flushToDisk();

      const cache2 = new TtlCache<string>({
        ttlSeconds: 300,
        persistFilePath,
      });
      expect(cache2.get("persisted-key")).toBe("persisted-value");
    } finally {
      rmSync(persistFilePath, { force: true });
    }
  });
});
