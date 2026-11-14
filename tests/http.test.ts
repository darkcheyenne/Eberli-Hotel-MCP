import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  NetworkError,
  TimeoutError,
  fetchJson,
  withToolErrorHandling,
} from "../src/utils/http.js";

describe("fetchJson", () => {
  it("retries on 429 and 503 with backoff and succeeds", async () => {
    const sleepMock = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "1", "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("Service Unavailable", {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const data = await fetchJson<{ ok: boolean }>({
      provider: "google_places",
      url: "https://example.test/api",
      maxRetries: 3,
      baseDelayMs: 10,
      fetchImpl: fetchMock,
      sleepImpl: sleepMock,
    });

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
  });

  it("does not retry non-transient 404 errors and parses RFC 7807 problem+json", async () => {
    const sleepMock = vi.fn(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Not Found",
          status: 404,
          detail: "Location is not on allowlist",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    await expect(
      fetchJson({
        provider: "tripadvisor_terra",
        url: "https://terra.tripadvisor.com/api/locations/123",
        maxRetries: 3,
        fetchImpl: fetchMock,
        sleepImpl: sleepMock,
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
      isRetryable: false,
      problemDetails: {
        title: "Not Found",
        detail: "Location is not on allowlist",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("maps AbortSignal timeout errors to TimeoutError", async () => {
    const sleepMock = vi.fn(async () => undefined);
    const timeoutErr = new DOMException("Timed out", "TimeoutError");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(timeoutErr);

    await expect(
      fetchJson({
        provider: "china_travel",
        url: "https://example.test/slow",
        timeoutMs: 50,
        maxRetries: 1,
        baseDelayMs: 1,
        fetchImpl: fetchMock,
        sleepImpl: sleepMock,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps generic connection failures to NetworkError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      fetchJson({
        provider: "google_places",
        url: "https://example.test/down",
        maxRetries: 0,
        fetchImpl: fetchMock,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("formats provider errors cleanly in withToolErrorHandling", async () => {
    const wrapped = withToolErrorHandling("tripadvisor_terra", async () => {
      throw new HttpError("Not allowlisted", {
        provider: "tripadvisor_terra",
        status: 404,
        statusText: "Not Found",
        url: "https://terra.tripadvisor.com/api/locations/999",
        body: {},
        actionableHint: "Add location ID to Terra allowlist",
      });
    });

    const result = await wrapped({});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(parsed.error).toBe(true);
    expect(parsed.status).toBe(404);
    expect(parsed.actionableHint).toBe("Add location ID to Terra allowlist");
  });
});
