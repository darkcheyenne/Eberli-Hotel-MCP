import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { type Logger, loadConfig } from "../src/config.js";
import { startHttpServer } from "../src/index.js";
import { createTravelMcpServer } from "../src/server.js";

function createTestLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (msg) => warnings.push(msg),
      error: () => undefined,
    },
  };
}

describe("MCP Server integration & graceful provider loading", () => {
  it("skips TripAdvisor and Google Places tools with clear warnings when API keys are missing", async () => {
    const config = loadConfig({});
    const { logger, warnings } = createTestLogger();

    const created = createTravelMcpServer({ config, logger });

    expect(created.enabledProviders).toEqual(["china_travel"]);
    expect(created.registeredTools).toEqual([
      "china_search_hotels",
      "china_get_hotel_reviews",
      "china_search_flights",
      "china_search_attractions",
      "china_plan_itinerary",
      "china_get_travel_tips",
      "compare_hotel_intelligence",
      "evaluate_hotel_criteria",
      "compare_hotels_batch",
    ]);
    expect(warnings.some((w) => w.includes("TRIPADVISOR_TERRA_API_KEY"))).toBe(true);
    expect(warnings.some((w) => w.includes("GOOGLE_PLACES_API_KEY"))).toBe(true);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([created.server.connect(serverTransport), client.connect(clientTransport)]);

    const listResult = await client.listTools();
    const names = listResult.tools.map((t) => t.name);
    expect(names).toContain("china_search_hotels");
    expect(names).toContain("china_get_hotel_reviews");
    expect(names).toContain("evaluate_hotel_criteria");
    expect(names).toContain("compare_hotels_batch");
    expect(names).not.toContain("ta_search_locations");
    expect(names).not.toContain("gplaces_search_text");

    await client.close();
    await created.server.close();
  });

  it("registers all 18 tools when all providers are configured and handles hotel checklist features", async () => {
    const config = loadConfig({
      TRIPADVISOR_TERRA_API_KEY: "ta-secret",
      GOOGLE_PLACES_API_KEY: "gp-secret",
    });
    const { logger } = createTestLogger();

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("tencentscf.com")) {
        return new Response(
          JSON.stringify({
            data: "The Peninsula Shanghai — 4.9/5, $420/night. Book: https://www.trip.com/hotels/peninsula-shanghai",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/search")) {
        if (url.includes("Grand+Hyatt") || url.includes("Grand%20Hyatt")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  location_id: "33458379",
                  name: "The Grand Hyatt Hotel",
                  address_obj: { city: "Shenzhen", street1: "Bao'an District" },
                  rating: "3.5",
                  num_reviews: "12",
                },
                {
                  location_id: "1526508",
                  name: "Grand Hyatt Shenzhen",
                  address_obj: { city: "Shenzhen", street1: "1881 Baoan Nan Road, Luohu" },
                  rating: "4.5",
                  num_reviews: "1850",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            data: [{ location_id: "1001", name: "The Peninsula Shanghai" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/1001/reviews")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 1,
                title: "Iconic Bund view and great breakfast",
                rating: 5,
                text: "Impeccable service. The Western breakfast buffet and heated indoor pool were fantastic.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/1001")) {
        return new Response(
          JSON.stringify({
            location_id: "1001",
            name: "The Peninsula Shanghai",
            rating: "5.0",
            num_reviews: "3000",
            price_level: "$$$$",
            web_url: "https://www.tripadvisor.com/Hotel_Review-1001",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/1141607/reviews")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 101,
                title: "Wonderful stay",
                rating: 5,
                text: "Great Western breakfast and heated indoor pool.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/1141607")) {
        return new Response(
          JSON.stringify({
            location_id: "1141607",
            name: "Futian Shangri-La, Shenzhen",
            rating: "5.0",
            num_reviews: "19530",
            address_obj: { city: "Shenzhen", country: "China" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/1526508")) {
        return new Response(
          JSON.stringify({
            location_id: "1526508",
            name: "Grand Hyatt Shenzhen",
            rating: "4.5",
            num_reviews: "1850",
            address_obj: { city: "Shenzhen", country: "China" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("terra.tripadvisor.com/api/locations/404999")) {
        return new Response(
          JSON.stringify({ title: "Not Found", status: 404, detail: "Not on allowlist" }),
          { status: 404, headers: { "Content-Type": "application/problem+json" } },
        );
      }

      if (url.includes("places.googleapis.com/v1/places:searchText")) {
        return new Response(
          JSON.stringify({
            places: [
              {
                id: "ChIJpeninsula",
                displayName: { text: "The Peninsula Shanghai" },
                rating: 4.7,
                userRatingCount: 1000,
                priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("places.googleapis.com/v1/places/ChIJpeninsula")) {
        return new Response(
          JSON.stringify({
            id: "ChIJpeninsula",
            displayName: { text: "The Peninsula Shanghai" },
            rating: 4.7,
            userRatingCount: 1000,
            priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE",
            editorialSummary: { text: "Art Deco landmark on the Bund." },
            reviews: [{ rating: 5, text: { text: "World-class hospitality." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    });

    const created = createTravelMcpServer({ config, logger, fetchImpl: fetchMock });
    expect(created.enabledProviders).toEqual([
      "china_travel",
      "tripadvisor_terra",
      "google_places",
    ]);
    expect(created.registeredTools).toHaveLength(18);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([created.server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. Cross-provider comparison with amenities, pricing, candidates, and criteriaEvaluation
    const compareRes = await client.callTool({
      name: "compare_hotel_intelligence",
      arguments: {
        hotelName: "The Peninsula Shanghai",
        city: "Shanghai",
        country: "China",
        language: "de",
      },
    });
    expect(compareRes.isError).toBeFalsy();
    const comparePayload = JSON.parse(
      (compareRes.content[0] as { type: "text"; text: string }).text,
    ) as {
      consensus: { scoreOutOf5: number; totalReviews: number; providerCount: number };
      providerDivergence: boolean;
      pricing: { perNightUsd: number; currency: string; source: string };
      amenities: { indoor_pool: boolean; pool_heated: boolean; western_breakfast: boolean };
      sources: { amenities: string; asOf: string };
      criteriaEvaluation: { overallVerdict: string; passedCount: number };
      providers: {
        tripadvisorTerra: { status: string };
        googlePlaces: { status: string };
        chinaTravel: { status: string; highlights: { bookingUrls: string[] } };
      };
    };

    expect(comparePayload.providers.tripadvisorTerra.status).toBe("ok");
    expect(comparePayload.providers.googlePlaces.status).toBe("ok");
    expect(comparePayload.providers.chinaTravel.status).toBe("ok");
    expect(comparePayload.consensus.scoreOutOf5).toBe(4.93);
    expect(comparePayload.consensus.totalReviews).toBe(4000);
    expect(comparePayload.pricing.perNightUsd).toBe(420);
    expect(comparePayload.amenities.indoor_pool).toBe(true);
    expect(comparePayload.amenities.pool_heated).toBe(true);
    expect(comparePayload.amenities.western_breakfast).toBe(true);
    expect(comparePayload.sources.amenities).toBe("trip.com");
    expect(comparePayload.criteriaEvaluation.overallVerdict).toBe("pass");
    expect(comparePayload.providers.chinaTravel.highlights.bookingUrls).toContain(
      "https://www.trip.com/hotels/peninsula-shanghai",
    );

    // 2. ta_get_location_details includes structured amenities, sources, and pricing
    const taDetailsRes = await client.callTool({
      name: "ta_get_location_details",
      arguments: { locationId: "1141607" },
    });
    expect(taDetailsRes.isError).toBeFalsy();
    const taDetailsPayload = JSON.parse(
      (taDetailsRes.content[0] as { type: "text"; text: string }).text,
    ) as {
      amenities: {
        smoking_area: boolean;
        smoking_area_24h: boolean;
        indoor_pool: boolean;
        pool_heated: boolean;
        laundry_self_service: boolean;
        western_breakfast: boolean;
      };
      sources: { amenities: string };
      pricing: { perNightUsd: number };
      location: { priceTier: string };
    };
    expect(taDetailsPayload.amenities.smoking_area).toBe(true);
    expect(taDetailsPayload.amenities.smoking_area_24h).toBe(true);
    expect(taDetailsPayload.amenities.indoor_pool).toBe(true);
    expect(taDetailsPayload.amenities.pool_heated).toBe(true);
    expect(taDetailsPayload.amenities.laundry_self_service).toBe(true);
    expect(taDetailsPayload.amenities.western_breakfast).toBe(true);
    expect(taDetailsPayload.pricing.perNightUsd).toBe(161);
    expect(taDetailsPayload.location.priceTier).toBe("$$$");

    // 3. ta_get_location_reviews supports query and topics and returns topicStats & snippets
    const taReviewsRes = await client.callTool({
      name: "ta_get_location_reviews",
      arguments: {
        locationId: "1141607",
        language: "de",
        query: "breakfast",
        topics: ["breakfast", "smoking", "noise", "pool", "cleanliness", "service"],
      },
    });
    expect(taReviewsRes.isError).toBeFalsy();
    const taReviewsPayload = JSON.parse(
      (taReviewsRes.content[0] as { type: "text"; text: string }).text,
    ) as {
      topicStats: Record<string, { mentions: number; reviews: number; negative: number }>;
      snippets: Array<{ topic: string; text: string }>;
    };
    expect(taReviewsPayload.topicStats.breakfast?.reviews).toBeGreaterThan(0);
    expect(taReviewsPayload.snippets.length).toBeGreaterThan(0);

    // 4. evaluate_hotel_criteria evaluates all 5 mandatory criteria
    const evalRes = await client.callTool({
      name: "evaluate_hotel_criteria",
      arguments: {
        hotelName: "Futian Shangri-La, Shenzhen",
        city: "Shenzhen",
        tripadvisorLocationId: "1141607",
      },
    });
    expect(evalRes.isError).toBeFalsy();
    const evalPayload = JSON.parse(
      (evalRes.content[0] as { type: "text"; text: string }).text,
    ) as {
      overallVerdict: string;
      passedCount: number;
      criteria: {
        budget_and_rating: { verdict: string };
        smoking_policy: { verdict: string };
        western_breakfast: { verdict: string };
        laundry_solution: { verdict: string };
        pool_aesthetics_location: { verdict: string };
      };
    };
    expect(evalPayload.overallVerdict).toBe("pass");
    expect(evalPayload.passedCount).toBe(5);
    expect(evalPayload.criteria.budget_and_rating.verdict).toBe("pass");
    expect(evalPayload.criteria.smoking_policy.verdict).toBe("pass");
    expect(evalPayload.criteria.western_breakfast.verdict).toBe("pass");
    expect(evalPayload.criteria.laundry_solution.verdict).toBe("pass");
    expect(evalPayload.criteria.pool_aesthetics_location.verdict).toBe("pass");

    // 5. compare_hotels_batch resolves Grand Hyatt Shenzhen (1526508) over Bao'an lookalike (33458379)
    const batchRes = await client.callTool({
      name: "compare_hotels_batch",
      arguments: {
        hotels: [
          { hotelName: "Futian Shangri-La, Shenzhen", city: "Shenzhen", tripadvisorLocationId: "1141607" },
          { hotelName: "Grand Hyatt", city: "Shenzhen" },
        ],
      },
    });
    expect(batchRes.isError).toBeFalsy();
    const batchPayload = JSON.parse(
      (batchRes.content[0] as { type: "text"; text: string }).text,
    ) as {
      count: number;
      summaryTable: Array<{
        hotelName: string;
        resolvedName: string;
        tripadvisorLocationId: string;
        overallVerdict: string;
      }>;
    };
    expect(batchPayload.count).toBe(2);
    expect(batchPayload.summaryTable[0]?.overallVerdict).toBe("pass");
    expect(batchPayload.summaryTable[1]?.tripadvisorLocationId).toBe("1526508");
    expect(batchPayload.summaryTable[1]?.resolvedName).toBe("Grand Hyatt Shenzhen");
    // Grand Hyatt Shenzhen has an outdoor pool (indoor_pool: false) so pool_aesthetics_location fails
    expect(batchPayload.summaryTable[1]?.overallVerdict).toBe("fail");

    // 6. TripAdvisor Terra 404 allowlist error propagation via MCP tool
    const ta404Res = await client.callTool({
      name: "ta_get_location_details",
      arguments: { locationId: "404999" },
    });
    expect(ta404Res.isError).toBe(true);
    const errPayload = JSON.parse(
      (ta404Res.content[0] as { type: "text"; text: string }).text,
    ) as { status: number; actionableHint: string };
    expect(errPayload.status).toBe(404);
    expect(errPayload.actionableHint).toContain("allowlist");

    await client.close();
    await created.server.close();
  });

  it("serves MCP over StreamableHTTPServerTransport and exposes /health", async () => {
    const baseConfig = loadConfig({
      MCP_TRANSPORT: "http",
      HOST: "127.0.0.1",
      GOOGLE_PLACES_API_KEY: "gp-http-test",
    });
    const config = { ...baseConfig, port: 0 };
    const { logger } = createTestLogger();

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [{ id: "ChIJhttp", displayName: { text: "HTTP Hotel" }, rating: 4.5 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const started = await startHttpServer(config, logger, { fetchImpl: fetchMock });
    try {
      const address = started.httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      expect(port).toBeGreaterThan(0);

      const rootResp = await fetch(`http://127.0.0.1:${port}/`);
      expect(rootResp.status).toBe(200);
      const rootInfo = (await rootResp.json()) as {
        status: string;
        endpoints: { mcp: string; health: string };
      };
      expect(rootInfo.status).toBe("ok");
      expect(rootInfo.endpoints).toEqual({ mcp: "/mcp", health: "/health" });

      const healthResp = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthResp.status).toBe(200);
      const health = (await healthResp.json()) as {
        status: string;
        enabledProviders: string[];
      };
      expect(health.status).toBe("ok");
      expect(health.enabledProviders).toEqual(["china_travel", "google_places"]);

      const client = new Client({ name: "http-test-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      );
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.some((t) => t.name === "gplaces_search_text")).toBe(true);

      const callRes = await client.callTool({
        name: "gplaces_search_text",
        arguments: { textQuery: "HTTP Hotel" },
      });
      expect(callRes.isError).toBeFalsy();
      const payload = JSON.parse(
        (callRes.content[0] as { type: "text"; text: string }).text,
      ) as { places: Array<{ name: string }> };
      expect(payload.places[0]?.name).toBe("HTTP Hotel");

      await transport.terminateSession();
      await client.close();
    } finally {
      await started.close();
    }
  });
});
