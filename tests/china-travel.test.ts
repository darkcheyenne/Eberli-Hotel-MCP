import { describe, expect, it, vi } from "vitest";
import { ChinaTravelProvider } from "../src/providers/china-travel.js";
import { TtlCache } from "../src/utils/cache.js";

describe("ChinaTravelProvider", () => {
  it("sends TripGenie SCF proxy payload and headers matching china-travel-mcp", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: "Hotel list from Trip.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = new ChinaTravelProvider({
      proxyUrl: "https://1439498936-eu423jdjnd.ap-guangzhou.tencentscf.com",
      proxyToken: "tp_8k2mX9vQ4z",
      timeoutMs: 60000,
      maxRetries: 1,
      cache: new TtlCache({ ttlSeconds: 60 }),
      fetchImpl: fetchMock,
    });

    const result = await provider.searchHotels({
      city: "Shanghai",
      check_in: "2026-12-01",
      check_out: "2026-12-04",
      guests: 2,
      budget: "luxury",
      preferences: "near the Bund",
    });

    expect(result.content).toBe("Hotel list from Trip.com");
    expect(result.cached).toBe(false);
    expect(result.commandType).toBe("hotel");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://1439498936-eu423jdjnd.ap-guangzhou.tencentscf.com");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Proxy-Token": "tp_8k2mX9vQ4z",
      "User-Agent": "ChinaTravelMCP/1.0",
    });

    const parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(parsedBody).toEqual({
      query:
        "Find hotels in Shanghai, from 2026-12-01 to 2026-12-04, for 2 guests, budget: luxury, preferences: near the Bund, Include hotel names, prices per night, ratings, key features, and booking links.",
      locale: "en",
      command_type: "hotel",
    });

    // Second identical call should hit TTL cache
    const cachedResult = await provider.searchHotels({
      city: "Shanghai",
      check_in: "2026-12-01",
      check_out: "2026-12-04",
      guests: 2,
      budget: "luxury",
      preferences: "near the Bund",
    });
    expect(cachedResult.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("constructs flight, attraction, itinerary, and travel tips queries faithfully", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { command_type: string; query: string };
      return new Response(JSON.stringify(`${body.command_type}:${body.query}`), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new ChinaTravelProvider({
      proxyUrl: "https://proxy.example.test",
      proxyToken: "tok",
      timeoutMs: 5000,
      maxRetries: 0,
      cache: new TtlCache({ ttlSeconds: 0 }),
      fetchImpl: fetchMock,
    });

    const flight = await provider.searchFlights({
      origin: "Zurich",
      destination: "Beijing",
      date: "2026-12-10",
      trip_type: "round trip",
      cabin: "business",
    });
    expect(flight.content).toContain("flight:Find business class flights from Zurich to Beijing on 2026-12-10, round trip.");

    const attraction = await provider.searchAttractions({
      city: "Xi'an",
      days: 2,
      interests: "history",
    });
    expect(attraction.content).toContain("attraction:What are the top attractions and things to do in Xi'an, for 2 days, interested in: history");

    const itinerary = await provider.planItinerary({
      city: "Chengdu",
      days: 4,
      travelers: 1,
      budget: "mid-range",
    });
    expect(itinerary.content).toContain("itinerary:Plan a 4-day itinerary for Chengdu, for 1 traveler, budget level: mid-range");

    const tips = await provider.getTravelTips({ question: "How to use Alipay?" });
    expect(tips.content).toBe("query:How to use Alipay?");
  });
});
