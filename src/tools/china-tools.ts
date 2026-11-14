import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChinaTravelProvider } from "../providers/china-travel.js";
import { textToolResult, withToolErrorHandling } from "../utils/http.js";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date in YYYY-MM-DD format")
  .optional();

const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(10)
  .default("en")
  .describe("Response language code (e.g., en, zh, ja, ko, de, fr, es)");

/**
 * Registers all China Travel (TripGenie / Trip.com) MCP tools.
 */
export function registerChinaTools(server: McpServer, provider: ChinaTravelProvider): string[] {
  const registered: string[] = [];

  server.registerTool(
    "china_search_hotels",
    {
      title: "China Travel: Search Hotels",
      description:
        "Search hotels across Chinese cities with real-time pricing, ratings, features, and Trip.com affiliate booking links (ported from mako202605/china-travel-mcp).",
      inputSchema: {
        city: z
          .string()
          .trim()
          .min(1)
          .describe('City name in China, e.g. "Beijing", "Shanghai", "Xi\'an", "Chengdu"'),
        check_in: isoDateSchema.describe("Optional check-in date (YYYY-MM-DD)"),
        check_out: isoDateSchema.describe("Optional check-out date (YYYY-MM-DD)"),
        guests: z.number().int().min(1).max(20).default(2).describe("Number of guests (default: 2)"),
        budget: z
          .string()
          .trim()
          .optional()
          .describe('Budget level or range, e.g. "budget", "mid-range", "luxury", "$50-100/night"'),
        preferences: z
          .string()
          .trim()
          .optional()
          .describe('Hotel preferences, e.g. "near city center", "with breakfast", "near the Bund"'),
        locale: localeSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("china_travel", async (args) => {
      const result = await provider.searchHotels(args);
      return textToolResult(result.content);
    }),
  );
  registered.push("china_search_hotels");

  server.registerTool(
    "china_search_flights",
    {
      title: "China Travel: Search Flights",
      description:
        "Search domestic and international flights to, from, or within China with airlines, flight numbers, times, prices, and Trip.com booking links.",
      inputSchema: {
        origin: z
          .string()
          .trim()
          .min(1)
          .describe('Departure city or airport, e.g. "Tokyo", "New York", "Beijing"'),
        destination: z
          .string()
          .trim()
          .min(1)
          .describe('Arrival city or airport, e.g. "Shanghai", "Beijing", "Guangzhou"'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date in YYYY-MM-DD format")
          .describe("Travel date (YYYY-MM-DD)"),
        trip_type: z
          .enum(["one way", "round trip"])
          .default("one way")
          .describe('Trip type: "one way" or "round trip"'),
        cabin: z
          .enum(["economy", "business", "first"])
          .default("economy")
          .describe('Cabin class: "economy", "business", or "first"'),
        locale: localeSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("china_travel", async (args) => {
      const result = await provider.searchFlights(args);
      return textToolResult(result.content);
    }),
  );
  registered.push("china_search_flights");

  server.registerTool(
    "china_search_attractions",
    {
      title: "China Travel: Search Attractions",
      description:
        "Discover top attractions and things to do in Chinese cities including ticket prices, opening hours, locations, and practical tips.",
      inputSchema: {
        city: z
          .string()
          .trim()
          .min(1)
          .describe('City name in China, e.g. "Beijing", "Guilin", "Hangzhou", "Xi\'an"'),
        days: z.number().int().min(1).max(30).default(1).describe("Number of sightseeing days"),
        interests: z
          .string()
          .trim()
          .optional()
          .describe('Specific interests, e.g. "history", "nature", "food", "photography"'),
        locale: localeSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("china_travel", async (args) => {
      const result = await provider.searchAttractions(args);
      return textToolResult(result.content);
    }),
  );
  registered.push("china_search_attractions");

  server.registerTool(
    "china_plan_itinerary",
    {
      title: "China Travel: Plan Itinerary",
      description:
        "Generate a complete multi-day itinerary for a Chinese city including hotel recommendations, attractions, dining, local transport, and booking links.",
      inputSchema: {
        city: z.string().trim().min(1).describe("City name in China"),
        days: z.number().int().min(1).max(30).describe("Number of days for the trip"),
        travelers: z.number().int().min(1).max(20).default(2).describe("Number of travelers"),
        interests: z
          .string()
          .trim()
          .optional()
          .describe('Travel interests, e.g. "history and culture", "food and nightlife"'),
        budget: z
          .string()
          .trim()
          .optional()
          .describe('Budget level, e.g. "budget", "mid-range", "luxury"'),
        locale: localeSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("china_travel", async (args) => {
      const result = await provider.planItinerary(args);
      return textToolResult(result.content);
    }),
  );
  registered.push("china_plan_itinerary");

  server.registerTool(
    "china_get_travel_tips",
    {
      title: "China Travel: Get Travel Tips",
      description:
        "Get practical travel advice for visiting China (visas, 144/240-hour transit policies, Alipay/WeChat Pay, transport, safety, culture).",
      inputSchema: {
        question: z
          .string()
          .trim()
          .min(1)
          .describe('Travel question in natural language, e.g. "How to use Alipay in China?"'),
        locale: localeSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("china_travel", async (args) => {
      const result = await provider.getTravelTips(args);
      return textToolResult(result.content);
    }),
  );
  registered.push("china_get_travel_tips");

  return registered;
}
