import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies safe production defaults when optional env vars are omitted", () => {
    const config = loadConfig({});

    expect(config.transport).toBe("stdio");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.cacheTtlSeconds).toBe(3600);
    expect(config.chinaTravel.enabled).toBe(true);
    expect(config.chinaTravel.proxyToken).toBe("tp_8k2mX9vQ4z");
    expect(config.chinaTravel.timeoutMs).toBe(60000);
    expect(config.tripadvisorTerra.apiKey).toBeUndefined();
    expect(config.tripadvisorTerra.baseUrl).toBe("https://terra.tripadvisor.com/api");
    expect(config.googlePlaces.apiKey).toBeUndefined();
    expect(config.googlePlaces.baseUrl).toBe("https://places.googleapis.com/v1");
  });

  it("treats empty-string API keys as undefined for graceful provider skipping", () => {
    const config = loadConfig({
      TRIPADVISOR_TERRA_API_KEY: "   ",
      GOOGLE_PLACES_API_KEY: "",
    });

    expect(config.tripadvisorTerra.apiKey).toBeUndefined();
    expect(config.googlePlaces.apiKey).toBeUndefined();
  });

  it("supports PROXY_TOKEN fallback and custom overrides", () => {
    const config = loadConfig({
      MCP_TRANSPORT: "http",
      PORT: "8080",
      CACHE_TTL_SECONDS: "120",
      PROXY_TOKEN: "custom_proxy_token",
      TRIPADVISOR_TERRA_API_KEY: "ta-key",
      GOOGLE_PLACES_API_KEY: "gp-key",
      MCP_ALLOWED_HOSTS: "localhost, api.internal",
    });

    expect(config.transport).toBe("http");
    expect(config.port).toBe(8080);
    expect(config.cacheTtlSeconds).toBe(120);
    expect(config.chinaTravel.proxyToken).toBe("custom_proxy_token");
    expect(config.tripadvisorTerra.apiKey).toBe("ta-key");
    expect(config.googlePlaces.apiKey).toBe("gp-key");
    expect(config.allowedHosts).toEqual(["localhost", "api.internal"]);
  });

  it("accepts TRIPADVISOR_API_KEY as an alias for TRIPADVISOR_TERRA_API_KEY", () => {
    const config = loadConfig({
      TRIPADVISOR_API_KEY: "alias-ta-key",
    });

    expect(config.tripadvisorTerra.apiKey).toBe("alias-ta-key");
  });

  it("throws a descriptive error for invalid configuration values", () => {
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ TRIPADVISOR_TERRA_BASE_URL: "not-a-url" })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
