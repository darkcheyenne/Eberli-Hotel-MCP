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
      "china_search_flights",
      "china_search_attractions",
      "china_plan_itinerary",
      "china_get_travel_tips",
      "compare_hotel_intelligence",
    ]);
    expect(warnings.some((w) => w.includes("TRIPADVISOR_TERRA_API_KEY"))).toBe(true);
    expect(warnings.some((w) => w.includes("GOOGLE_PLACES_API_KEY"))).toBe(true);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([created.server.connect(serverTransport), client.connect(clientTransport)]);

    const listResult = await client.listTools();
    const names = listResult.tools.map((t) => t.name);
    expect(names).toContain("china_search_hotels");
    expect(names).not.toContain("ta_search_locations");
    expect(names).not.toContain("gplaces_search_text");

    await client.close();
    await created.server.close();
  });

  it("registers all 15 tools when all providers are configured and handles cross-provider hotel comparison", async () => {
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
            data: [{ id: 1, title: "Iconic Bund view", rating: 5, text: "Impeccable." }],
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
    expect(created.registeredTools).toHaveLength(15);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([created.server.connect(serverTransport), client.connect(clientTransport)]);

    // 1. Cross-provider comparison
    const compareRes = await client.callTool({
      name: "compare_hotel_intelligence",
      arguments: {
        hotelName: "The Peninsula Shanghai",
        city: "Shanghai",
        country: "China",
      },
    });
    expect(compareRes.isError).toBeFalsy();
    const comparePayload = JSON.parse(
      (compareRes.content[0] as { type: "text"; text: string }).text,
    ) as {
      consensus: { scoreOutOf5: number; totalReviews: number; providerCount: number };
      providers: {
        tripadvisorTerra: { status: string };
        googlePlaces: { status: string };
        chinaTravel: { status: string; highlights: { bookingUrls: string[] } };
      };
    };

    expect(comparePayload.providers.tripadvisorTerra.status).toBe("ok");
    expect(comparePayload.providers.googlePlaces.status).toBe("ok");
    expect(comparePayload.providers.chinaTravel.status).toBe("ok");
    // Weighted average: (5.0 * 3000 + 4.7 * 1000) / 4000 = 4.925 -> 4.93
    expect(comparePayload.consensus.scoreOutOf5).toBe(4.93);
    expect(comparePayload.consensus.totalReviews).toBe(4000);
    expect(comparePayload.providers.chinaTravel.highlights.bookingUrls).toContain(
      "https://www.trip.com/hotels/peninsula-shanghai",
    );

    // 2. TripAdvisor Terra 404 allowlist error propagation via MCP tool
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

    const started = await startHttpServer(config, logger, fetchMock);
    try {
      const address = started.httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      expect(port).toBeGreaterThan(0);

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
