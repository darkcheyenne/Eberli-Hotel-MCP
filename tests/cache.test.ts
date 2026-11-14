import { describe, expect, it, vi } from "vitest";
import { TtlCache, buildCacheKey } from "../src/utils/cache.js";

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

  it("builds deterministic keys regardless of property insertion order", () => {
    const k1 = buildCacheKey("ta", { b: 2, a: "x", ignored: undefined });
    const k2 = buildCacheKey("ta", { a: "x", b: 2 });
    expect(k1).toBe(k2);
  });
});
