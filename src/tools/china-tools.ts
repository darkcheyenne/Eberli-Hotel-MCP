import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChinaTravelProvider } from "../providers/china-travel.js";
import {
  analyzeReviewsAndTopics,
  extractJsonFromText,
  findCuratedProfile,
} from "../utils/hotel-intelligence.js";
import { jsonToolResult, textToolResult, withToolErrorHandling } from "../utils/http.js";
import type { NormalizedReview } from "../utils/normalizer.js";

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
          .describe('City name in China, e.g. "Beijing", "Shanghai", "Shenzhen", "Xi\'an", "Chengdu"'),
        area: z
          .string()
          .trim()
          .optional()
          .describe('Optional district or area filter, e.g. "Futian", "Nanshan", "Luohu", "The Bund"'),
        tier: z
          .string()
          .trim()
          .optional()
          .describe('Optional hotel tier filter, e.g. "luxury", "5-star", "boutique", "mid-range", "budget"'),
        maxPriceUsd: z
          .number()
          .positive()
          .optional()
          .describe("Optional maximum nightly price in USD (e.g. 500)"),
        keyword: z
          .string()
          .trim()
          .optional()
          .describe('Optional hotel name or feature keyword, e.g. "Shangri-La", "heated indoor pool"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Optional maximum number of hotels to return (1-50)"),
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
    "china_get_hotel_reviews",
    {
      title: "China Travel: Get Trip.com Hotel Reviews & Topic Analysis",
      description:
        "Retrieve Trip.com hotel reviews (up to 20) and topic statistics (breakfast, smoking, noise, pool, cleanliness, service, laundry) in the requested language.",
      inputSchema: {
        hotelName: z
          .string()
          .trim()
          .optional()
          .describe('Hotel name, e.g. "Futian Shangri-La, Shenzhen"'),
        hotelId: z
          .string()
          .trim()
          .optional()
          .describe('Optional hotel ID or TripAdvisor/Trip.com ID, e.g. "1141607" or "futian-shangri-la"'),
        city: z
          .string()
          .trim()
          .optional()
          .describe('Optional city name, e.g. "Shenzhen"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Maximum number of reviews to return (1-20, default: 10)"),
        language: z
          .string()
          .trim()
          .default("de")
          .describe('Language code for review texts (e.g. "de", "en", "zh")'),
        query: z
          .string()
          .trim()
          .optional()
          .describe('Optional keyword/topic filter, e.g. "breakfast", "smoking", "pool", "laundry"'),
        topics: z
          .array(z.string().trim().min(1))
          .optional()
          .describe('Optional list of topics to analyze, default: ["breakfast","smoking","noise","pool","cleanliness","service","laundry"]'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    withToolErrorHandling("china_travel", async (args) => {
      if (!args.hotelName && !args.hotelId) {
        throw new Error("Either hotelName or hotelId must be provided.");
      }

      const curated = findCuratedProfile({
        hotelName: args.hotelName,
        city: args.city,
        locationId: args.hotelId,
      });

      const tgRes = await provider.getHotelReviews({
        hotelName: args.hotelName ?? curated?.canonicalName,
        hotelId: args.hotelId,
        city: args.city ?? curated?.city,
        limit: args.limit,
        language: args.language,
        query: args.query,
        topics: args.topics,
      });

      const parsedJson = extractJsonFromText<{
        hotelName?: string;
        tripComRatingOutOf10?: number;
        totalReviews?: number;
        topicStats?: Record<string, { mentions: number; reviews: number; negative: number }>;
        reviews?: Array<{
          id?: string;
          author?: string;
          ratingOutOf5?: number;
          ratingOutOf10?: number;
          title?: string;
          text?: string;
          publishedAt?: string;
          tripType?: string;
          language?: string;
        }>;
      }>(tgRes.content);

      const rawReviews: NormalizedReview[] = (parsedJson?.reviews ?? []).map((r, idx) => ({
        provider: "tripadvisor_terra",
        id: r.id ?? `tripcom-${idx + 1}`,
        author: r.author ?? "Trip.com Guest",
        ratingOutOf5:
          r.ratingOutOf5 ?? (typeof r.ratingOutOf10 === "number" ? r.ratingOutOf10 / 2 : 5),
        title: r.title,
        text: r.text,
        publishedAt: r.publishedAt,
        tripType: r.tripType,
        language: r.language ?? args.language,
      }));

      const analysis = analyzeReviewsAndTopics({
        reviews: rawReviews,
        query: args.query,
        topics: args.topics,
        locationId: args.hotelId,
        hotelName: args.hotelName ?? curated?.canonicalName,
        language: args.language,
        supplementWithCurated: true,
      });

      // Merge upstream topicStats if provided and higher than sample counts
      const mergedTopicStats = { ...analysis.topicStats };
      if (parsedJson?.topicStats) {
        for (const [topic, stat] of Object.entries(parsedJson.topicStats)) {
          if (stat && typeof stat.mentions === "number") {
            const existing = mergedTopicStats[topic];
            if (!existing || stat.reviews > existing.reviews) {
              mergedTopicStats[topic] = {
                mentions: stat.mentions,
                reviews: stat.reviews ?? stat.mentions,
                negative: stat.negative ?? 0,
                positive: Math.max(0, (stat.reviews ?? stat.mentions) - (stat.negative ?? 0)),
              };
            }
          }
        }
      }

      const reviewsOut = analysis.filteredReviews.slice(0, args.limit).map((r) => ({
        ...r,
        provider: "trip.com",
      }));

      const snippetsOut = analysis.snippets.map((s) => ({
        ...s,
        provider: "trip.com",
      }));

      const rating10 =
        parsedJson?.tripComRatingOutOf10 ?? curated?.tripComRatingOutOf10 ?? null;
      const totalReviews =
        parsedJson?.totalReviews ?? curated?.tripComReviewCount ?? reviewsOut.length;

      return jsonToolResult({
        provider: "china_travel",
        source: "trip.com",
        cached: tgRes.cached,
        hotelName: parsedJson?.hotelName ?? curated?.canonicalName ?? args.hotelName ?? args.hotelId,
        hotelId: args.hotelId ?? curated?.locationIds?.[0] ?? null,
        city: args.city ?? curated?.city ?? null,
        language: args.language,
        tripComRatingOutOf10: rating10,
        normalizedOutOf5: rating10 !== null ? Math.round((rating10 / 2) * 100) / 100 : null,
        normalizedOutOf100: rating10 !== null ? Math.round(rating10 * 10 * 10) / 10 : null,
        totalReviews,
        count: reviewsOut.length,
        topicStats: mergedTopicStats,
        snippets: snippetsOut,
        reviews: reviewsOut,
      });
    }),
  );
  registered.push("china_get_hotel_reviews");

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
